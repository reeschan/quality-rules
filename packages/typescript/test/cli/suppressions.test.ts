import { afterAll, describe, expect, it } from 'vitest';
import { projectPool, type TempProject } from './support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

const RULE = 'quality-rules/no-disable-comments';

/** A suppression comment that names no rule, which oxlint lets silence every rule. */
const BARE = ['/* oxlint-disable */', 'export const width = 320;', ''].join('\n');

/** One file with every kind of directive, each on its own line. */
const EVERY_DIRECTIVE = [
  'export function describeItem(name: string): string {',
  '  // eslint-disable-next-line no-console',
  '  console.log(name);',
  '  return name; // eslint-disable-line',
  '}',
  '/* eslint-disable no-alert */',
  '/* eslint-enable no-alert */',
  '// oxlint-disable-next-line no-debugger',
  'export const height = 240; // oxlint-disable-line',
  '/* oxlint-enable */',
  '// biome-ignore lint/style/useConst: reassigned by callers',
  'export let counter = 0;',
  '// biome-ignore-all lint/suspicious/noConsole: logging is allowed here',
  '/* biome-ignore-start lint/style/useConst: legacy block */',
  'export let total = 0;',
  '/* biome-ignore-end lint/style/useConst: legacy block */',
  '/*',
  '  eslint-disable no-alert',
  '*/',
  '',
].join('\n');

/** Directive text in strings, template literals and prose, which is not a suppression. */
const NOT_COMMENTS = [
  "export const single = '// eslint-disable-line no-console';",
  'export const double = "/* oxlint-disable */";',
  'export const template = `',
  '// biome-ignore lint/style/useConst: inside a template literal',
  '`;',
  '// eslint-disablement is a word, and so are biome-ignored and oxlint-disabled.',
  "export const quote = /'/; // eslint-disable-line",
  'export const half = 1 / 2; // oxlint-disable-line',
  '',
].join('\n');

/** A synced project with the given files and, by default, the pack lint-hygiene. */
async function suppressionsProject(
  files: Readonly<Record<string, string>>,
  manifest: object = { packs: ['lint-hygiene'] }
): Promise<TempProject> {
  const project = await pool.create();
  await project.installTypescriptPackage();
  await project.writeManifest(manifest);
  for (const [file, content] of Object.entries(files)) {
    await project.write(file, content);
  }
  const synced = await project.cli('sync');
  expect(synced.exitCode).toBe(0);
  return project;
}

/** The `file:line: directive` lines of the output. */
function findings(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => /^\S+:\d+: /.test(line));
}

describe('quality-rules suppressions', () => {
  it('fails on a suppression comment that names no rule', async () => {
    const project = await suppressionsProject({ 'src/bare.ts': BARE });

    const result = await project.cli('suppressions');

    expect(result.exitCode).toBe(1);
    expect(findings(result.stderr)).toEqual(['src/bare.ts:1: oxlint-disable']);
  });

  it('prints every eslint, oxlint and biome directive as file:line: directive', async () => {
    const project = await suppressionsProject({ 'src/every.ts': EVERY_DIRECTIVE });

    const result = await project.cli('suppressions');

    expect(result.exitCode).toBe(1);
    expect(findings(result.stderr)).toEqual([
      'src/every.ts:2: eslint-disable-next-line',
      'src/every.ts:4: eslint-disable-line',
      'src/every.ts:6: eslint-disable',
      'src/every.ts:7: eslint-enable',
      'src/every.ts:8: oxlint-disable-next-line',
      'src/every.ts:9: oxlint-disable-line',
      'src/every.ts:10: oxlint-enable',
      'src/every.ts:11: biome-ignore',
      'src/every.ts:13: biome-ignore-all',
      'src/every.ts:14: biome-ignore-start',
      'src/every.ts:16: biome-ignore-end',
      'src/every.ts:17: eslint-disable',
    ]);
  });

  it('reads comments only: not strings, template literals, regular expressions or prose', async () => {
    const project = await suppressionsProject({ 'src/strings.ts': NOT_COMMENTS });

    const result = await project.cli('suppressions');

    expect(result.exitCode).toBe(1);
    expect(findings(result.stderr)).toEqual([
      'src/strings.ts:7: eslint-disable-line',
      'src/strings.ts:8: oxlint-disable-line',
    ]);
  });

  it('lists the files in order and reads every JavaScript and TypeScript extension', async () => {
    const project = await suppressionsProject({
      'src/b.tsx': '// eslint-disable-next-line no-console\n',
      'src/a.mjs': '\n/* oxlint-disable */\n',
      'src/nested/c.cts': '// biome-ignore-all lint: reason\n',
      'src/readme.md': '<!-- eslint-disable -->\n// eslint-disable\n',
    });

    const result = await project.cli('suppressions');

    expect(findings(result.stderr)).toEqual([
      'src/a.mjs:2: oxlint-disable',
      'src/b.tsx:1: eslint-disable-next-line',
      'src/nested/c.cts:1: biome-ignore-all',
    ]);
  });

  it('passes when there is no suppression comment', async () => {
    const project = await suppressionsProject({
      'src/clean.ts': '// Disable the button while the request is pending.\nexport const a = 1;\n',
    });

    const result = await project.cli('suppressions');

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src');
  });
});

describe('the options', () => {
  it('reads src by default and the folders of the options otherwise', async () => {
    const project = await suppressionsProject({
      'src/clean.ts': 'export const a = 1;\n',
      'test/clean.test.ts': '/* oxlint-disable */\n',
    });

    const withDefaults = await project.cli('suppressions');
    await project.writeManifest({
      packs: ['lint-hygiene'],
      options: { [RULE]: { dirs: ['src', 'test'] } },
    });
    const withTest = await project.cli('suppressions');

    expect(withDefaults.exitCode).toBe(0);
    expect(withTest.exitCode).toBe(1);
    expect(findings(withTest.stderr)).toEqual(['test/clean.test.ts:1: oxlint-disable']);
  });

  it('stops with an error when a folder does not exist', async () => {
    const project = await suppressionsProject(
      { 'src/clean.ts': 'export const a = 1;\n' },
      { packs: ['lint-hygiene'], options: { [RULE]: { dirs: ['src/missing'] } } }
    );

    const result = await project.cli('suppressions');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('src/missing');
  });

  it('stops with an error when "dirs" is not a list of folders', async () => {
    const project = await suppressionsProject({ 'src/clean.ts': 'export const a = 1;\n' });
    await project.writeManifest({ packs: ['lint-hygiene'], options: { [RULE]: { dirs: [] } } });

    const result = await project.cli('suppressions');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('"dirs"');
  });
});

describe('when the rule is not in effect', () => {
  it('does nothing and says so when the rule is excluded', async () => {
    const project = await suppressionsProject(
      { 'src/bare.ts': BARE },
      { packs: ['lint-hygiene'], exclude: [RULE] }
    );

    const result = await project.cli('suppressions');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${RULE} is not in effect`);
    expect(result.stderr).toBe('');
  });

  it('does nothing and says so when the pack is not selected', async () => {
    const project = await suppressionsProject({ 'src/bare.ts': BARE }, { packs: ['naming'] });

    const result = await project.cli('suppressions');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${RULE} is not in effect`);
  });
});

describe('the help and check', () => {
  it('is listed in the help', async () => {
    const project = await pool.create();

    const result = await project.cli('--help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^ {2}suppressions +\S/m);
  });

  it('never runs the suppressions check: check passes on a project with a suppression', async () => {
    const project = await suppressionsProject({ 'src/bare.ts': BARE });
    expect((await project.cli('suppressions')).exitCode).toBe(1);

    const result = await project.cli('check');

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });
});
