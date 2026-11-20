import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isMissingFile, listLines, QualityRulesError } from '../errors.ts';
import { isObject } from '../json.ts';
import { readPublishedConventions } from './conventions.ts';
import { FragmentKind } from './fragment-kind.ts';
import { compareIds, isPackageName, isVersion } from './names.ts';
import { readPackFile, readPackFiles } from './pack-file.ts';
import type {
  Catalog,
  CatalogConvention,
  CatalogPack,
  CatalogPackage,
  CatalogRule,
} from './types.ts';

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

const EXPORT_PATH = /^\.(?:\/[A-Za-z0-9._@-]+)*$/;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

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
  if (!isPackageName(name)) {
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
    const plugins = rule.config[FragmentKind.ESLINT]?.plugins;
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

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback;
}
