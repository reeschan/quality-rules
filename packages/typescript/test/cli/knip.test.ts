import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageDir, projectPool, runNode, type TempProject } from './support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

const KNIP_RULES = [
  'knip/files',
  'knip/dependencies',
  'knip/unlisted',
  'knip/exports',
  'knip/duplicates',
];

/** The project's own knip configuration: the preset first, then its entry and ignore. */
const PROJECT_KNIP_CONFIG = [
  "import preset from './quality-rules/knip.mjs';",
  '',
  'export default {',
  '  ...preset,',
  "  entry: ['src/main.ts'],",
  "  ignore: ['src/legacy/**'],",
  '};',
  '',
].join('\n');

/** One issue that knip reports, as `type: file name`. */
type Issue = string;

interface KnipResult {
  readonly exitCode: number;
  readonly issues: Issue[];
}

async function knipBin(): Promise<string> {
  const dir = path.join(packageDir, 'node_modules', 'knip');
  const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
    bin: Record<string, string>;
  };
  return path.join(dir, manifest.bin.knip ?? '');
}

/** Runs the real knip on the project with its configuration and lists the issues it reports. */
async function knip(project: TempProject): Promise<KnipResult> {
  const result = await runNode([await knipBin(), '--reporter', 'json'], project.dir);
  const start = result.stdout.indexOf('{');
  if (start === -1) {
    throw new Error(`knip failed (exit ${result.exitCode}):\n${result.stderr}${result.stdout}`);
  }
  const report = JSON.parse(result.stdout.slice(start)) as {
    issues: ({ file: string } & Record<string, unknown>)[];
  };
  const issues = report.issues.flatMap((entry) =>
    Object.entries(entry)
      .filter((pair): pair is [string, { name: string }[]] => Array.isArray(pair[1]))
      .flatMap(([type, items]) => items.map((item) => `${type}: ${entry.file} ${item.name}`))
  );
  return { exitCode: result.exitCode, issues: issues.sort() };
}

/**
 * A project that lints with the generated oxlint configuration and checks unused code with
 * knip: one entry file, a used file with an unused export, an unused file and an ignored one.
 */
async function knipProject(manifest: object): Promise<TempProject> {
  const project = await pool.create();
  await project.installTypescriptPackage();
  // oxlint as installed, so that knip finds the package of the `oxlint` executable.
  await project.write('node_modules/oxlint/package.json', {
    name: 'oxlint',
    version: '1.0.0',
    bin: { oxlint: 'bin/oxlint' },
  });
  await project.addDependency('oxlint', '1.0.0');
  await project.write('package.json', {
    ...(await project.readJson<Record<string, unknown>>('package.json')),
    scripts: { lint: 'oxlint' },
  });
  await project.writeManifest(manifest);
  await project.write('.oxlintrc.json', { extends: ['./quality-rules/oxlint.json'] });
  await project.write('knip.config.js', PROJECT_KNIP_CONFIG);
  await project.write(
    'src/main.ts',
    "import { used } from './used.ts';\n\nexport const main = (): number => used;\n"
  );
  await project.write('src/used.ts', 'export const used = 1;\nexport const spare = 2;\n');
  await project.write('src/unused.ts', 'export const nobody = 3;\n');
  await project.write('src/legacy/old.ts', 'export const old = 4;\n');
  return project;
}

async function sync(project: TempProject): Promise<string> {
  const result = await project.cli('sync');
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return result.stdout;
}

/** Loads the generated preset in a separate Node process, as the project's configuration does. */
async function loadPreset(project: TempProject): Promise<Record<string, unknown>> {
  const url = pathToFileURL(project.path('quality-rules/knip.mjs')).href;
  const script = `process.stdout.write(JSON.stringify((await import(${JSON.stringify(url)})).default));`;
  const result = await runNode(['--input-type=module', '--eval', script], project.dir);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe('the unused-code pack in the list', () => {
  it('lists the knip rules, each with its own ID', async () => {
    const project = await pool.create();
    await project.installTypescriptPackage();

    const result = await project.cli('list', '--json');

    const list = JSON.parse(result.stdout) as {
      packs: { name: string; rules: { id: string; tool: string }[] }[];
    };
    const unusedCode = list.packs.find((pack) => pack.name === 'unused-code');
    expect(unusedCode?.rules.map((rule) => rule.id)).toEqual(KNIP_RULES);
    expect(unusedCode?.rules.every((rule) => rule.tool === 'knip')).toBe(true);
  });
});

describe('quality-rules sync with the unused-code pack on real knip', () => {
  let project: TempProject;
  let output: string;

  beforeAll(async () => {
    project = await knipProject({ packs: ['unused-code', 'lint-hygiene'] });
    output = await sync(project);
  });

  it('creates quality-rules/knip.mjs, a JavaScript module whose default export is the preset', async () => {
    expect(output).toContain('Created quality-rules/knip.mjs');
    expect(output).toContain(
      'knip.config.js: import the preset from "./quality-rules/knip.mjs" and export { ...preset, entry, ignore }'
    );
    const preset = await loadPreset(project);
    expect(preset).toEqual({
      rules: {
        files: 'error',
        dependencies: 'error',
        devDependencies: 'error',
        optionalPeerDependencies: 'error',
        unlisted: 'error',
        binaries: 'error',
        unresolved: 'error',
        exports: 'error',
        nsExports: 'error',
        types: 'error',
        nsTypes: 'error',
        enumMembers: 'error',
        namespaceMembers: 'error',
        duplicates: 'error',
      },
    });
    expect(preset).not.toHaveProperty('entry');
    expect(preset).not.toHaveProperty('ignore');
  });

  it("reports unused files and exports with the project's entry and ignore", async () => {
    const result = await knip(project);

    expect(result.issues).toEqual([
      'exports: src/used.ts spare',
      'files: src/unused.ts src/unused.ts',
    ]);
    expect(result.exitCode).toBe(1);
  });

  it('never passes check while knip.mjs is edited by hand', async () => {
    const file = 'quality-rules/knip.mjs';
    const generated = await project.read(file);
    const edited = generated.replace(/files: (['"])error/, 'files: $1off');
    expect(edited).not.toBe(generated);
    await project.write(file, edited);

    const result = await project.cli('check');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `${file} differs from what sync generates (generated files must not be edited by hand)`
    );
    await project.write(file, generated);
    expect((await project.cli('check')).exitCode).toBe(0);
  });
});

describe('knip.mjs with rules left out', () => {
  it('turns the issue types of an excluded rule off, so knip does not report them', async () => {
    const project = await knipProject({
      packs: ['unused-code', 'lint-hygiene'],
      exclude: ['knip/exports'],
    });
    await sync(project);

    const preset = (await loadPreset(project)) as { rules: Record<string, string> };
    const result = await knip(project);

    expect(preset.rules).toMatchObject({ exports: 'off', types: 'off', files: 'error' });
    expect(result.issues).toEqual(['files: src/unused.ts src/unused.ts']);
  });

  it('is an empty preset when the unused-code pack is not selected', async () => {
    const project = await knipProject({ packs: ['lint-hygiene'] });
    await sync(project);

    expect(await loadPreset(project)).toEqual({});
  });
});
