import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectPool, type TempProject } from '../../typescript/test/cli/support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

const packageDir = fileURLToPath(new URL('../', import.meta.url));
const sampleSourceDir = fileURLToPath(
  new URL('./fixtures/projects/react-pack/src', import.meta.url)
);
const reactPackageName = '@reeschan/quality-rules-react';
const typescriptPackageName = '@reeschan/quality-rules-typescript';

/** Biome rules of the react pack that the tests look for, as `group/name`. */
const REACT_BIOME_RULES = [
  'a11y/useAltText',
  'a11y/useButtonType',
  'a11y/useValidAriaRole',
  'correctness/useJsxKeyInIterable',
];

interface ListJson {
  packages: { name: string; version: string }[];
  packs: {
    name: string;
    rules: { id: string; tool: string; added: string }[];
    conventions: { id: string; added: string; check: string[] }[];
  }[];
}

interface OxlintConfig {
  jsPlugins: string[];
  rules: Record<string, unknown>;
}

interface BiomeConfig {
  linter: { rules: Record<string, Record<string, unknown> | undefined> };
}

interface Manifest {
  packages: Record<string, string>;
  resolved: string[];
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * Installs this repository's React package the way a project gets it from npm: package.json,
 * the packs, the published conventions (the layer's own folder, when it has one) and an entry
 * module that exports the custom rules from the sources, so that no build is needed.
 */
async function installReactPackage(project: TempProject): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    qualityRules: { packs: string; conventions: string };
  };
  const target = project.path(`node_modules/${manifest.name}`);
  await mkdir(target, { recursive: true });
  await cp(path.join(packageDir, manifest.qualityRules.packs), path.join(target, 'packs'), {
    recursive: true,
  });
  try {
    await cp(
      path.join(packageDir, 'conventions'),
      path.join(target, manifest.qualityRules.conventions),
      { recursive: true, filter: (source) => !source.includes(`${path.sep}examples`) }
    );
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
  const rulesUrl = pathToFileURL(path.join(packageDir, 'src', 'rules', 'index.ts')).href;
  await writeFile(path.join(target, 'index.mjs'), `export * from ${JSON.stringify(rulesUrl)};\n`);
  await writeFile(
    path.join(target, 'package.json'),
    `${JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        type: 'module',
        exports: { '.': './index.mjs', './package.json': './package.json' },
        qualityRules: manifest.qualityRules,
      },
      null,
      2
    )}\n`
  );
  await project.addDependency(manifest.name, manifest.version);
}

/** A sample React project with both packages installed and the given packs selected. */
async function sampleProject(packs: string[]): Promise<TempProject> {
  const project = await pool.create();
  await project.installTypescriptPackage();
  await installReactPackage(project);
  await cp(sampleSourceDir, project.path('src'), { recursive: true });
  await project.write('biome.json', { extends: ['./quality-rules/biome.json'] });
  await project.write('.oxlintrc.json', { extends: ['./quality-rules/oxlint.json'] });
  await project.writeManifest({ packages: {}, packs, exclude: [], include: [], options: {} });
  return project;
}

async function sync(project: TempProject): Promise<void> {
  const result = await project.cli('sync');
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
}

describe("this repository's React catalog", () => {
  let list: ListJson;

  beforeAll(async () => {
    const project = await pool.create();
    await installReactPackage(project);
    const result = await project.cli('list', '--json');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    list = JSON.parse(result.stdout) as ListJson;
  });

  it('loads the packs and the conventions without problems', () => {
    expect(list.packages.map((item) => item.name)).toEqual([reactPackageName]);
    expect(list.packs.map((pack) => pack.name)).toContain('react');
  });

  it('puts the accessibility and JSX rules and the props rule in the react pack', () => {
    const react = list.packs.find((pack) => pack.name === 'react');
    const ids = react?.rules.map((rule) => rule.id) ?? [];
    expect(ids).toContain('quality-rules/no-props-destructuring');
    for (const rule of REACT_BIOME_RULES) {
      expect(ids).toContain(`biome/${rule.split('/')[1]}`);
    }
  });

  it('gives every rule and convention the version that added it', () => {
    const items = list.packs.flatMap((pack) => [...pack.rules, ...pack.conventions]);
    for (const item of items) {
      expect(item.added, item.id).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});

describe('the react pack chosen together with the TypeScript package', () => {
  let project: TempProject;

  beforeAll(async () => {
    project = await sampleProject(['baseline', 'lint-hygiene', 'react']);
    await sync(project);
  });

  it('adds the accessibility and JSX rules to the generated biome.json', async () => {
    const biome = await project.readJson<BiomeConfig>('quality-rules/biome.json');
    for (const rule of REACT_BIOME_RULES) {
      const [group, name] = rule.split('/');
      expect(biome.linter.rules[group ?? '']?.[name ?? ''], rule).toBe('error');
    }
  });

  it('adds no-props-destructuring to the oxlint plugin and the oxlint configuration', async () => {
    const config = await project.readJson<OxlintConfig>('quality-rules/oxlint.json');
    expect(config.rules['quality-rules/no-props-destructuring']).toBe('error');
    const plugin = await project.read('quality-rules/oxlint-plugin.mjs');
    expect(plugin).toContain(reactPackageName);
    expect(plugin).toContain(typescriptPackageName);
    const manifest = await project.readJson<Manifest>('quality-rules.json');
    expect(manifest.resolved).toContain('quality-rules/no-props-destructuring');
    expect(manifest.resolved).toContain('biome/useAltText');
  });

  it('reports a destructured props parameter with oxlint', async () => {
    const findings = await project.oxlint('src');
    const codesOf = (file: string) =>
      findings.filter((finding) => finding.file.endsWith(file)).map((finding) => finding.code);
    expect(codesOf('src/Profile.tsx')).toContain('quality-rules(no-props-destructuring)');
    expect(codesOf('src/Menu.tsx')).not.toContain('quality-rules(no-props-destructuring)');
    expect(codesOf('src/Clean.tsx')).toEqual([]);
  });

  it('reports a missing alt, button type, key and a wrong role with Biome', async () => {
    const findings = await project.biome('src');
    const categoriesOf = (file: string) =>
      findings.filter((finding) => finding.file.endsWith(file)).map((finding) => finding.category);
    expect(categoriesOf('src/Profile.tsx')).toContain('lint/a11y/useAltText');
    expect(categoriesOf('src/Menu.tsx')).toEqual(
      expect.arrayContaining([
        'lint/a11y/useButtonType',
        'lint/correctness/useJsxKeyInIterable',
        'lint/a11y/useValidAriaRole',
      ])
    );
    expect(categoriesOf('src/Clean.tsx')).toEqual([]);
  });
});

describe('without the react pack', () => {
  let project: TempProject;

  beforeAll(async () => {
    project = await sampleProject(['baseline', 'lint-hygiene']);
    await sync(project);
  });

  it('leaves the React rules out of the generated files', async () => {
    const config = await project.readJson<OxlintConfig>('quality-rules/oxlint.json');
    expect(Object.keys(config.rules)).not.toContain('quality-rules/no-props-destructuring');
    const biome = await project.readJson<BiomeConfig>('quality-rules/biome.json');
    expect(biome.linter.rules).not.toHaveProperty('a11y');
    expect(biome.linter.rules).not.toHaveProperty('correctness');
    const manifest = await project.readJson<Manifest>('quality-rules.json');
    expect(manifest.resolved).not.toContain('quality-rules/no-props-destructuring');
  });

  it('does not report a destructured props parameter', async () => {
    const findings = await project.oxlint('src');
    expect(findings.map((finding) => finding.code)).not.toContain(
      'quality-rules(no-props-destructuring)'
    );
  });
});
