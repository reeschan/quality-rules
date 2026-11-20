import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as typescriptParser from '@typescript-eslint/parser';
import { ESLint, type Linter, type Rule } from 'eslint';

/** One diagnostic, in the same shape for oxlint and ESLint. Lines and columns start at 1. */
export interface LintFinding {
  /** Path of the fixture file relative to the fixtures folder, with `/` separators. */
  readonly file: string;
  readonly line: number;
  /** Column in UTF-16 code units, as ESLint counts it. */
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  /** `<plugin>/<rule>`, or `null` for diagnostics that no rule reported (parse errors). */
  readonly ruleId: string | null;
  readonly message: string;
}

export interface FixtureRunOptions {
  /**
   * Module whose named export `rules` is the rule table (rule name without prefix to rule).
   * oxlint loads it in its own process, so it must be a file that Node can import.
   */
  readonly rulesModule: string | URL;
  /** Plugin name, used as the rule id prefix (`<pluginName>/<rule>`). */
  readonly pluginName: string;
  /** Folder of fixture files. Every JavaScript or TypeScript file under it is linted. */
  readonly fixturesDir: string | URL;
  /** Options per rule name (without prefix). Every rule in the table is enabled as an error. */
  readonly ruleOptions?: Readonly<Record<string, readonly unknown[]>>;
}

export interface FixtureRunResult {
  readonly oxlint: readonly LintFinding[];
  readonly eslint: readonly LintFinding[];
}

type RuleTable = Readonly<Record<string, Rule.RuleModule>>;

interface RunContext {
  readonly rulesUrl: string;
  readonly pluginName: string;
  readonly fixturesDir: string;
  readonly files: readonly string[];
  readonly ruleSettings: Readonly<Record<string, unknown[]>>;
  readonly rules: RuleTable;
}

interface OxlintSpan {
  readonly offset: number;
  readonly length: number;
}

interface OxlintDiagnostic {
  readonly message: string;
  readonly code?: string;
  readonly filename: string;
  readonly labels?: readonly { readonly span: OxlintSpan }[];
}

const FIXTURE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const LINE_BREAK = /\r\n|[\r\n\u{2028}\u{2029}]/u;
const OXLINT_CODE = /^(?<plugin>[^()]+)\((?<rule>.+)\)$/;
const runnerPackageDir = path.resolve(fileURLToPath(import.meta.url), '..', '..');

/**
 * Lints the fixtures with oxlint (through `jsPlugins`) and with ESLint, enabling every rule of
 * the table, and returns both sets of findings sorted by file and position.
 */
export async function lintFixtures(options: FixtureRunOptions): Promise<FixtureRunResult> {
  const context = await createRunContext(options);
  const [oxlint, eslint] = await Promise.all([runOxlint(context), runEslint(context)]);
  return { oxlint, eslint };
}

async function createRunContext(options: FixtureRunOptions): Promise<RunContext> {
  const rulesUrl = toFileUrl(options.rulesModule);
  const fixturesDir = toPath(options.fixturesDir);
  const rules = await loadRuleTable(rulesUrl);
  const ruleSettings: Record<string, unknown[]> = {};
  for (const name of Object.keys(rules)) {
    ruleSettings[`${options.pluginName}/${name}`] = [
      'error',
      ...(options.ruleOptions?.[name] ?? []),
    ];
  }
  const files = await listFixtureFiles(fixturesDir);
  if (files.length === 0) {
    throw new Error(`No fixture files found in ${fixturesDir}`);
  }
  return { rulesUrl, pluginName: options.pluginName, fixturesDir, files, ruleSettings, rules };
}

async function loadRuleTable(rulesUrl: string): Promise<RuleTable> {
  const loaded: { rules?: unknown } = await import(rulesUrl);
  if (typeof loaded.rules !== 'object' || loaded.rules === null) {
    throw new Error(`${rulesUrl} does not export a rule table named "rules"`);
  }
  return loaded.rules as RuleTable;
}

async function listFixtureFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && FIXTURE_EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => toRelativeFile(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

async function runOxlint(context: RunContext): Promise<LintFinding[]> {
  const cacheDir = path.join(runnerPackageDir, 'node_modules', '.cache', 'lint-fixture-runner');
  await mkdir(cacheDir, { recursive: true });
  const workDir = await mkdtemp(path.join(cacheDir, 'oxlint-'));
  try {
    const pluginFile = path.join(workDir, 'plugin.mjs');
    await writeFile(
      pluginFile,
      [
        `import { rules } from ${JSON.stringify(context.rulesUrl)};`,
        `export default { meta: { name: ${JSON.stringify(context.pluginName)} }, rules };`,
        '',
      ].join('\n')
    );
    const configFile = path.join(workDir, '.oxlintrc.json');
    const config = {
      plugins: [],
      categories: { correctness: 'off' },
      jsPlugins: ['./plugin.mjs'],
      rules: context.ruleSettings,
    };
    await writeFile(configFile, JSON.stringify(config, null, 2));
    const output = await runNode(
      [
        resolveOxlintBin(),
        '--config',
        configFile,
        '--format',
        'json',
        '--disable-nested-config',
        ...context.files,
      ],
      context.fixturesDir
    );
    const report = JSON.parse(output) as { diagnostics: OxlintDiagnostic[] };
    const findings = await Promise.all(
      report.diagnostics.map((diagnostic) => toOxlintFinding(context.fixturesDir, diagnostic))
    );
    return sortFindings(findings);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function toOxlintFinding(
  fixturesDir: string,
  diagnostic: OxlintDiagnostic
): Promise<LintFinding> {
  const filePath = path.resolve(fixturesDir, diagnostic.filename);
  const text = await readFile(filePath, 'utf8');
  const span = diagnostic.labels?.[0]?.span ?? { offset: 0, length: 0 };
  const start = positionAtByteOffset(text, span.offset);
  const end = positionAtByteOffset(text, span.offset + span.length);
  return {
    file: toRelativeFile(fixturesDir, filePath),
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    ruleId: toRuleId(diagnostic.code),
    message: diagnostic.message,
  };
}

/** oxlint reports `plugin(rule)` and UTF-8 byte offsets; ESLint reports `plugin/rule` and UTF-16 columns. */
function toRuleId(code: string | undefined): string | null {
  const groups = OXLINT_CODE.exec(code ?? '')?.groups;
  if (groups?.plugin === undefined || groups.rule === undefined) {
    return null;
  }
  return groups.plugin === 'eslint' ? groups.rule : `${groups.plugin}/${groups.rule}`;
}

function positionAtByteOffset(text: string, byteOffset: number): { line: number; column: number } {
  const before = Buffer.from(text, 'utf8').subarray(0, byteOffset).toString('utf8');
  const lines = before.split(LINE_BREAK);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

async function runEslint(context: RunContext): Promise<LintFinding[]> {
  const config: Linter.Config = {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    languageOptions: {
      parser: typescriptParser as Linter.Parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: { [context.pluginName]: { rules: { ...context.rules } } },
    rules: context.ruleSettings as Linter.RulesRecord,
  };
  const eslint = new ESLint({
    cwd: context.fixturesDir,
    overrideConfigFile: true,
    overrideConfig: [config],
  });
  const results = await eslint.lintFiles([...context.files]);
  const findings = results.flatMap((result) =>
    result.messages.map(
      (message): LintFinding => ({
        file: toRelativeFile(context.fixturesDir, result.filePath),
        line: message.line,
        column: message.column,
        endLine: message.endLine ?? message.line,
        endColumn: message.endColumn ?? message.column,
        ruleId: message.ruleId,
        message: message.message,
      })
    )
  );
  return sortFindings(findings);
}

function runNode(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [...args],
      { cwd, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // oxlint exits with 1 when it reports diagnostics; anything else is a failure to run.
        const exitCode = error === null ? 0 : error.code;
        if (exitCode !== 0 && exitCode !== 1) {
          reject(new Error(`oxlint failed (exit ${String(exitCode)}):\n${stderr}${stdout}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function resolveOxlintBin(): string {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve('oxlint/package.json');
  const manifest = require(manifestPath) as { bin: string | Record<string, string> };
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.oxlint;
  if (bin === undefined) {
    throw new Error('The oxlint package does not declare an oxlint executable');
  }
  return path.join(path.dirname(manifestPath), bin);
}

function sortFindings(findings: LintFinding[]): LintFinding[] {
  return findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.column - b.column ||
      (a.ruleId ?? '').localeCompare(b.ruleId ?? '')
  );
}

function toRelativeFile(dir: string, filePath: string): string {
  return path.relative(dir, filePath).split(path.sep).join('/');
}

function toPath(location: string | URL): string {
  return location instanceof URL ? fileURLToPath(location) : path.resolve(location);
}

function toFileUrl(location: string | URL): string {
  return location instanceof URL ? location.href : pathToFileURL(path.resolve(location)).href;
}
