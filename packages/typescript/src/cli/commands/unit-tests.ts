import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadCatalog } from '../../catalog/load.ts';
import { QualityRulesError } from '../../errors.ts';
import { isObject } from '../../json.ts';
import { readManifest } from '../../manifest/manifest.ts';
import { resolve } from '../../resolve/resolve.ts';
import { stripComments } from '../../source/comments.ts';
import {
  existingDirs,
  filesUnder,
  isDirectory,
  isInside,
  SOURCE_FILE,
} from '../../source/files.ts';
import type { CommandIo, CommandSpec } from '../main.ts';

/** ID of the rule that this command checks, in `packs/unit-tests.json`. */
const RULE_ID = 'unit-tests/imported-by-tests';

/** The tsconfig file name that the rule reads when the options do not name another. */
const DEFAULT_TSCONFIG = 'tsconfig.json';

/** The options of the rule, after the manifest's values are put over the defaults. */
interface UnitTestsOptions {
  readonly dirs: readonly string[];
  readonly testDirs: readonly string[];
  readonly tsconfig: string;
}

/** Path aliases of a tsconfig: patterns such as `@/*` with the places they stand for. */
interface Aliases {
  /** Folder that the targets of `paths` are relative to. */
  readonly base: string;
  readonly paths: Readonly<Record<string, readonly string[]>>;
  /** `baseUrl` as an absolute folder, for imports such as `domain/sum`. */
  readonly baseUrl: string | undefined;
}

const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/;
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** The source file extensions that an import written with a JavaScript extension can mean. */
const JAVASCRIPT_TO_SOURCE: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

/**
 * `quality-rules unit-tests`: fails when a file in the chosen folders is not imported by any unit
 * test. A unit test is a `*.test.*` or `*.spec.*` file in one of the test folders. An import counts
 * when it is written as a relative path (with or without the extension, or as a folder with an
 * index file) or through a path alias or `baseUrl` of the tsconfig. An index file that a test
 * imports passes the count on to the files that it imports or re-exports, so a test of the public
 * entry of a folder counts the files behind it. Imports from other code do not count.
 */
export const unitTestsCommand: CommandSpec = {
  summary: 'Fail on files of the chosen folders that no unit test imports',
  options: {},
  async run(_values, io) {
    const catalog = await loadCatalog(io.cwd);
    const manifest = await readManifest(io.cwd);
    const resolution = resolve(catalog, manifest);
    const item = resolution.rules.find((entry) => entry.rule.id === RULE_ID);
    if (item === undefined || !item.active) {
      io.out(
        `${RULE_ID} is not in effect (pack "unit-tests" is not selected, or the rule is excluded or pending), so nothing was checked.\n`
      );
      return 0;
    }
    const options = readOptions(item.options);
    const dirs = await existingDirs(io.cwd, options.dirs);
    const aliases = await readAliases(io.cwd, options.tsconfig);
    const tests = await testFilesIn(io.cwd, options.testDirs);
    const read = await filesReadBy(tests, aliases);
    const files = await sourceFilesIn(dirs);
    const unread = files.filter((file) => !read.has(file));
    return report(unread, files.length, options, io);
  },
};

function readOptions(options: unknown): UnitTestsOptions {
  const problems: string[] = [];
  const values = isObject(options) ? options : {};
  const { dirs, testDirs, tsconfig } = values;
  if (!isFolderList(dirs) || dirs.length === 0) {
    problems.push('"dirs" must be a list of folder names such as ["src"]');
  }
  if (!isFolderList(testDirs)) {
    problems.push('"testDirs" must be a list of folder names such as ["test"]');
  }
  if (typeof tsconfig !== 'string' || tsconfig === '') {
    problems.push('"tsconfig" must be a file name such as "tsconfig.json"');
  }
  if (problems.length > 0) {
    throw new QualityRulesError(`The options of ${RULE_ID} are wrong: ${problems.join('; ')}`);
  }
  return {
    dirs: dirs as string[],
    testDirs: testDirs as string[],
    tsconfig: tsconfig as string,
  };
}

function isFolderList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && entry !== '' && !entry.startsWith('-'))
  );
}

async function isFile(absolute: string): Promise<boolean> {
  const info = await stat(absolute).catch(() => undefined);
  return info?.isFile() === true;
}

/** Source files of the folders that need a unit test: not the tests, not declaration files. */
async function sourceFilesIn(dirs: readonly string[]): Promise<string[]> {
  const all = (await Promise.all(dirs.map(filesUnder))).flat();
  const unique = [...new Set(all)];
  return unique.filter(
    (file) => SOURCE_FILE.test(file) && !DECLARATION_FILE.test(file) && !TEST_FILE.test(file)
  );
}

/** The unit tests in the test folders. A test folder that does not exist is skipped. */
async function testFilesIn(cwd: string, testDirs: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const dir of testDirs) {
    const absolute = path.resolve(cwd, dir);
    if (isInside(cwd, absolute) && (await isDirectory(absolute))) {
      found.push(...(await filesUnder(absolute)));
    }
  }
  return [...new Set(found)].filter((file) => TEST_FILE.test(file));
}

const IMPORT_PATTERNS = [
  // import 'a', import x from 'a', import { x } from 'a', export * from 'a', export { x } from 'a'
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  // import('a'), require('a')
  /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** The module names that a source file imports, re-exports, requires or imports dynamically. */
function specifiersOf(code: string): string[] {
  const stripped = stripComments(code);
  return IMPORT_PATTERNS.flatMap((pattern) =>
    [...stripped.matchAll(pattern)].map((match) => match[1] ?? '')
  ).filter((specifier) => specifier !== '');
}

/** Removes comments and trailing commas from JSON with comments, then parses it. */
function parseJsonWithComments(text: string, file: string): unknown {
  const json = stripComments(text).replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new QualityRulesError(`${file} is not valid JSON: ${(error as Error).message}`);
  }
}

/** Reads `paths` and `baseUrl` of a tsconfig, following `extends` of relative file names. */
async function readTsconfigAliases(file: string, seen: ReadonlySet<string>): Promise<Aliases> {
  const empty: Aliases = { base: path.dirname(file), paths: {}, baseUrl: undefined };
  if (seen.has(file)) {
    return empty;
  }
  const parsed = parseJsonWithComments(await readFile(file, 'utf8'), file);
  if (!isObject(parsed)) {
    return empty;
  }
  const dir = path.dirname(file);
  let inherited = empty;
  const extended = typeof parsed.extends === 'string' ? [parsed.extends] : parsed.extends;
  if (Array.isArray(extended)) {
    for (const name of extended) {
      const parent = await resolveExtends(dir, name);
      if (parent !== undefined) {
        inherited = await readTsconfigAliases(parent, new Set([...seen, file]));
      }
    }
  }
  const options = isObject(parsed.compilerOptions) ? parsed.compilerOptions : {};
  const baseUrl =
    typeof options.baseUrl === 'string' ? path.resolve(dir, options.baseUrl) : inherited.baseUrl;
  if (isObject(options.paths)) {
    const paths: Record<string, string[]> = {};
    for (const [pattern, targets] of Object.entries(options.paths)) {
      paths[pattern] = Array.isArray(targets)
        ? targets.filter((target): target is string => typeof target === 'string')
        : [];
    }
    return { base: dir, paths, baseUrl };
  }
  return { base: inherited.base, paths: inherited.paths, baseUrl };
}

async function resolveExtends(dir: string, name: unknown): Promise<string | undefined> {
  if (typeof name !== 'string' || !(name.startsWith('.') || path.isAbsolute(name))) {
    return undefined;
  }
  const absolute = path.resolve(dir, name);
  for (const candidate of [absolute, `${absolute}.json`]) {
    if (await isFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * The path aliases of the project's tsconfig. A missing default tsconfig means no aliases; a
 * tsconfig that the options name but that does not exist is an error.
 */
async function readAliases(cwd: string, tsconfig: string): Promise<Aliases> {
  const file = path.resolve(cwd, tsconfig);
  if (!(await isFile(file))) {
    if (tsconfig !== DEFAULT_TSCONFIG) {
      throw new QualityRulesError(`The file "${tsconfig}" in "tsconfig" does not exist`);
    }
    return { base: cwd, paths: {}, baseUrl: undefined };
  }
  const aliases = await readTsconfigAliases(file, new Set());
  return { ...aliases, base: aliases.baseUrl ?? aliases.base };
}

/** The first existing file that a path without a known extension, or a folder, stands for. */
async function resolveFile(base: string): Promise<string | undefined> {
  const extension = path.extname(base);
  const swapped = (JAVASCRIPT_TO_SOURCE[extension] ?? []).map(
    (replacement) => `${base.slice(0, base.length - extension.length)}${replacement}`
  );
  const candidates = [
    base,
    ...swapped,
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    if (await isFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** The places that a module name can stand for: a relative path, an alias, or under `baseUrl`. */
function candidatePaths(specifier: string, from: string, aliases: Aliases): string[] {
  if (specifier === '.' || specifier === '..' || /^\.\.?[\\/]/.test(specifier)) {
    return [path.resolve(path.dirname(from), specifier)];
  }
  const found: string[] = [];
  const matches = Object.entries(aliases.paths)
    .flatMap(([pattern, targets]) => {
      const star = pattern.indexOf('*');
      if (star === -1) {
        return pattern === specifier ? [{ length: pattern.length, targets, rest: '' }] : [];
      }
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      const fits =
        specifier.length >= prefix.length + suffix.length &&
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix);
      return fits
        ? [
            {
              length: prefix.length,
              targets,
              rest: specifier.slice(prefix.length, specifier.length - suffix.length),
            },
          ]
        : [];
    })
    .sort((left, right) => right.length - left.length);
  for (const match of matches) {
    for (const target of match.targets) {
      found.push(path.resolve(aliases.base, target.replace('*', match.rest)));
    }
  }
  if (aliases.baseUrl !== undefined) {
    found.push(path.resolve(aliases.baseUrl, specifier));
  }
  return found;
}

async function resolveSpecifier(
  specifier: string,
  from: string,
  aliases: Aliases
): Promise<string | undefined> {
  for (const candidate of candidatePaths(specifier, from, aliases)) {
    const file = await resolveFile(candidate);
    if (file !== undefined) {
      return file;
    }
  }
  return undefined;
}

function isIndexFile(file: string): boolean {
  return path.basename(file, path.extname(file)) === 'index';
}

/** Every file that the tests import, directly or through index files that they import. */
async function filesReadBy(tests: readonly string[], aliases: Aliases): Promise<Set<string>> {
  const read = new Set<string>();
  const visited = new Set<string>();
  const queue = [...tests];
  while (queue.length > 0) {
    const from = queue.pop() as string;
    if (visited.has(from)) {
      continue;
    }
    visited.add(from);
    const code = await readFile(from, 'utf8').catch(() => '');
    for (const specifier of specifiersOf(code)) {
      const file = await resolveSpecifier(specifier, from, aliases);
      if (file === undefined) {
        continue;
      }
      read.add(file);
      if (isIndexFile(file)) {
        queue.push(file);
      }
    }
  }
  return read;
}

function report(
  unread: readonly string[],
  total: number,
  options: UnitTestsOptions,
  io: CommandIo
): number {
  const folders = options.dirs.join(', ');
  if (unread.length === 0) {
    io.out(`All ${total} files in ${folders} are imported by a unit test.\n`);
    return 0;
  }
  const names = unread.map((file) => path.relative(io.cwd, file).split(path.sep).join('/')).sort();
  io.err(
    [
      `${names.length} of ${total} files in ${folders} are not imported by any unit test (looked in ${options.testDirs.join(', ') || 'no test folder'} for *.test.* and *.spec.* files):`,
      ...names.map((name) => `  ${name}`),
      'Add a unit test that imports each file, or move the file out of the folder.',
      '',
    ].join('\n')
  );
  return 1;
}
