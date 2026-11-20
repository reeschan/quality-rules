import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  packageDir,
  projectPool,
  runNode,
  sampleV1Dir,
  type TempProject,
  typescriptPackageName,
} from './support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

const TYPESCRIPT_PACKS = ['baseline', 'size-limits', 'lint-hygiene', 'centralize', 'naming'];

interface Manifest {
  packages: Record<string, string>;
  resolved: string[];
}

interface OxlintConfig {
  plugins?: string[];
  jsPlugins: string[];
  rules: Record<string, unknown>;
}

interface BiomeConfig {
  root: boolean;
  formatter?: Record<string, unknown>;
  javascript?: { formatter?: Record<string, unknown> };
  linter?: { rules?: Record<string, unknown> };
}

async function typescriptProject(manifest: object): Promise<TempProject> {
  const project = await pool.create();
  await project.installTypescriptPackage();
  await project.writeManifest(manifest);
  return project;
}

async function sampleProject(manifest: object): Promise<TempProject> {
  const project = await pool.create();
  await project.installPackage(sampleV1Dir);
  await project.writeManifest(manifest);
  return project;
}

async function sync(project: TempProject): Promise<string> {
  const result = await project.cli('sync');
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return result.stdout;
}

function oxlintConfig(project: TempProject): Promise<OxlintConfig> {
  return project.readJson<OxlintConfig>('quality-rules/oxlint.json');
}

/** Loads the generated plugin in a separate Node process, as oxlint does. */
async function loadGeneratedPlugin(
  project: TempProject
): Promise<{ name: string; rules: string[] }> {
  const url = pathToFileURL(project.path('quality-rules/oxlint-plugin.mjs')).href;
  const script = [
    `const plugin = (await import(${JSON.stringify(url)})).default;`,
    'process.stdout.write(JSON.stringify({ name: plugin.meta.name, rules: Object.keys(plugin.rules).sort() }));',
  ].join('\n');
  const result = await runNode(['--input-type=module', '--eval', script], project.dir);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout) as { name: string; rules: string[] };
}

async function typescriptVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8')) as {
    version: string;
  };
  return manifest.version;
}

describe('quality-rules sync on a first intake of every TypeScript pack', () => {
  let project: TempProject;
  let output: string;

  beforeAll(async () => {
    project = await typescriptProject({ packs: TYPESCRIPT_PACKS });
    output = await sync(project);
  });

  it('creates biome.json, oxlint.json and oxlint-plugin.mjs in quality-rules/', async () => {
    for (const file of ['biome.json', 'oxlint.json', 'oxlint-plugin.mjs']) {
      expect(output).toContain(`Created quality-rules/${file}`);
      await expect(project.read(`quality-rules/${file}`)).resolves.not.toBe('');
    }
  });

  it('puts every rule and convention of the selected packs in resolved, and the synced versions in packages', async () => {
    const manifest = await project.readJson<Manifest>('quality-rules.json');
    const list = JSON.parse((await project.cli('list', '--json')).stdout) as {
      packs: { name: string; rules: { id: string }[]; conventions: { id: string }[] }[];
    };
    const expected = list.packs
      .filter((pack) => TYPESCRIPT_PACKS.includes(pack.name))
      .flatMap((pack) => [...pack.rules, ...pack.conventions].map((item) => item.id));

    expect([...manifest.resolved].sort()).toEqual([...expected].sort());
    expect(manifest.resolved).toEqual(
      expect.arrayContaining([
        'biome/recommended',
        'max-params',
        'no-ternary',
        'quality-rules/no-scientific-literal',
        'quality-rules/no-boolean-argument',
      ])
    );
    expect(manifest.packages).toEqual({ [typescriptPackageName]: await typescriptVersion() });
  });

  it('writes the size-limits defaults into oxlint.json', async () => {
    const { rules } = await oxlintConfig(project);

    expect(rules['max-lines-per-function']).toEqual([
      'error',
      { max: 100, skipBlankLines: true, skipComments: true },
    ]);
    expect(rules['max-lines']).toEqual(['error', { max: 400 }]);
    expect(rules['max-params']).toEqual(['error', { max: 4 }]);
    expect(rules['max-depth']).toEqual(['error', { max: 4 }]);
  });

  it('writes the baseline lint rules and formatting into biome.json', async () => {
    const biome = await project.readJson<BiomeConfig>('quality-rules/biome.json');

    expect(biome.root).toBe(false);
    expect(biome.linter?.rules).toEqual({
      preset: 'recommended',
      suspicious: {
        noConsole: 'error',
        noExplicitAny: 'error',
        noDoubleEquals: 'error',
        noArrayIndexKey: 'error',
      },
      style: { noNestedTernary: 'error', noParameterAssign: 'error' },
    });
    expect(biome.formatter).toMatchObject({ indentStyle: 'space', lineWidth: 100 });
    expect(biome.javascript?.formatter).toEqual({ quoteStyle: 'single', trailingCommas: 'es5' });
  });

  it('writes the lint-hygiene rules into oxlint.json', async () => {
    const config = await oxlintConfig(project);

    expect(config.plugins).toEqual(['import']);
    expect(config.jsPlugins).toEqual(['./oxlint-plugin.mjs']);
    expect(config.rules['no-ternary']).toBe('error');
    expect(config.rules['no-warning-comments']).toEqual([
      'error',
      { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'anywhere' },
    ]);
    expect(config.rules['import/no-relative-parent-imports']).toBe('error');
    expect(config.rules['quality-rules/no-disable-comments']).toBe('error');
  });

  it('turns on the centralize and naming rules, which the generated plugin provides', async () => {
    const { rules } = await oxlintConfig(project);
    expect(rules['quality-rules/no-scientific-literal']).toEqual(['error', { allowFiles: [] }]);
    expect(rules['quality-rules/no-range-bound-comparison']).toEqual(['error', { allowFiles: [] }]);
    expect(rules['quality-rules/no-boolean-argument']).toEqual([
      'error',
      { allowFunctions: [], allowNamePatterns: [] },
    ]);

    const plugin = await loadGeneratedPlugin(project);
    expect(plugin.name).toBe('quality-rules');
    expect(plugin.rules).toEqual(
      expect.arrayContaining([
        'no-boolean-argument',
        'no-disable-comments',
        'no-range-bound-comparison',
        'no-scientific-literal',
      ])
    );
  });
});

describe('quality-rules sync with a manifest', () => {
  it('leaves the rules of packs that are not selected out of the generated files', async () => {
    const project = await typescriptProject({ packs: ['size-limits'] });
    await sync(project);

    const biome = await project.readJson<BiomeConfig>('quality-rules/biome.json');
    const { rules } = await oxlintConfig(project);
    const manifest = await project.readJson<Manifest>('quality-rules.json');

    expect(biome).toEqual({ root: false });
    expect(Object.keys(rules).sort()).toEqual([
      'max-depth',
      'max-lines',
      'max-lines-per-function',
      'max-params',
    ]);
    expect(manifest.resolved).toEqual([
      'max-depth',
      'max-lines',
      'max-lines-per-function',
      'max-params',
    ]);
  });

  it('writes options that override the defaults into the generated files', async () => {
    const project = await typescriptProject({
      packs: ['size-limits', 'centralize', 'baseline'],
      options: {
        'max-params': 5,
        'quality-rules/no-scientific-literal': { allowFiles: ['src/constants/**'] },
        'biome/formatter': { lineWidth: 120 },
      },
    });
    await sync(project);

    const { rules } = await oxlintConfig(project);
    const biome = await project.readJson<BiomeConfig>('quality-rules/biome.json');

    expect(rules['max-params']).toEqual(['error', { max: 5 }]);
    expect(rules['quality-rules/no-scientific-literal']).toEqual([
      'error',
      { allowFiles: ['src/constants/**'] },
    ]);
    expect(rules['quality-rules/no-range-bound-comparison']).toEqual(['error', { allowFiles: [] }]);
    expect(biome.formatter?.lineWidth).toBe(120);
  });

  it('rejects options of the wrong shape', async () => {
    const project = await typescriptProject({
      packs: ['size-limits'],
      options: { 'max-params': { max: 5 } },
    });

    const result = await project.cli('sync');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('"options" for max-params must be like 4');
  });

  it('turns excluded rules off in the generated files and leaves them out of resolved', async () => {
    const project = await typescriptProject({
      packs: ['size-limits', 'baseline'],
      exclude: ['max-params', 'biome/noConsole'],
    });
    const output = await sync(project);

    const { rules } = await oxlintConfig(project);
    const biome = await project.readJson<BiomeConfig>('quality-rules/biome.json');
    const manifest = await project.readJson<Manifest>('quality-rules.json');

    expect(rules['max-params']).toBe('off');
    expect(biome.linter?.rules?.suspicious).toMatchObject({ noConsole: 'off' });
    expect(manifest.resolved).not.toContain('max-params');
    expect(manifest.resolved).not.toContain('biome/noConsole');
    expect(manifest.resolved).toContain('max-depth');
    expect(output).toContain('Left out: biome/noConsole, max-params');
  });

  it("lays out the generated files as Biome's defaults when baseline's formatting is not taken", async () => {
    const project = await typescriptProject({ packs: ['size-limits', 'naming'] });
    await project.write('biome.json', { extends: ['./quality-rules/biome.json'] });
    await sync(project);

    expect(await project.read('quality-rules/oxlint.json')).toContain(
      '\t"jsPlugins": ["./oxlint-plugin.mjs"],'
    );
    expect(await project.biome('quality-rules', 'quality-rules.json')).toEqual([]);
  });

  it('never keeps the rules of an excluded convention unless include takes them back', async () => {
    const project = await sampleProject({ packs: ['guards'], exclude: ['FIX-901'] });
    await project.write('.oxlintrc.json', { extends: ['./quality-rules/oxlint.json'] });
    await project.write(
      'src/debug.ts',
      'export function show(value: number) {\n  console.log(value);\n  debugger;\n}\n'
    );
    await sync(project);

    const excluded = await oxlintConfig(project);
    expect(excluded.rules['no-console']).toBe('off');
    expect(excluded.rules['no-debugger']).toBe('off');
    expect((await project.readJson<Manifest>('quality-rules.json')).resolved).toEqual([
      'quality-rules/no-sample-call',
    ]);
    expect(await project.oxlint('src')).toEqual([]);

    await project.writeManifest({
      packs: ['guards'],
      exclude: ['FIX-901'],
      include: ['no-console'],
    });
    await sync(project);

    const included = await oxlintConfig(project);
    expect(included.rules['no-console']).toBe('error');
    expect(included.rules['no-debugger']).toBe('off');
    expect((await project.readJson<Manifest>('quality-rules.json')).resolved).toEqual([
      'no-console',
      'quality-rules/no-sample-call',
    ]);
    const findings = await project.oxlint('src');
    expect(findings.map((finding) => finding.code)).toEqual(['eslint(no-console)']);
  });

  it('takes a pack that has conventions only', async () => {
    const project = await sampleProject({ packs: ['talk'] });
    await sync(project);

    const manifest = await project.readJson<Manifest>('quality-rules.json');
    const { rules } = await oxlintConfig(project);

    expect(manifest.resolved).toEqual(['UX-901']);
    expect(rules).toEqual({});
  });

  it('rejects a pack that no installed package has', async () => {
    const project = await sampleProject({ packs: ['guards', 'nope'] });

    const result = await project.cli('sync');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('pack "nope" is not in the installed packages');
  });

  it('rejects an ID in exclude that no installed package has', async () => {
    const project = await sampleProject({ packs: ['guards'], exclude: ['no-such-rule'] });

    const result = await project.cli('sync');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('"exclude" names no-such-rule');
  });

  it('collects the custom rules of every installed package into one plugin', async () => {
    const project = await pool.create();
    await project.installTypescriptPackage();
    await project.installPackage(sampleV1Dir);
    await project.writeManifest({ packs: ['naming', 'guards'] });
    await project.write('.oxlintrc.json', { extends: ['./quality-rules/oxlint.json'] });
    await project.write(
      'src/main.ts',
      'declare function sample(flag: boolean): void;\nsample(true);\n'
    );
    await sync(project);

    const plugin = await loadGeneratedPlugin(project);
    const findings = await project.oxlint('src');

    expect(plugin.rules).toEqual(expect.arrayContaining(['no-boolean-argument', 'no-sample-call']));
    expect(findings.map((finding) => finding.code).sort()).toEqual([
      'quality-rules(no-boolean-argument)',
      'quality-rules(no-sample-call)',
    ]);
  });
});

describe('quality-rules sync and the project configuration', () => {
  it('does not edit the project configuration and gives the extends lines on the first sync only', async () => {
    const project = await typescriptProject({ packs: ['baseline', 'size-limits'] });
    const biomeConfig = '{ "formatter": { "enabled": true } }\n';
    const oxlintConfigText = '{ "rules": {} }\n';
    await project.write('biome.json', biomeConfig);
    await project.write('.oxlintrc.json', oxlintConfigText);

    const first = await sync(project);
    const second = await sync(project);

    expect(first).toContain('biome.json: add "extends": ["./quality-rules/biome.json"]');
    expect(first).toContain('.oxlintrc.json: add "extends": ["./quality-rules/oxlint.json"]');
    expect(second).not.toContain('add "extends"');
    expect(second).toContain('Unchanged quality-rules/oxlint.json');
    expect(await project.read('biome.json')).toBe(biomeConfig);
    expect(await project.read('.oxlintrc.json')).toBe(oxlintConfigText);
  });
});

describe('the generated configuration on real oxlint and Biome', () => {
  let project: TempProject;

  beforeAll(async () => {
    project = await typescriptProject({
      packs: TYPESCRIPT_PACKS,
      exclude: ['max-params', 'biome/noConsole'],
    });
    await project.write('biome.json', { extends: ['./quality-rules/biome.json'] });
    await project.write('.oxlintrc.json', { extends: ['./quality-rules/oxlint.json'] });
    await project.write(
      'src/shared/flags.ts',
      'export function toggle(flag: boolean): boolean {\n  return !flag;\n}\n'
    );
    await project.write(
      'src/feature/report.ts',
      [
        "import { toggle } from '../shared/flags.ts';",
        '',
        '// TODO: split this function',
        '// eslint-disable-next-line no-console',
        'export function report(a: number, b: number, c: number, d: number, e: number): string {',
        '  console.log(a);',
        '  const tolerance = 1e-9;',
        "  const size = a > b ? 'large' : 'small';",
        '  if (a == c) {',
        '    toggle(true);',
        '  }',
        '  return size + String(tolerance + d + e);',
        '}',
        '',
      ].join('\n')
    );
    await sync(project);
  });

  it('reports the rules in effect on oxlint and not the excluded ones', async () => {
    const codes = new Set((await project.oxlint('src')).map((finding) => finding.code));

    expect([...codes]).toEqual(
      expect.arrayContaining([
        'eslint(no-ternary)',
        'eslint(no-warning-comments)',
        'import(no-relative-parent-imports)',
        'quality-rules(no-disable-comments)',
        'quality-rules(no-scientific-literal)',
        'quality-rules(no-boolean-argument)',
      ])
    );
    expect(codes.has('eslint(max-params)')).toBe(false);
  });

  it('reports the rules in effect on Biome and not the excluded ones', async () => {
    const categories = new Set((await project.biome('src')).map((finding) => finding.category));

    expect(categories.has('lint/suspicious/noDoubleEquals')).toBe(true);
    expect(categories.has('lint/suspicious/noConsole')).toBe(false);
  });

  it('writes generated files and a manifest that pass Biome with the generated settings', async () => {
    const findings = await project.biome('quality-rules', 'quality-rules.json');

    expect(findings).toEqual([]);
  });
});
