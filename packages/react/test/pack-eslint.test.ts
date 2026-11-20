import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type EslintFinding,
  projectPool,
  runNode,
  type TempProject,
} from '../../typescript/test/cli/support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

const packageDir = fileURLToPath(new URL('../', import.meta.url));
const typescriptPackageDir = fileURLToPath(new URL('../../typescript/', import.meta.url));
const sampleSourceDir = fileURLToPath(
  new URL('./fixtures/projects/react-eslint/src', import.meta.url)
);
const TYPESCRIPT_PARSER = '@typescript-eslint/parser';

/** ESLint rules that stand for the accessibility and JSX rules of the react pack. */
const REACT_ESLINT_RULES = [
  'jsx-a11y/alt-text',
  'react/button-has-type',
  'jsx-a11y/aria-role',
  'jsx-a11y/aria-props',
  'jsx-a11y/click-events-have-key-events',
  'jsx-a11y/anchor-has-content',
  'jsx-a11y/iframe-has-title',
  'jsx-a11y/no-redundant-roles',
  'jsx-a11y/no-aria-hidden-on-focusable',
  'react/jsx-key',
  'react/no-children-prop',
  'react/void-dom-elements-no-children',
  'react/jsx-no-duplicate-props',
  'react/jsx-no-comment-textnodes',
];

interface PackFile {
  rules: { id: string; tool: string; config?: Record<string, Record<string, unknown>> }[];
}

interface PackageFile {
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
}

interface LoadedConfig {
  plugins: string[];
  qualityRules: string[];
  rules: Record<string, unknown>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readJsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

/** The ESLint plugin packages that the react pack's ESLint fragments import. */
async function pluginPackages(): Promise<string[]> {
  const pack = await readJsonFile<PackFile>(path.join(packageDir, 'packs', 'react.json'));
  const names = new Set<string>();
  for (const rule of pack.rules) {
    const plugins = (rule.config?.eslint?.plugins ?? {}) as Record<string, string>;
    for (const name of Object.values(plugins)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * Installs this repository's React package the way a project gets it from npm: package.json,
 * the packs, the published conventions (the layer's own folder, when it has one) and an entry
 * module that exports the custom rules from the sources, so that no build is needed.
 */
async function installReactPackage(project: TempProject): Promise<void> {
  const manifest = await readJsonFile<{
    name: string;
    version: string;
    qualityRules: { packs: string; conventions: string };
  }>(path.join(packageDir, 'package.json'));
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

/**
 * A sample React project for the eslint-prettier toolchain, with both packages, the parser and
 * the plugins installed, and the given packs selected.
 */
async function sampleProject(packs: string[]): Promise<TempProject> {
  const project = await pool.create();
  await project.installTypescriptPackage();
  await installReactPackage(project);
  await project.installShim(TYPESCRIPT_PARSER, typescriptPackageDir);
  for (const name of await pluginPackages()) {
    await project.installShim(name, packageDir);
  }
  await cp(sampleSourceDir, project.path('src'), { recursive: true });
  await project.write(
    'eslint.config.mjs',
    "import qualityRules from './quality-rules/eslint.mjs';\n\nexport default [...qualityRules];\n"
  );
  await project.writeManifest({ toolchain: 'eslint-prettier', packs });
  const result = await project.cli('sync');
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return project;
}

/** Loads the generated ESLint configuration in a separate Node process, as ESLint does. */
async function loadEslintConfig(project: TempProject): Promise<LoadedConfig> {
  const url = pathToFileURL(project.path('quality-rules/eslint.mjs')).href;
  const script = [
    `const [config] = (await import(${JSON.stringify(url)})).default;`,
    'const plugins = Object.keys(config.plugins).sort();',
    "const qualityRules = Object.keys(config.plugins['quality-rules'].rules).sort();",
    'process.stdout.write(JSON.stringify({ plugins, qualityRules, rules: config.rules }));',
  ].join('\n');
  const result = await runNode(['--input-type=module', '--eval', script], project.dir);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout) as LoadedConfig;
}

function rulesOf(findings: readonly EslintFinding[], file: string): string[] {
  return findings
    .filter((finding) => finding.file === file && finding.ruleId !== null)
    .map((finding) => finding.ruleId as string)
    .sort();
}

describe('the react pack with the eslint-prettier toolchain', () => {
  let project: TempProject;
  let config: LoadedConfig;
  let findings: EslintFinding[];

  beforeAll(async () => {
    project = await sampleProject(['baseline', 'lint-hygiene', 'react']);
    config = await loadEslintConfig(project);
    findings = await project.eslint('src');
  });

  it('puts the accessibility and JSX rules and no-props-destructuring into the ESLint file', () => {
    for (const rule of REACT_ESLINT_RULES) {
      expect(config.rules[rule], rule).toBe('error');
    }
    expect(config.rules['quality-rules/no-props-destructuring']).toBe('error');
  });

  it('loads the React plugins and the custom rules of both packages', () => {
    expect(config.plugins).toEqual(['jsx-a11y', 'quality-rules', 'react']);
    expect(config.qualityRules).toEqual(
      expect.arrayContaining(['no-props-destructuring', 'no-disable-comments'])
    );
  });

  it('reports destructured props and a missing alt', () => {
    expect(rulesOf(findings, 'src/Card.tsx')).toEqual([
      'jsx-a11y/alt-text',
      'quality-rules/no-props-destructuring',
    ]);
  });

  it('reports a missing button type and key, a wrong role, an empty anchor and comment text', () => {
    expect(rulesOf(findings, 'src/Toolbar.tsx')).toEqual([
      'jsx-a11y/anchor-has-content',
      'jsx-a11y/aria-role',
      'react/button-has-type',
      'react/jsx-key',
      'react/jsx-no-comment-textnodes',
    ]);
  });

  it('reports nothing on clean React code', () => {
    expect(findings.filter((finding) => finding.file === 'src/Tidy.tsx')).toEqual([]);
  });
});

describe('the eslint-prettier toolchain without the react pack', () => {
  it('neither imports the React plugins nor reports React rules', async () => {
    const project = await sampleProject(['baseline', 'lint-hygiene']);

    const config = await loadEslintConfig(project);
    const findings = await project.eslint('src');
    const source = await project.read('quality-rules/eslint.mjs');

    expect(config.plugins).toEqual(['quality-rules']);
    for (const name of await pluginPackages()) {
      expect(source).not.toContain(name);
    }
    expect(findings.map((finding) => finding.ruleId)).not.toContain(
      'quality-rules/no-props-destructuring'
    );
    expect(findings.filter((finding) => finding.ruleId?.startsWith('jsx-a11y/'))).toEqual([]);
  });
});

describe('the ESLint plugins that the react pack imports', () => {
  it('are optional peerDependencies of this package', async () => {
    const manifest = await readJsonFile<PackageFile>(path.join(packageDir, 'package.json'));
    const plugins = await pluginPackages();

    expect(plugins).toEqual(['eslint-plugin-jsx-a11y', 'eslint-plugin-react']);
    for (const name of plugins) {
      expect(manifest.peerDependencies?.[name], name).toBeDefined();
      expect(manifest.peerDependenciesMeta?.[name]?.optional, name).toBe(true);
      expect(manifest.devDependencies?.[name], name).toBeDefined();
    }
  });
});
