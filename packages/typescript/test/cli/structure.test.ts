import { cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageDir, projectPool, runNode, type TempProject } from './support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

const fixturesDir = fileURLToPath(new URL('../fixtures/projects/structure/', import.meta.url));

const LAYER_ORDER = 'dependency-cruiser/layer-order';
const CLOSED_MODULES = 'dependency-cruiser/closed-modules';
const NO_CIRCULAR = 'dependency-cruiser/no-circular';
const NO_UI_IN_PURE_LAYER = 'dependency-cruiser/no-ui-in-pure-layer';

/** The layers of the sample projects, from top to bottom, and their closed modules. */
const STRUCTURE_OPTIONS = {
  [LAYER_ORDER]: {
    layers: [
      { name: 'app', path: 'src/app' },
      { name: 'features', path: 'src/features' },
      { name: 'domain', path: 'src/domain' },
    ],
  },
  [CLOSED_MODULES]: { modules: ['src/features/*'] },
  [NO_UI_IN_PURE_LAYER]: { layers: ['domain'] },
};

interface DependencyCruiserConfig {
  forbidden: { name: string }[];
  options: Record<string, unknown>;
}

/** One violation that dependency-cruiser reports, as `rule: from -> to`. */
type Violation = string;

interface CruiseResult {
  readonly exitCode: number;
  readonly violations: Violation[];
}

async function dependencyCruiserBin(): Promise<string> {
  const dir = path.join(packageDir, 'node_modules', 'dependency-cruiser');
  const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
    bin: Record<string, string>;
  };
  return path.join(dir, manifest.bin.depcruise ?? '');
}

/**
 * Runs the real dependency-cruiser on `src` with the project's configuration, which extends
 * the generated file: once with the error reporter for the exit code, once for the details.
 */
async function cruise(project: TempProject): Promise<CruiseResult> {
  const bin = await dependencyCruiserBin();
  const args = [bin, 'src', '--config', '.dependency-cruiser.cjs', '--output-type'];
  const errors = await runNode([...args, 'err'], project.dir);
  const details = await runNode([...args, 'json'], project.dir);
  if (details.exitCode !== 0) {
    throw new Error(`dependency-cruiser failed:\n${details.stderr}${details.stdout}`);
  }
  const report = JSON.parse(details.stdout) as {
    summary: { violations: { from: string; to: string; rule: { name: string } }[] };
  };
  const violations = report.summary.violations
    .map((violation) => `${violation.rule.name}: ${violation.from} -> ${violation.to}`)
    .sort();
  return { exitCode: errors.exitCode, violations };
}

/** A project with the TypeScript package, the manifest and the sample code `valid` or `invalid`. */
async function structureProject(
  sample: 'valid' | 'invalid',
  manifest: object = { packs: ['structure'], options: STRUCTURE_OPTIONS }
): Promise<TempProject> {
  const project = await pool.create();
  await project.installTypescriptPackage();
  await project.writeManifest(manifest);
  await cp(path.join(fixturesDir, sample, 'src'), project.path('src'), { recursive: true });
  await project.write(
    '.dependency-cruiser.cjs',
    "module.exports = { extends: './quality-rules/dependency-cruiser.json' };\n"
  );
  return project;
}

async function sync(project: TempProject): Promise<string> {
  const result = await project.cli('sync');
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return result.stdout;
}

function generatedConfig(project: TempProject): Promise<DependencyCruiserConfig> {
  return project.readJson<DependencyCruiserConfig>('quality-rules/dependency-cruiser.json');
}

describe('the structure pack in the list', () => {
  it('lists the four checks, each with its own ID', async () => {
    const project = await pool.create();
    await project.installTypescriptPackage();

    const json = await project.cli('list', '--json');
    const text = await project.cli('list');

    const list = JSON.parse(json.stdout) as {
      packs: { name: string; rules: { id: string; tool: string; added: string }[] }[];
    };
    const structure = list.packs.find((pack) => pack.name === 'structure');
    expect(structure?.rules.map((rule) => [rule.id, rule.tool])).toEqual([
      [LAYER_ORDER, 'dependency-cruiser'],
      [CLOSED_MODULES, 'dependency-cruiser'],
      [NO_CIRCULAR, 'dependency-cruiser'],
      [NO_UI_IN_PURE_LAYER, 'dependency-cruiser'],
    ]);
    for (const id of [LAYER_ORDER, CLOSED_MODULES, NO_CIRCULAR, NO_UI_IN_PURE_LAYER]) {
      expect(text.stdout).toContain(id);
    }
  });
});

describe('quality-rules sync with the structure pack on real dependency-cruiser', () => {
  let invalid: TempProject;
  let output: string;

  beforeAll(async () => {
    invalid = await structureProject('invalid');
    output = await sync(invalid);
  });

  it('creates quality-rules/dependency-cruiser.json and says how to extend it', async () => {
    expect(output).toContain('Created quality-rules/dependency-cruiser.json');
    expect(output).toContain(
      '.dependency-cruiser.cjs: add extends: "./quality-rules/dependency-cruiser.json"'
    );
    const config = await generatedConfig(invalid);
    expect(config.forbidden.map((rule) => rule.name)).toEqual([
      `${LAYER_ORDER}:features`,
      `${LAYER_ORDER}:domain`,
      `${CLOSED_MODULES}:src/features/*`,
      `${CLOSED_MODULES}:src/features/*:from-another-module`,
      NO_CIRCULAR,
      NO_UI_IN_PURE_LAYER,
    ]);
  });

  it('reports an import from a lower layer to an upper one, into a closed module, in a cycle and of a UI library in a pure layer', async () => {
    const result = await cruise(invalid);

    expect(result.violations).toEqual(
      [
        `${LAYER_ORDER}:domain: src/domain/rates.ts -> src/app/settings.ts`,
        `${CLOSED_MODULES}:src/features/*: src/app/main.ts -> src/features/cart/internal/total.ts`,
        `${CLOSED_MODULES}:src/features/*:from-another-module: src/features/orders/index.ts -> src/features/cart/internal/total.ts`,
        `${NO_CIRCULAR}: src/domain/even.ts -> src/domain/odd.ts`,
        `${NO_UI_IN_PURE_LAYER}: src/domain/view.ts -> react`,
      ].sort()
    );
    expect(result.exitCode).not.toBe(0);
  });

  it('passes a project whose imports follow the layers and the closed modules', async () => {
    const valid = await structureProject('valid');
    await sync(valid);

    const result = await cruise(valid);

    expect(result.violations).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('never passes check while dependency-cruiser.json is edited by hand', async () => {
    const file = 'quality-rules/dependency-cruiser.json';
    const generated = await invalid.read(file);
    await invalid.write(file, generated.replace('"severity": "error"', '"severity": "warn"'));

    const result = await invalid.cli('check');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `${file} differs from what sync generates (generated files must not be edited by hand)`
    );
    await invalid.write(file, generated);
    expect((await invalid.cli('check')).exitCode).toBe(0);
  });
});

describe('dependency-cruiser.json without the structure rules', () => {
  it('has no rules when the structure pack is not selected', async () => {
    const project = await structureProject('invalid', { packs: ['size-limits'] });
    await sync(project);

    const config = await generatedConfig(project);
    const result = await cruise(project);

    expect(config.forbidden).toEqual([]);
    expect(result.violations).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('has no rules when the structure rules are excluded, keeping only the convention for review', async () => {
    const project = await structureProject('invalid', {
      packs: ['structure'],
      exclude: [LAYER_ORDER, CLOSED_MODULES, NO_CIRCULAR, NO_UI_IN_PURE_LAYER],
      options: STRUCTURE_OPTIONS,
    });
    await sync(project);

    const config = await generatedConfig(project);
    const manifest = await project.readJson<{ resolved: string[] }>('quality-rules.json');

    expect(manifest.resolved).toEqual(['CONCERN-5']);
    expect(config.forbidden).toEqual([]);
    expect((await cruise(project)).violations).toEqual([]);
  });

  it('leaves out only the excluded check', async () => {
    const project = await structureProject('invalid', {
      packs: ['structure'],
      exclude: [NO_CIRCULAR],
      options: STRUCTURE_OPTIONS,
    });
    await sync(project);

    const violations = (await cruise(project)).violations;

    expect(violations.some((violation) => violation.startsWith(NO_CIRCULAR))).toBe(false);
    expect(violations.some((violation) => violation.startsWith(LAYER_ORDER))).toBe(true);
  });
});

describe('the options of the structure rules', () => {
  it('stop sync when a pure layer is not one of the layers', async () => {
    const project = await structureProject('valid', {
      packs: ['structure'],
      options: { ...STRUCTURE_OPTIONS, [NO_UI_IN_PURE_LAYER]: { layers: ['core'] } },
    });

    const result = await project.cli('sync');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `"options" for ${NO_UI_IN_PURE_LAYER}: "layers" names core, which is no layer in the options of the layer-order rule (layers: app, features, domain)`
    );
  });

  it('stop sync when a layer has no folder', async () => {
    const project = await structureProject('valid', {
      packs: ['structure'],
      options: { [LAYER_ORDER]: { layers: [{ name: 'app' }, { name: 'domain', path: '../x' }] } },
    });

    const result = await project.cli('sync');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(`"options" for ${LAYER_ORDER}: layers[0] (app) needs a "path"`);
    expect(result.stderr).toContain(
      `"options" for ${LAYER_ORDER}: layers[1] (domain) needs a "path"`
    );
  });

  it('take a closed module without a wildcard and its own public files', async () => {
    const project = await structureProject('invalid', {
      packs: ['structure'],
      exclude: [LAYER_ORDER, NO_CIRCULAR, NO_UI_IN_PURE_LAYER],
      options: {
        [CLOSED_MODULES]: {
          modules: [{ path: 'src/features/cart', public: ['index.ts', 'internal/total.ts'] }],
        },
      },
    });
    await sync(project);

    expect((await generatedConfig(project)).forbidden.map((rule) => rule.name)).toEqual([
      `${CLOSED_MODULES}:src/features/cart`,
    ]);
    expect((await cruise(project)).violations).toEqual([]);
  });
});

describe('the generated dependency-cruiser and knip files on Biome', () => {
  it('pass Biome with the baseline formatting', async () => {
    const project = await structureProject('valid', {
      packs: ['baseline', 'structure', 'unused-code'],
      options: STRUCTURE_OPTIONS,
    });
    await project.write('biome.json', { extends: ['./quality-rules/biome.json'] });
    await sync(project);

    expect(await project.biome('quality-rules', 'quality-rules.json')).toEqual([]);
  });

  it("pass Biome with Biome's default formatting", async () => {
    const project = await structureProject('valid', {
      packs: ['structure', 'unused-code'],
      options: STRUCTURE_OPTIONS,
    });
    await project.write('biome.json', { extends: ['./quality-rules/biome.json'] });
    await sync(project);

    expect(await project.read('quality-rules/knip.mjs')).toContain('\t\tfiles: "error",');
    expect(await project.biome('quality-rules', 'quality-rules.json')).toEqual([]);
  });
});
