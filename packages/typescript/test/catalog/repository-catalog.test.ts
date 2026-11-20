import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rules as customRules } from '../../src/plugin.ts';
import {
  packageDir,
  projectPool,
  runNode,
  type TempProject,
  typescriptPackageName,
} from '../cli/support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

const bundleScript = path.join(packageDir, 'scripts', 'bundle-conventions.ts');

interface ListJson {
  packages: { name: string; version: string }[];
  packs: {
    name: string;
    rules: { id: string; added: string }[];
    conventions: { id: string; added: string; check: string[] }[];
  }[];
}

describe("this repository's catalog", () => {
  let list: ListJson;

  beforeAll(async () => {
    const project = await pool.create();
    await project.installTypescriptPackage();
    const result = await project.cli('list', '--json');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    list = JSON.parse(result.stdout) as ListJson;
  });

  it('loads the packs and the conventions of the TypeScript package without problems', () => {
    expect(list.packages.map((item) => item.name)).toEqual([typescriptPackageName]);
    const rulesByPack = Object.fromEntries(
      list.packs.map((pack) => [pack.name, pack.rules.map((rule) => rule.id)])
    );
    expect(rulesByPack).toMatchObject({
      baseline: [
        'biome/recommended',
        'biome/noConsole',
        'biome/noExplicitAny',
        'biome/noDoubleEquals',
        'biome/noNestedTernary',
        'biome/noParameterAssign',
        'biome/noArrayIndexKey',
        'biome/formatter',
      ],
      'size-limits': ['max-lines-per-function', 'max-lines', 'max-params', 'max-depth'],
      'lint-hygiene': [
        'no-ternary',
        'no-warning-comments',
        'import/no-relative-parent-imports',
        'quality-rules/no-disable-comments',
      ],
      centralize: [
        'quality-rules/no-scientific-literal',
        'quality-rules/no-range-bound-comparison',
      ],
      naming: ['quality-rules/no-boolean-argument'],
    });
  });

  it('gives every rule and convention the version that added it', () => {
    const items = list.packs.flatMap((pack) => [...pack.rules, ...pack.conventions]);
    for (const item of items) {
      expect(item.added, item.id).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it('names only custom rules that the package exports', () => {
    const prefix = 'quality-rules/';
    const custom = list.packs
      .flatMap((pack) => pack.rules)
      .filter((rule) => rule.id.startsWith(prefix))
      .map((rule) => rule.id.slice(prefix.length));
    expect(custom.length).toBeGreaterThan(0);
    expect(Object.keys(customRules)).toEqual(expect.arrayContaining(custom));
  });
});

const COMMON = [
  '---',
  'id: GEN-901',
  'layer: common',
  'pack: generality',
  'added: 1.0.0',
  'check: none',
  '---',
  '',
  '# 役割で名付けて共通の場所に置く',
  '',
  '## 理由',
  '',
  '見本の規約。呼び出し元の名前で名付けると、ほかから使えない。',
  '',
  '## 確かめる問い',
  '',
  '- 呼び出し元の名前が入っていないか。',
  '',
  '## 機械では拾えない残り',
  '',
  '- 全部。',
  '',
].join('\n');

const EXAMPLE = [
  '## 悪い例',
  '',
  '```ts',
  'export function formatForSettingsPage(value: number): string {',
  '  return value.toFixed(2);',
  '}',
  '```',
  '',
  '## 良い例',
  '',
  '```ts',
  'export function formatAmount(value: number): string {',
  '  return value.toFixed(2);',
  '}',
  '```',
  '',
].join('\n');

const LAYER = [
  '---',
  'id: TYPE-901',
  'layer: typescript',
  'pack: types',
  'added: 1.0.0',
  'check: none',
  '---',
  '',
  '# 種類を表す文字列は定数のオブジェクトにする',
  '',
  '## 理由',
  '',
  '見本の規約。',
  '',
  '## 悪い例',
  '',
  '```ts',
  "if (kind === 'circle') {",
  '}',
  '```',
  '',
  '## 良い例',
  '',
  '```ts',
  'if (kind === Shape.circle) {',
  '}',
  '```',
  '',
  '## 確かめる問い',
  '',
  '- 文字列を直に書いていないか。',
  '',
  '## 機械では拾えない残り',
  '',
  '- 全部。',
  '',
].join('\n');

async function sources(files: Record<string, string>): Promise<TempProject> {
  const project = await pool.create();
  for (const [file, content] of Object.entries(files)) {
    await project.write(file, content);
  }
  return project;
}

function bundle(project: TempProject, outDir = 'sample/conventions') {
  return runNode(
    [
      bundleScript,
      '--common',
      project.path('common'),
      '--examples',
      project.path('examples'),
      '--layer',
      project.path('layer'),
      '--out',
      project.path(outDir),
    ],
    project.dir
  );
}

describe('bundle-conventions', () => {
  it('joins each common convention with its example and copies the layer conventions as <ID>.md', async () => {
    const project = await sources({
      'common/GEN-901.md': COMMON,
      'examples/GEN-901.md': EXAMPLE,
      'layer/TYPE-901.md': LAYER,
    });

    const result = await bundle(project);

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const joined = await project.read('sample/conventions/GEN-901.md');
    const headings = joined.split('\n').filter((line) => line.startsWith('#'));
    expect(headings).toEqual([
      '# 役割で名付けて共通の場所に置く',
      '## 理由',
      '## 悪い例',
      '## 良い例',
      '## 確かめる問い',
      '## 機械では拾えない残り',
    ]);
    expect(joined).toContain(
      'id: GEN-901\nlayer: common\npack: generality\nadded: 1.0.0\ncheck: none'
    );
    expect(joined).toContain('export function formatAmount(value: number): string {');
    expect(await project.read('sample/conventions/TYPE-901.md')).toContain('## 良い例');
  });

  it('writes conventions that a package can publish and the CLI can list', async () => {
    const project = await sources({
      'common/GEN-901.md': COMMON,
      'examples/GEN-901.md': EXAMPLE,
      'layer/TYPE-901.md': LAYER,
      'node_modules/@example/bundled/package.json': JSON.stringify({
        name: '@example/bundled',
        version: '1.0.0',
        qualityRules: { conventions: 'conventions' },
      }),
    });
    await project.addDependency('@example/bundled', '1.0.0');
    expect((await bundle(project, 'node_modules/@example/bundled/conventions')).exitCode).toBe(0);

    const result = await project.cli('list', '--json');

    expect(result.exitCode).toBe(0);
    const list = JSON.parse(result.stdout) as ListJson;
    expect(list.packs.map((pack) => [pack.name, pack.conventions.map((item) => item.id)])).toEqual([
      ['generality', ['GEN-901']],
      ['types', ['TYPE-901']],
    ]);
  });

  it('rejects example code in a common convention', async () => {
    const project = await sources({
      'common/GEN-901.md': COMMON.replace(
        '## 確かめる問い',
        '```ts\nconst a = 1;\n```\n\n## 確かめる問い'
      ),
      'examples/GEN-901.md': EXAMPLE,
    });

    const result = await bundle(project);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('common conventions hold no example code');
  });

  it('rejects a common convention without an example in the language package', async () => {
    const project = await sources({ 'common/GEN-901.md': COMMON });

    const result = await bundle(project);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no example file GEN-901.md in the language package');
  });

  it('rejects a convention without the version that added it', async () => {
    const project = await sources({
      'common/GEN-901.md': COMMON.replace('added: 1.0.0\n', ''),
      'examples/GEN-901.md': EXAMPLE,
    });

    const result = await bundle(project);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('missing field "added"');
  });
});
