import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type * as JscpdModule from 'jscpd';
import { QualityRulesError } from '../../catalog/conventions.ts';
import { isObject, loadCatalog } from '../../catalog/load.ts';
import { readManifest } from '../../manifest/manifest.ts';
import { resolve } from '../../resolve/resolve.ts';
import type { CommandIo, CommandSpec } from '../main.ts';

/** ID of the rule that this command checks, in `packs/duplication.json`. */
const RULE_ID = 'jscpd/changed-lines-duplication';

/** The options of the rule, after the manifest's values are put over the defaults. */
interface DuplicationOptions {
  readonly baseBranch: string;
  readonly dirs: readonly string[];
}

/** Lines of one file, as `[first, last]` pairs (1-based, both included), or all of them. */
type ChangedLines = readonly (readonly [number, number])[] | 'all';

/** One duplicate that jscpd found, with both places. */
interface Clone {
  readonly lines: number;
  readonly tokens: number;
  readonly places: readonly [Place, Place];
}

/** A stretch of lines in a file of the project. */
interface Place {
  /** Path relative to the project, with `/` separators. */
  readonly file: string;
  readonly start: number;
  readonly end: number;
}

/** The commit that changes are counted from, and the name that the user knows it by. */
interface Base {
  readonly label: string;
  readonly mergeBase: string;
}

interface GitOutput {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const require = createRequire(import.meta.url);

/**
 * `quality-rules duplication`: finds duplicated code with jscpd and fails when a duplicate
 * touches a line changed since the merge-base with the base branch. Duplicates that were
 * already on the base branch do not fail it. It only reads from git (merge-base, diff, file
 * lists) and writes its jscpd report to a temporary folder, so the working tree, the index and
 * the branches stay as they are.
 */
export const duplicationCommand: CommandSpec = {
  summary: 'Fail on duplicated code that touches the lines changed since the base branch',
  options: {},
  async run(_values, io) {
    const catalog = await loadCatalog(io.cwd);
    const manifest = await readManifest(io.cwd);
    const resolution = resolve(catalog, manifest);
    const item = resolution.rules.find((entry) => entry.rule.id === RULE_ID);
    if (item === undefined || !item.active) {
      io.out(
        `${RULE_ID} is not in effect (pack "duplication" is not selected, or the rule is excluded or pending), so nothing was checked.\n`
      );
      return 0;
    }
    const options = readOptions(item.options);
    const dirs = await existingDirs(io.cwd, options.dirs);
    const base = await findBase(io.cwd, options.baseBranch);
    const changed = await changedLines(io.cwd, base.mergeBase);
    const clones = await findClones(io.cwd, dirs);
    const hits = clones.filter((clone) => touchesChange(clone, changed));
    return report(hits, base, io);
  },
};

function readOptions(options: unknown): DuplicationOptions {
  const problems: string[] = [];
  const values = isObject(options) ? options : {};
  const { baseBranch, dirs } = values;
  if (typeof baseBranch !== 'string' || baseBranch === '' || baseBranch.startsWith('-')) {
    problems.push('"baseBranch" must be a branch name such as "main"');
  }
  if (!Array.isArray(dirs) || dirs.length === 0 || !dirs.every(isFolderName)) {
    problems.push('"dirs" must be a list of folder names such as ["src"]');
  }
  if (problems.length > 0) {
    throw new QualityRulesError(`The options of ${RULE_ID} are wrong: ${problems.join('; ')}`);
  }
  return { baseBranch: baseBranch as string, dirs: dirs as string[] };
}

function isFolderName(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !value.startsWith('-');
}

/** The folders as absolute paths. Throws when one is missing or outside the project. */
async function existingDirs(cwd: string, dirs: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const dir of dirs) {
    const absolute = path.resolve(cwd, dir);
    const relative = path.relative(cwd, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new QualityRulesError(`The folder "${dir}" in "dirs" is outside the project`);
    }
    const info = await stat(absolute).catch(() => undefined);
    if (info === undefined || !info.isDirectory()) {
      throw new QualityRulesError(`The folder "${dir}" in "dirs" does not exist`);
    }
    found.push(await realpath(absolute));
  }
  return found;
}

function git(cwd: string, args: readonly string[]): Promise<GitOutput> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        maxBuffer: 256 * 1024 * 1024,
        // Reading must not refresh the index, which would write to .git.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      },
      (error, stdout, stderr) => {
        if (error !== null && typeof error.code !== 'number') {
          reject(new QualityRulesError(`Could not run git: ${error.message}`));
          return;
        }
        resolvePromise({ code: error === null ? 0 : Number(error.code), stdout, stderr });
      }
    );
  });
}

async function gitOrFail(cwd: string, args: readonly string[]): Promise<string> {
  const result = await git(cwd, args);
  if (result.code !== 0) {
    throw new QualityRulesError(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/**
 * Picks the base: the remote-tracking branch of the name (such as `origin/main`) when there
 * is one, else the local branch. Returns the merge-base of that branch and HEAD.
 */
async function findBase(cwd: string, branch: string): Promise<Base> {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0) {
    throw new QualityRulesError(`${cwd} is not inside a git repository`);
  }
  const remotes = (await gitOrFail(cwd, ['remote'])).split('\n').filter((line) => line !== '');
  const candidates = [
    ...[...new Set(['origin', ...remotes])].map((remote) => `refs/remotes/${remote}/${branch}`),
    `refs/remotes/${branch}`,
    `refs/heads/${branch}`,
  ];
  for (const ref of candidates) {
    const exists = await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (exists.code !== 0) {
      continue;
    }
    const mergeBase = await git(cwd, ['merge-base', ref, 'HEAD']);
    if (mergeBase.code !== 0) {
      throw new QualityRulesError(
        `${ref} and HEAD have no common commit (a shallow clone needs more history, for example fetch-depth: 0)`
      );
    }
    return {
      label: ref.replace(/^refs\/(?:remotes|heads)\//, ''),
      mergeBase: mergeBase.stdout.trim(),
    };
  }
  throw new QualityRulesError(
    `The base branch "${branch}" does not exist (looked for ${candidates.join(', ')}); set "baseBranch" in the options of ${RULE_ID}`
  );
}

/**
 * The lines that differ from the merge-base: tracked files compared with the working tree
 * (committed and uncommitted changes), and untracked files as a whole.
 */
async function changedLines(cwd: string, mergeBase: string): Promise<Map<string, ChangedLines>> {
  const diff = await gitOrFail(cwd, [
    '-c',
    'core.quotePath=false',
    'diff',
    '--relative',
    '-U0',
    '--no-color',
    '--no-ext-diff',
    '--no-renames',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    mergeBase,
    '--',
  ]);
  const changed = parseDiff(diff);
  const untracked = await gitOrFail(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  for (const file of untracked.split('\0').filter((name) => name !== '')) {
    changed.set(file, 'all');
  }
  return changed;
}

/** Reads the added lines of each file from the output of `git diff -U0`. */
function parseDiff(diff: string): Map<string, ChangedLines> {
  const changed = new Map<string, [number, number][]>();
  let current: [number, number][] | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const name = line.slice('+++ '.length);
      current = name.startsWith('b/') ? [] : undefined;
      if (current !== undefined) {
        changed.set(name.slice('b/'.length), current);
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk !== null && current !== undefined) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (count > 0) {
        current.push([start, start + count - 1]);
      }
    }
  }
  return changed;
}

/** Runs jscpd on the folders and reads its JSON report from a temporary folder. */
async function findClones(cwd: string, dirs: readonly string[]): Promise<Clone[]> {
  const { runJscpd } = require('jscpd') as typeof JscpdModule;
  const out = await mkdtemp(path.join(os.tmpdir(), 'quality-rules-jscpd-'));
  try {
    const run = runJscpd(
      [
        '--reporters',
        'json',
        '--output',
        out,
        '--absolute',
        '--silent',
        '--no-tips',
        '--no-colors',
        ...dirs,
      ],
      { cwd, encoding: 'utf8' }
    );
    if (run.error !== undefined || run.status !== 0) {
      throw new QualityRulesError(
        `jscpd failed: ${run.error?.message ?? ''}${run.stderr}${run.stdout}`.trim()
      );
    }
    const text = await readFile(path.join(out, 'jscpd-report.json'), 'utf8');
    return readClones(JSON.parse(text), await realpath(cwd));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

function readClones(report: unknown, root: string): Clone[] {
  const duplicates = isObject(report) && Array.isArray(report.duplicates) ? report.duplicates : [];
  return duplicates.flatMap((entry: unknown): Clone[] => {
    if (!isObject(entry)) {
      return [];
    }
    const first = readPlace(entry.firstFile, root);
    const second = readPlace(entry.secondFile, root);
    if (first === undefined || second === undefined) {
      return [];
    }
    return [{ lines: Number(entry.lines), tokens: Number(entry.tokens), places: [first, second] }];
  });
}

function readPlace(value: unknown, root: string): Place | undefined {
  if (!(isObject(value) && typeof value.name === 'string')) {
    return undefined;
  }
  // jscpd prints absolute paths on Windows in the extended form `\\?\C:\...`.
  const name = value.name.replace(/^\\\\\?\\/, '');
  const relative = path.relative(root, path.resolve(root, name));
  return {
    file: relative.split(path.sep).join('/'),
    start: Number(value.start),
    end: Number(value.end),
  };
}

function touchesChange(clone: Clone, changed: ReadonlyMap<string, ChangedLines>): boolean {
  return clone.places.some((place) => {
    const lines = changed.get(place.file);
    if (lines === undefined) {
      return false;
    }
    return (
      lines === 'all' || lines.some(([first, last]) => first <= place.end && place.start <= last)
    );
  });
}

function report(hits: readonly Clone[], base: Base, io: CommandIo): number {
  const since = `the merge-base of ${base.label} and HEAD (${base.mergeBase.slice(0, 7)})`;
  if (hits.length === 0) {
    io.out(`No duplicate touches the lines changed since ${since}.\n`);
    return 0;
  }
  const place = (item: Place) => `${item.file}:${item.start}-${item.end}`;
  io.err(
    [
      `Duplicated code touches the lines changed since ${since}:`,
      ...hits.map(
        (clone) =>
          `  ${place(clone.places[0])} duplicates ${place(clone.places[1])} (${clone.lines} lines, ${clone.tokens} tokens)`
      ),
      'Remove the duplicate, for example by moving the shared code into one function.',
      '',
    ].join('\n')
  );
  return 1;
}
