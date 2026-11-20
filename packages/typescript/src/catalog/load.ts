import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type Convention,
  isMissingFile,
  isPackName,
  isVersion,
  listLines,
  QualityRulesError,
  readPublishedConventions,
} from './conventions.ts';

/** A JSON value, as read from pack files and the manifest. */
export type Json = null | boolean | number | string | readonly Json[] | JsonObject;

/** A JSON object. */
export interface JsonObject {
  readonly [key: string]: Json;
}

/**
 * Key in a package's `package.json` that marks it as a provider of packs. Its value says where
 * the packs and conventions are, relative to the package folder, and which export holds the
 * custom lint rules:
 *
 * ```json
 * "qualityRules": { "packs": "packs", "conventions": "dist/conventions", "rules": "." }
 * ```
 */
export const PACKAGE_FIELD = 'qualityRules';

/** An installed package that provides packs. */
export interface CatalogPackage {
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  /** Import specifier of the module whose named export `rules` holds the custom lint rules. */
  readonly rulesModule: string | undefined;
}

/** One rule of a pack file (`packs/<pack>.json`). */
export interface CatalogRule {
  readonly id: string;
  readonly pack: string;
  readonly package: string;
  /** The tool that checks the rule, such as `oxlint` or `biome`. */
  readonly tool: string;
  readonly description: string;
  /** Package version that added the rule. */
  readonly added: string;
  /**
   * Default options. The manifest's `options` entry for the rule replaces a scalar default
   * and is merged key by key into an object default.
   */
  readonly options: Json | undefined;
  /**
   * Configuration fragments by generated file kind (`biome`, `oxlint`, `eslint`, `prettier`,
   * ...). The string `{{options}}` stands for the resolved options and `{{options.<key>}}` for
   * one of their keys. An `eslint` fragment is a flat config object with only `rules`,
   * `plugins`, `settings` and `linterOptions`, where `plugins` maps each plugin's name (the
   * prefix of its rule IDs) to the package whose default export is the plugin.
   */
  readonly config: Readonly<Record<string, JsonObject>>;
}

/** One convention, with the package that ships it. */
export interface CatalogConvention extends Convention {
  readonly package: string;
}

/** A pack: the rules of its pack files and the conventions whose `pack` field names it. */
export interface CatalogPack {
  readonly name: string;
  /** Description from the pack file. Packs of conventions only have none. */
  readonly description: string | undefined;
  readonly packages: readonly string[];
  readonly rules: readonly CatalogRule[];
  readonly conventions: readonly CatalogConvention[];
}

/** Everything the installed packages provide. */
export interface Catalog {
  readonly packages: readonly CatalogPackage[];
  readonly packs: readonly CatalogPack[];
  readonly rules: readonly CatalogRule[];
  readonly conventions: readonly CatalogConvention[];
}

interface PackageFile {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly optionalDependencies?: unknown;
  readonly [PACKAGE_FIELD]?: unknown;
}

interface LoadedPackage {
  readonly package: CatalogPackage;
  readonly packDescriptions: ReadonlyMap<string, string>;
  readonly rules: readonly CatalogRule[];
  readonly conventions: readonly CatalogConvention[];
}

/** A string in a configuration fragment that stands for the options or one of their keys. */
export const OPTIONS_PLACEHOLDER = /^\{\{options(?:\.(?<key>[^{}.]+))?\}\}$/;
const PACKAGE_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const EXPORT_PATH = /^\.(?:\/[A-Za-z0-9._@-]+)*$/;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
/** The keys that an `eslint` fragment may have. */
const ESLINT_FRAGMENT_KEYS = ['rules', 'plugins', 'settings', 'linterOptions'];
/** The plugin that the generated files build from the custom rules of the packages. */
const CUSTOM_RULES_PLUGIN = 'quality-rules';

/**
 * Reads the catalog from the packages that the project at `projectDir` lists in its
 * `package.json` and has installed. Throws a {@link QualityRulesError} that lists every problem
 * when a pack file or convention is broken or two IDs collide.
 */
export async function loadCatalog(projectDir: string): Promise<Catalog> {
  const packageDirs = await findInstalledPackages(projectDir);
  if (packageDirs.length === 0) {
    throw new QualityRulesError(
      'No installed package provides packs. Add one, such as @reeschan/quality-rules-typescript, to the devDependencies of package.json and install it.'
    );
  }
  const problems: string[] = [];
  const loaded: LoadedPackage[] = [];
  for (const dir of packageDirs) {
    loaded.push(await loadPackage(dir, problems));
  }
  const catalog = assembleCatalog(loaded);
  problems.push(...checkCatalog(catalog));
  if (problems.length > 0) {
    throw new QualityRulesError(`The installed packs have problems:\n${listLines(problems)}`);
  }
  return catalog;
}

async function readPackageFile(file: string): Promise<PackageFile> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!isObject(parsed)) {
    throw new QualityRulesError(`${file} is not a JSON object`);
  }
  return parsed;
}

/** Folders of the installed dependencies of the project whose package.json has the field. */
async function findInstalledPackages(projectDir: string): Promise<string[]> {
  const projectFile = path.join(projectDir, 'package.json');
  let project: PackageFile;
  try {
    project = await readPackageFile(projectFile);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new QualityRulesError(
        `No package.json in ${projectDir}. quality-rules reads the packs from the installed dependencies.`
      );
    }
    throw error;
  }
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = project[field];
    if (isObject(dependencies)) {
      for (const name of Object.keys(dependencies)) {
        names.add(name);
      }
    }
  }
  const dirs: string[] = [];
  for (const name of [...names].sort()) {
    const dir = await findPackageDir(projectDir, name);
    if (dir !== undefined && PACKAGE_FIELD in (await readPackageFile(packageJsonOf(dir)))) {
      dirs.push(dir);
    }
  }
  return dirs;
}

/** Looks for `node_modules/<name>` in the project folder and its parents, as Node does. */
async function findPackageDir(projectDir: string, name: string): Promise<string | undefined> {
  let dir = path.resolve(projectDir);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'));
    try {
      await readFile(packageJsonOf(candidate));
      return candidate;
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function packageJsonOf(dir: string): string {
  return path.join(dir, 'package.json');
}

async function loadPackage(dir: string, problems: string[]): Promise<LoadedPackage> {
  const file = await readPackageFile(packageJsonOf(dir));
  const name = typeof file.name === 'string' ? file.name : dir;
  // The name and the rules export end up in the generated plugin's import statements.
  if (!PACKAGE_NAME.test(name)) {
    problems.push(`${name}: package.json has no valid package name`);
  }
  const version = isVersion(file.version) ? file.version : '0.0.0';
  if (!isVersion(file.version)) {
    problems.push(`${name}: package.json has no version such as 1.2.0`);
  }
  const field = file[PACKAGE_FIELD];
  const layout = isObject(field) ? field : {};
  if (!isObject(field)) {
    problems.push(`${name}: "${PACKAGE_FIELD}" in package.json is not an object`);
  }
  const packsDir = stringOr(layout.packs, 'packs');
  const conventionsDir = stringOr(layout.conventions, 'conventions');
  const rulesExport = typeof layout.rules === 'string' ? layout.rules : undefined;
  if (rulesExport !== undefined && !EXPORT_PATH.test(rulesExport)) {
    problems.push(
      `${name}: "${PACKAGE_FIELD}.rules" is not an export path such as "." or "./rules"`
    );
  }
  const catalogPackage: CatalogPackage = {
    name,
    version,
    dir,
    rulesModule: rulesExport === undefined ? undefined : toSpecifier(name, rulesExport),
  };

  const packDescriptions = new Map<string, string>();
  const rules: CatalogRule[] = [];
  for (const [packName, text] of await readPackFiles(path.join(dir, packsDir))) {
    const where = `${name} ${packsDir}/${packName}.json`;
    const pack = readPackFile(text, packName, name);
    problems.push(...pack.problems.map((problem) => `${where}: ${problem}`));
    packDescriptions.set(packName, pack.description);
    rules.push(...pack.rules);
  }

  const published = await readPublishedConventions(path.join(dir, conventionsDir));
  problems.push(...published.problems.map((problem) => `${name} ${conventionsDir}/${problem}`));
  const conventions = published.conventions.map((convention) => ({ ...convention, package: name }));
  return { package: catalogPackage, packDescriptions, rules, conventions };
}

function toSpecifier(name: string, exportPath: string): string {
  const subpath = exportPath.replace(/^\.\/?/, '');
  return subpath === '' ? name : `${name}/${subpath}`;
}

async function readPackFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isMissingFile(error)) {
      return files;
    }
    throw error;
  }
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    files.set(name.slice(0, -'.json'.length), await readFile(path.join(dir, name), 'utf8'));
  }
  return files;
}

function readPackFile(
  text: string,
  pack: string,
  packageName: string
): { description: string; rules: CatalogRule[]; problems: string[] } {
  const problems: string[] = [];
  if (!isPackName(pack)) {
    problems.push(`pack name "${pack}" is not a lowercase name such as size-limits`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    problems.push(`is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    return { description: '', rules: [], problems };
  }
  if (!isObject(parsed)) {
    problems.push('is not a JSON object');
    return { description: '', rules: [], problems };
  }
  const description = typeof parsed.description === 'string' ? parsed.description : '';
  if (description === '') {
    problems.push('missing "description"');
  }
  if (!Array.isArray(parsed.rules)) {
    problems.push('missing the "rules" array');
    return { description, rules: [], problems };
  }
  const rules: CatalogRule[] = [];
  parsed.rules.forEach((entry: unknown, index: number) => {
    const rule = readRuleEntry(entry, pack, packageName);
    const label = typeof rule.id === 'string' && rule.id !== '' ? ` (${rule.id})` : '';
    problems.push(...rule.problems.map((problem) => `rules[${index}]${label}: ${problem}`));
    if (rule.problems.length === 0 && rule.value !== undefined) {
      rules.push(rule.value);
    }
  });
  return { description, rules, problems };
}

function readRuleEntry(
  entry: unknown,
  pack: string,
  packageName: string
): { id: unknown; value: CatalogRule | undefined; problems: string[] } {
  if (!isObject(entry)) {
    return { id: undefined, value: undefined, problems: ['is not a JSON object'] };
  }
  const problems: string[] = [];
  const { id, tool, description, added, options } = entry;
  for (const [key, value] of Object.entries({ id, tool, description })) {
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`missing "${key}"`);
    }
  }
  if (typeof id === 'string' && /\s/.test(id)) {
    problems.push(`id "${id}" contains white space`);
  }
  if (added === undefined) {
    problems.push('missing "added" (the package version that added the rule)');
  } else if (!isVersion(added)) {
    problems.push(`added "${String(added)}" is not a version such as 1.2.0`);
  }
  const config = entry.config ?? {};
  if (!isObject(config) || !Object.values(config).every(isObject)) {
    problems.push('"config" is not an object of configuration objects by tool');
  } else {
    problems.push(...checkPlaceholders(config, options as Json | undefined));
    problems.push(...checkEslintFragment(config.eslint));
  }
  if (problems.length > 0) {
    return { id, value: undefined, problems };
  }
  return {
    id,
    value: {
      id: id as string,
      pack,
      package: packageName,
      tool: tool as string,
      description: description as string,
      added: added as string,
      options: options as Json | undefined,
      config: config as Record<string, JsonObject>,
    },
    problems,
  };
}

function checkPlaceholders(config: unknown, options: Json | undefined): string[] {
  const problems: string[] = [];
  visitStrings(config, (value) => {
    if (!value.includes('{{')) {
      return;
    }
    const match = OPTIONS_PLACEHOLDER.exec(value);
    if (match === null) {
      problems.push(`"${value}" is not {{options}} or {{options.<key>}}`);
    } else if (options === undefined) {
      problems.push(`"${value}" is used but the rule has no default "options"`);
    } else if (match.groups?.key !== undefined) {
      const key = match.groups.key;
      if (!isObject(options) || !Object.hasOwn(options, key)) {
        problems.push(`"${value}" names a key that the default "options" do not have`);
      }
    }
  });
  return problems;
}

/**
 * Problems with an `eslint` fragment. Its plugin packages end up in the import statements of
 * the generated configuration, so they must be package names.
 */
function checkEslintFragment(fragment: unknown): string[] {
  if (!isObject(fragment)) {
    return [];
  }
  const problems = Object.keys(fragment)
    .filter((key) => !ESLINT_FRAGMENT_KEYS.includes(key))
    .map((key) => `"config.eslint" has "${key}"; it takes ${ESLINT_FRAGMENT_KEYS.join(', ')}`);
  const { plugins } = fragment;
  if (plugins === undefined) {
    return problems;
  }
  if (!isObject(plugins)) {
    problems.push('"config.eslint.plugins" is not an object of package names by plugin name');
    return problems;
  }
  for (const [name, packageName] of Object.entries(plugins)) {
    if (!PACKAGE_NAME.test(name) || name === CUSTOM_RULES_PLUGIN) {
      problems.push(`"config.eslint.plugins" has the plugin name "${name}", which is not allowed`);
    }
    if (typeof packageName !== 'string' || !PACKAGE_NAME.test(packageName)) {
      problems.push(`"config.eslint.plugins.${name}" is not a package name`);
    }
  }
  return problems;
}

function visitStrings(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') {
    visit(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      visitStrings(item, visit);
    }
  } else if (isObject(value)) {
    for (const item of Object.values(value)) {
      visitStrings(item, visit);
    }
  }
}

function assembleCatalog(loaded: readonly LoadedPackage[]): Catalog {
  const rules = loaded.flatMap((entry) => entry.rules);
  const conventions = loaded
    .flatMap((entry) => entry.conventions)
    .sort((a, b) => compareIds(a.id, b.id));
  const packNames = new Set([
    ...loaded.flatMap((entry) => [...entry.packDescriptions.keys()]),
    ...conventions.map((convention) => convention.pack),
  ]);
  const packs = [...packNames].sort().map((name): CatalogPack => {
    const providers = loaded.filter(
      (entry) =>
        entry.packDescriptions.has(name) ||
        entry.conventions.some((convention) => convention.pack === name)
    );
    const description = providers
      .map((entry) => entry.packDescriptions.get(name))
      .find((text) => text !== undefined);
    return {
      name,
      description,
      packages: providers.map((entry) => entry.package.name),
      rules: rules.filter((rule) => rule.pack === name),
      conventions: conventions.filter((convention) => convention.pack === name),
    };
  });
  return { packages: loaded.map((entry) => entry.package), packs, rules, conventions };
}

function checkCatalog(catalog: Catalog): string[] {
  const problems: string[] = [];
  const owners = new Map<string, string[]>();
  for (const rule of catalog.rules) {
    pushTo(owners, rule.id, `rule in ${rule.package} pack ${rule.pack}`);
  }
  for (const convention of catalog.conventions) {
    pushTo(owners, convention.id, `convention in ${convention.package}`);
  }
  for (const [id, places] of owners) {
    if (places.length > 1) {
      problems.push(`ID ${id} is used more than once: ${places.join('; ')}`);
    }
  }
  problems.push(...checkEslintPlugins(catalog.rules));
  const rulesById = new Map(catalog.rules.map((rule) => [rule.id, rule]));
  for (const convention of catalog.conventions) {
    for (const ruleId of convention.check) {
      const rule = rulesById.get(ruleId);
      if (rule === undefined) {
        problems.push(
          `${convention.package} ${convention.id}: check names ${ruleId}, which is no rule`
        );
      } else if (rule.pack !== convention.pack) {
        problems.push(
          `${convention.package} ${convention.id}: check rule ${ruleId} is in pack ${rule.pack}, but the convention is in pack ${convention.pack}; a convention and the rules that check it belong to the same pack`
        );
      }
    }
  }
  return problems;
}

/** Problems where two rules load different packages under the same ESLint plugin name. */
function checkEslintPlugins(rules: readonly CatalogRule[]): string[] {
  const packagesByPlugin = new Map<string, string[]>();
  for (const rule of rules) {
    const plugins = rule.config.eslint?.plugins;
    for (const [name, packageName] of Object.entries(isObject(plugins) ? plugins : {})) {
      const known = packagesByPlugin.get(name) ?? [];
      if (!known.includes(packageName as string)) {
        pushTo(packagesByPlugin, name, packageName as string);
      }
    }
  }
  return [...packagesByPlugin]
    .filter(([, packages]) => packages.length > 1)
    .map(([name, packages]) => `ESLint plugin ${name} is loaded from ${packages.join(' and ')}`);
}

function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

/** Orders IDs by text, with numbers by value (`NAME-2` before `NAME-10`). */
export function compareIds(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

/** Whether a value is a plain JSON object (not an array or null). */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback;
}
