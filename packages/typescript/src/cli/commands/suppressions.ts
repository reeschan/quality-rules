import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { QualityRulesError } from '../../catalog/conventions.ts';
import { isObject, loadCatalog } from '../../catalog/load.ts';
import { readManifest } from '../../manifest/manifest.ts';
import { resolve } from '../../resolve/resolve.ts';
import { suppressionDirectiveOf } from '../../rules/suppression-directive.ts';
import { commentsOf } from '../../source/comments.ts';
import { existingDirs, filesUnder, SOURCE_FILE } from '../../source/files.ts';
import type { CommandIo, CommandSpec } from '../main.ts';

/** ID of the rule whose directives this command finds, in `packs/lint-hygiene.json`. */
const RULE_ID = 'quality-rules/no-disable-comments';

/** The options of the rule, after the manifest's values are put over the defaults. */
interface SuppressionsOptions {
  readonly dirs: readonly string[];
}

/** One directive comment in a source file. */
interface Finding {
  /** Path relative to the project, with `/` separators. */
  readonly file: string;
  readonly line: number;
  readonly directive: string;
}

/**
 * `quality-rules suppressions`: fails when a source file of the chosen folders has an eslint,
 * oxlint or biome suppression directive in a comment, including the directives that end a
 * suppressed stretch. The linters cannot be relied on for this: a directive that names no rule,
 * such as `oxlint-disable`, also silences `quality-rules/no-disable-comments`, and oxlint has no
 * switch that turns such comments off. Only comments are read, not strings.
 */
export const suppressionsCommand: CommandSpec = {
  summary: 'Fail on lint suppression comments, which the linters cannot report themselves',
  options: {},
  async run(_values, io) {
    const catalog = await loadCatalog(io.cwd);
    const manifest = await readManifest(io.cwd);
    const resolution = resolve(catalog, manifest);
    const item = resolution.rules.find((entry) => entry.rule.id === RULE_ID);
    if (item === undefined || !item.active) {
      io.out(
        `${RULE_ID} is not in effect (pack "lint-hygiene" is not selected, or the rule is excluded or pending), so nothing was checked.\n`
      );
      return 0;
    }
    const options = readOptions(item.options);
    const dirs = await existingDirs(io.cwd, options.dirs);
    const files = await sourceFilesIn(dirs);
    const findings = (await Promise.all(files.map((file) => findingsIn(file, io.cwd)))).flat();
    return report(findings, files.length, options, io);
  },
};

function readOptions(options: unknown): SuppressionsOptions {
  const { dirs } = isObject(options) ? options : {};
  if (!isFolderList(dirs) || dirs.length === 0) {
    throw new QualityRulesError(
      `The options of ${RULE_ID} are wrong: "dirs" must be a list of folder names such as ["src"]`
    );
  }
  return { dirs };
}

function isFolderList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && entry !== '' && !entry.startsWith('-'))
  );
}

/** The JavaScript and TypeScript files of the folders, each once. */
async function sourceFilesIn(dirs: readonly string[]): Promise<string[]> {
  const all = (await Promise.all(dirs.map(filesUnder))).flat();
  return [...new Set(all)].filter((file) => SOURCE_FILE.test(file));
}

async function findingsIn(file: string, cwd: string): Promise<Finding[]> {
  const code = await readFile(file, 'utf8');
  const name = path.relative(cwd, file).split(path.sep).join('/');
  return commentsOf(code).flatMap((comment): Finding[] => {
    const directive = suppressionDirectiveOf(comment.text);
    return directive === undefined
      ? []
      : [{ file: name, line: comment.line, directive: directive.name }];
  });
}

function compareFindings(left: Finding, right: Finding): number {
  if (left.file !== right.file) {
    return left.file < right.file ? -1 : 1;
  }
  return left.line - right.line;
}

function report(
  findings: readonly Finding[],
  total: number,
  options: SuppressionsOptions,
  io: CommandIo
): number {
  const folders = options.dirs.join(', ');
  if (findings.length === 0) {
    io.out(`No lint suppression comment in the ${total} source files of ${folders}.\n`);
    return 0;
  }
  io.err(
    [
      `${findings.length} lint suppression comments in ${folders} (a directive that names no rule also silences ${RULE_ID}, so the linters do not report them all):`,
      ...[...findings]
        .sort(compareFindings)
        .map((finding) => `${finding.file}:${finding.line}: ${finding.directive}`),
      'Remove the comments and configure each exception in the lint configuration with a reason instead.',
      '',
    ].join('\n')
  );
  return 1;
}
