import { cp, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type EslintFinding,
  packageDir,
  projectPool,
  runNode,
  type TempProject,
  typescriptPackageName,
} from './support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

const TYPESCRIPT_PACKS = ['baseline', 'size-limits', 'lint-hygiene', 'centralize', 'naming'];
const BIOME_OXLINT_FILES = ['biome.json', 'oxlint.json', 'oxlint-plugin.mjs'];
const ESLINT_PRETTIER_FILES = ['eslint.mjs', 'prettier.json'];
const SHARED_FILES = ['dependency-cruiser.json', 'knip.mjs'];
const TYPESCRIPT_PARSER = '@typescript-eslint/parser';

const sampleSourceDir = fileURLToPath(
  new URL('../fixtures/projects/eslint-prettier/src', import.meta.url)
);

interface Manifest {
  packages: Record<string, string>;
  resolved: string[];
}

interface PackFile {
  rules: { id: string; tool: string; config?: Record<string, Record<string, unknown>> }[];
}

interface PackageFile {
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
}

/** A project with the TypeScript package installed and the given manifest. */
async function typescriptProject(manifest: object): Promise<TempProject> {
  const project = await pool.create();
  await project.installTypescriptPackage();
  await project.writeManifest(manifest);
  return project;
}

/**
 * A project set up for the eslint-prettier toolchain: the parser that the generated ESLint
 * configuration imports, the project's own ESLint and Prettier configurations that load the
 * generated files, and the sample code.
 */
async function eslintPrettierProject(manifest: object): Promise<TempProject> {
  const project = await typescriptProject({ toolchain: 'eslint-prettier', ...manifest });
  await project.installShim(TYPESCRIPT_PARSER, packageDir);
  await project.write(
    'eslint.config.mjs',
    "import qualityRules from './quality-rules/eslint.mjs';\n\nexport default [...qualityRules];\n"
  );
  await project.write('.prettierrc.json', '"./quality-rules/prettier.json"\n');
  await cp(sampleSourceDir, project.path('src'), { recursive: true });
  return project;
}

async function sync(project: TempProject, ...args: string[]): Promise<string> {
  const result = await project.cli('sync', ...args);
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return result.stdout;
}

async function generatedFiles(project: TempProject): Promise<string[]> {
  return (await readdir(project.path('quality-rules'))).sort();
}

/** Loads the generated ESLint configuration in a separate Node process, as ESLint does. */
async function loadEslintConfig(project: TempProject): Promise<{
  plugins: string[];
  qualityRules: string[];
  linterOptions: Record<string, unknown>;
  rules: Record<string, unknown>;
}> {
  const url = pathToFileURL(project.path('quality-rules/eslint.mjs')).href;
  const script = [
    `const [config] = (await import(${JSON.stringify(url)})).default;`,
    'const plugins = Object.keys(config.plugins).sort();',
    "const qualityRules = Object.keys(config.plugins['quality-rules'].rules).sort();",
    'const { linterOptions, rules } = config;',
    'process.stdout.write(JSON.stringify({ plugins, qualityRules, linterOptions, rules }));',
  ].join('\n');
  const result = await runNode(['--input-type=module', '--eval', script], project.dir);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

function rulesOf(findings: readonly EslintFinding[], file: string): string[] {
  return findings
    .filter((finding) => finding.file === file && finding.ruleId !== null)
    .map((finding) => finding.ruleId as string)
    .sort();
}

describe('the toolchain field of the manifest', () => {
  it('generates the biome-oxlint files when the manifest names no toolchain, the same as with biome-oxlint', async () => {
    const implicit = await typescriptProject({ packs: TYPESCRIPT_PACKS });
    const explicit = await typescriptProject({
      packs: TYPESCRIPT_PACKS,
      toolchain: 'biome-oxlint',
    });
    await sync(implicit);
    await sync(explicit);

    const files = await generatedFiles(implicit);

    expect(files).toEqual([...BIOME_OXLINT_FILES, ...SHARED_FILES].sort());
    expect(await generatedFiles(explicit)).toEqual(files);
    for (const file of files) {
      expect(await explicit.read(`quality-rules/${file}`), file).toBe(
        await implicit.read(`quality-rules/${file}`)
      );
    }
    expect(await implicit.readJson('quality-rules.json')).not.toHaveProperty('toolchain');
  });

  it('rejects a toolchain that quality-rules does not know', async () => {
    const project = await typescriptProject({ packs: ['baseline'], toolchain: 'rome' });

    const result = await project.cli('sync');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('"toolchain"');
    expect(result.stderr).toContain('biome-oxlint');
    expect(result.stderr).toContain('eslint-prettier');
  });
});

describe('quality-rules sync with the eslint-prettier toolchain', () => {
  let project: TempProject;
  let output: string;

  beforeAll(async () => {
    project = await eslintPrettierProject({ packs: TYPESCRIPT_PACKS });
    output = await sync(project);
  });

  it('creates the ESLint and Prettier files in quality-rules/ and no Biome or oxlint file', async () => {
    expect(await generatedFiles(project)).toEqual(
      [...ESLINT_PRETTIER_FILES, ...SHARED_FILES].sort()
    );
    for (const file of ESLINT_PRETTIER_FILES) {
      expect(output).toContain(`Created quality-rules/${file}`);
    }
    for (const file of BIOME_OXLINT_FILES) {
      expect(output).not.toContain(`quality-rules/${file}`);
    }
  });

  it('keeps toolchain in the manifest and writes resolved as for biome-oxlint', async () => {
    const other = await typescriptProject({ packs: TYPESCRIPT_PACKS });
    await sync(other);

    const manifest = await project.readJson<Manifest & { toolchain: string }>('quality-rules.json');

    expect(manifest.toolchain).toBe('eslint-prettier');
    expect(manifest.resolved).toEqual(
      (await other.readJson<Manifest>('quality-rules.json')).resolved
    );
  });

  it('puts the custom rules into one quality-rules plugin and loads only the TypeScript parser', async () => {
    const config = await loadEslintConfig(project);

    expect(config.plugins).toEqual(['quality-rules']);
    expect(config.qualityRules).toEqual([
      'no-boolean-argument',
      'no-disable-comments',
      'no-range-bound-comparison',
      'no-scientific-literal',
    ]);
    const source = await project.read('quality-rules/eslint.mjs');
    expect(source).toContain(`from '${TYPESCRIPT_PARSER}'`);
    expect(source).toContain(`from '${typescriptPackageName}'`);
  });

  it('writes the size-limits, lint-hygiene and custom rules with their options', async () => {
    const { rules } = await loadEslintConfig(project);

    expect(rules['max-lines-per-function']).toEqual([
      'error',
      { max: 100, skipBlankLines: true, skipComments: true },
    ]);
    expect(rules['max-lines']).toEqual(['error', { max: 400 }]);
    expect(rules['max-params']).toEqual(['error', { max: 4 }]);
    expect(rules['max-depth']).toEqual(['error', { max: 4 }]);
    expect(rules['no-ternary']).toBe('error');
    expect(rules['no-warning-comments']).toEqual([
      'error',
      { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'anywhere' },
    ]);
    expect(rules['quality-rules/no-disable-comments']).toBe('error');
    expect(rules['quality-rules/no-scientific-literal']).toEqual(['error', { allowFiles: [] }]);
    expect(rules['quality-rules/no-boolean-argument']).toEqual([
      'error',
      { allowFunctions: [], allowNamePatterns: [] },
    ]);
  });

  it('turns off inline configuration comments, so that a suppression comment cannot hide a report', async () => {
    const { linterOptions } = await loadEslintConfig(project);

    expect(linterOptions).toEqual({ noInlineConfig: true });
  });

  it('copies the Biome formatting defaults into the Prettier configuration', async () => {
    expect(await project.readJson('quality-rules/prettier.json')).toEqual({
      printWidth: 100,
      tabWidth: 2,
      useTabs: false,
      singleQuote: true,
      trailingComma: 'es5',
    });
  });

  it('names the rules that have no ESLint counterpart', () => {
    expect(output).toContain(
      'In effect but not checked with the eslint-prettier toolchain, because ESLint and Prettier have no counterpart:'
    );
    expect(output).toContain('  - biome/recommended\n');
    expect(output).toContain('  - biome/noArrayIndexKey\n');
    expect(output).not.toContain('  - max-params\n');
    expect(output).not.toContain('  - biome/formatter\n');
  });

  it('tells how the project configuration loads the ESLint and Prettier files', () => {
    expect(output).toContain('eslint.config.mjs: import "./quality-rules/eslint.mjs"');
    expect(output).toContain(TYPESCRIPT_PARSER);
    expect(output).toContain('.prettierrc.json: "./quality-rules/prettier.json"');
  });

  it('writes generated files and a manifest that pass prettier --check', async () => {
    expect(await project.prettierDifferences('quality-rules', 'quality-rules.json')).toEqual([]);
  });

  it('passes check right after sync', async () => {
    const result = await project.cli('check');

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Generated files are up to date.');
  });

  it('follows the formatter options of the manifest in the Prettier configuration', async () => {
    const other = await eslintPrettierProject({
      packs: ['baseline'],
      options: { 'biome/formatter': { lineWidth: 120, quoteStyle: 'double', indentStyle: 'tab' } },
    });
    await sync(other);

    expect(await other.readJson('quality-rules/prettier.json')).toEqual({
      printWidth: 120,
      tabWidth: 2,
      useTabs: true,
      singleQuote: false,
      trailingComma: 'es5',
    });
    expect(await other.prettierDifferences('quality-rules', 'quality-rules.json')).toEqual([]);
  });
});

describe('the generated ESLint configuration on real ESLint', () => {
  let project: TempProject;
  let findings: EslintFinding[];

  beforeAll(async () => {
    project = await eslintPrettierProject({
      packs: TYPESCRIPT_PACKS,
      exclude: ['no-ternary'],
      options: { 'max-lines-per-function': 15 },
    });
    await sync(project);
    // Make the manifest look like it was synced at a version before max-depth was added: an
    // older version in packages, and max-depth not in resolved.
    const manifest = await project.readJson<Manifest>('quality-rules.json');
    await project.writeManifest({
      ...manifest,
      packages: { ...manifest.packages, [typescriptPackageName]: '0.0.0' },
      resolved: manifest.resolved.filter((id) => id !== 'max-depth'),
    });
    const output = await sync(project);
    expect(output).toContain('  - max-depth (added in');
    findings = await project.eslint('src');
  });

  it('reports the size limits in effect', () => {
    expect(rulesOf(findings, 'src/size/params.ts')).toEqual(['max-params']);
    expect(rulesOf(findings, 'src/size/long.ts')).toEqual(['max-lines-per-function']);
  });

  it('reports the lint-hygiene rules in effect', () => {
    expect(rulesOf(findings, 'src/hygiene/notes.ts')).toEqual(['no-warning-comments']);
    expect(rulesOf(findings, 'src/hygiene/parent.ts')).toEqual(['no-restricted-imports']);
  });

  it('reports suppression comments, and they suppress nothing', () => {
    expect(rulesOf(findings, 'src/hygiene/suppressed.ts')).toEqual([
      'no-console',
      'quality-rules/no-disable-comments',
      'quality-rules/no-disable-comments',
    ]);
  });

  it('reports the custom rules', () => {
    expect(rulesOf(findings, 'src/custom/literal.ts')).toEqual([
      'quality-rules/no-scientific-literal',
    ]);
    expect(rulesOf(findings, 'src/custom/flag.ts')).toEqual(['quality-rules/no-boolean-argument']);
    // Both comparisons of the overlap test are reported.
    expect(rulesOf(findings, 'src/custom/range.ts')).toEqual([
      'quality-rules/no-range-bound-comparison',
      'quality-rules/no-range-bound-comparison',
    ]);
  });

  it('reports the baseline rules that have an ESLint counterpart', () => {
    expect(rulesOf(findings, 'src/baseline.ts')).toEqual([
      'eqeqeq',
      'no-param-reassign',
      'no-restricted-syntax',
    ]);
  });

  it('never reports an excluded rule', () => {
    expect(rulesOf(findings, 'src/hygiene/ternary.ts')).toEqual([]);
  });

  it('never reports a pending rule', () => {
    expect(rulesOf(findings, 'src/size/depth.ts')).toEqual([]);
  });

  it('reports nothing on clean code and has no parse errors', () => {
    expect(rulesOf(findings, 'src/clean.ts')).toEqual([]);
    expect(findings.filter((finding) => finding.message.startsWith('Parsing error'))).toEqual([]);
  });
});

describe('the generated Prettier configuration on real Prettier', () => {
  it('reports double quotes, lines over 100 columns and trailing commas other than es5', async () => {
    const project = await eslintPrettierProject({ packs: ['baseline'] });
    await sync(project);

    expect(await project.prettierDifferences('src/format')).toEqual([
      'src/format/commas.ts',
      'src/format/quotes.ts',
      'src/format/width.ts',
    ]);
  });
});

describe('quality-rules check with the eslint-prettier toolchain', () => {
  async function syncedProject(): Promise<TempProject> {
    const project = await eslintPrettierProject({ packs: TYPESCRIPT_PACKS });
    await sync(project);
    return project;
  }

  it('never passes while the generated ESLint configuration is edited by hand', async () => {
    const project = await syncedProject();
    const generated = await project.read('quality-rules/eslint.mjs');
    await project.write('quality-rules/eslint.mjs', generated.replace('max: 4', 'max: 8'));

    const result = await project.cli('check');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'quality-rules/eslint.mjs differs from what sync generates (generated files must not be edited by hand)'
    );
  });

  it('never passes while the generated Prettier configuration is edited by hand', async () => {
    const project = await syncedProject();
    const generated = await project.read('quality-rules/prettier.json');
    await project.write('quality-rules/prettier.json', generated.replace('100', '120'));

    const result = await project.cli('check');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'quality-rules/prettier.json differs from what sync generates (generated files must not be edited by hand)'
    );
  });

  it('fails when the toolchain changed after the last sync', async () => {
    const project = await typescriptProject({ packs: TYPESCRIPT_PACKS });
    await sync(project);
    await project.writeManifest({
      ...(await project.readJson('quality-rules.json')),
      toolchain: 'eslint-prettier',
    });

    const result = await project.cli('check');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('quality-rules/eslint.mjs is missing');
  });
});

describe('switching the toolchain', () => {
  let project: TempProject;
  let before: Record<string, string>;
  let output: string;

  beforeAll(async () => {
    project = await typescriptProject({ packs: TYPESCRIPT_PACKS });
    await sync(project);
    before = {};
    for (const file of BIOME_OXLINT_FILES) {
      before[file] = await project.read(`quality-rules/${file}`);
    }
    await project.writeManifest({
      ...(await project.readJson('quality-rules.json')),
      toolchain: 'eslint-prettier',
    });
    output = await sync(project);
  });

  it('keeps the files of the previous toolchain as they were', async () => {
    for (const file of BIOME_OXLINT_FILES) {
      expect(await project.read(`quality-rules/${file}`), file).toBe(before[file]);
    }
    for (const file of ESLINT_PRETTIER_FILES) {
      expect(output).toContain(`Created quality-rules/${file}`);
    }
  });

  it('names them as files that sync no longer writes', () => {
    expect(output).toContain(
      'Files in quality-rules/ that quality-rules no longer writes, because the toolchain is now eslint-prettier (left in place; delete them once the project configuration no longer loads them):'
    );
    for (const file of BIOME_OXLINT_FILES) {
      expect(output).toContain(`  - quality-rules/${file}\n`);
    }
    expect(output).not.toContain('Files in quality-rules/ that quality-rules does not write');
  });

  it('names them in check too, which passes', async () => {
    const result = await project.cli('check');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('  - quality-rules/oxlint.json');
    expect(result.stdout).toContain('Generated files are up to date.');
  });

  it('names the ESLint and Prettier files when switching back', async () => {
    await project.writeManifest({
      ...(await project.readJson('quality-rules.json')),
      toolchain: 'biome-oxlint',
    });

    const back = await sync(project);

    expect(back).toContain('because the toolchain is now biome-oxlint');
    expect(back).toContain('  - quality-rules/eslint.mjs\n');
    expect(back).toContain('  - quality-rules/prettier.json\n');
    expect(back).toContain('Unchanged quality-rules/oxlint.json');
  });
});

describe('the ESLint packages that the generated configuration imports', () => {
  it('are optional peerDependencies of this package', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(packageDir, 'package.json'), 'utf8')
    ) as PackageFile;
    const packsDir = path.join(packageDir, 'packs');
    const imported = new Set<string>([TYPESCRIPT_PARSER]);
    for (const name of await readdir(packsDir)) {
      const pack = JSON.parse(await readFile(path.join(packsDir, name), 'utf8')) as PackFile;
      for (const rule of pack.rules) {
        const plugins = (rule.config?.eslint?.plugins ?? {}) as Record<string, string>;
        for (const packageName of Object.values(plugins)) {
          imported.add(packageName);
        }
      }
    }

    for (const name of ['eslint', ...imported]) {
      expect(manifest.peerDependencies?.[name], name).toBeDefined();
      expect(manifest.peerDependenciesMeta?.[name]?.optional, name).toBe(true);
      expect(manifest.devDependencies?.[name], name).toBeDefined();
    }
  });
});
