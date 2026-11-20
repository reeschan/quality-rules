import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { projectPool, type TempProject } from './support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

const RULE = 'unit-tests/imported-by-tests';

const fixturesDir = fileURLToPath(new URL('../fixtures/projects/unit-tests/', import.meta.url));

/** The folder of the pure computation in the sample projects. */
const DOMAIN = { dirs: ['src/domain'] };

/**
 * A synced project with the sample code `valid` (every file of `src/domain` is read by a test) or
 * `invalid` (it has files that no unit test reads), and the manifest with the pack unit-tests.
 */
async function unitTestsProject(
  sample: 'valid' | 'invalid',
  manifest: object = { packs: ['unit-tests'], options: { [RULE]: DOMAIN } }
): Promise<TempProject> {
  const project = await pool.create();
  await project.installTypescriptPackage();
  await project.writeManifest(manifest);
  await cp(`${fixturesDir}${sample}`, project.dir, { recursive: true });
  const synced = await project.cli('sync');
  expect(synced.exitCode).toBe(0);
  return project;
}

describe('quality-rules unit-tests', () => {
  it('fails and lists the files that no unit test reads', async () => {
    const project = await unitTestsProject('invalid');

    const result = await project.cli('unit-tests');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('src/domain/orphan.ts');
    expect(result.stderr).toContain('src/domain/by-app.ts');
    expect(result.stderr).toContain('src/domain/setup-only.ts');
  });

  it('passes when every file of the folder is read by a unit test', async () => {
    const project = await unitTestsProject('valid');

    const result = await project.cli('unit-tests');

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src/domain');
  });
});

describe('what counts as read', () => {
  it('counts an import by a relative path without the extension, by a path alias, with a .js extension, and through an index file', async () => {
    const project = await unitTestsProject('invalid');

    const result = await project.cli('unit-tests');

    for (const read of ['sum.ts', 'area.ts', 'round.ts', 'circle.ts', 'square.ts', 'index.ts']) {
      expect(result.stderr).not.toContain(read);
    }
    expect(result.stderr).toContain('orphan.ts');
  });

  it('does not count an import from code that is not a unit test', async () => {
    const project = await unitTestsProject('invalid');

    const result = await project.cli('unit-tests');

    // by-app.ts is imported by src/app/main.ts, setup-only.ts by a helper in the test folder
    expect(result.stderr).toContain('src/domain/by-app.ts');
    expect(result.stderr).toContain('src/domain/setup-only.ts');
  });

  it('does not ask for a test of a test file', async () => {
    const project = await unitTestsProject('valid', {
      packs: ['unit-tests'],
      options: { [RULE]: { dirs: ['test'] } },
    });

    const result = await project.cli('unit-tests');

    expect(result.exitCode).toBe(0);
  });
});

describe('the options', () => {
  it('checks only the folders from the options', async () => {
    const project = await unitTestsProject('invalid', {
      packs: ['unit-tests'],
      options: { [RULE]: { dirs: ['src/domain/shapes'] } },
    });

    const result = await project.cli('unit-tests');

    expect(result.exitCode).toBe(0);
  });

  it('reads the unit tests from the test folders of the options', async () => {
    const project = await unitTestsProject('invalid', {
      packs: ['unit-tests'],
      options: { [RULE]: { dirs: ['src/app'] } },
    });

    const withDefaults = await project.cli('unit-tests');
    await project.writeManifest({
      packs: ['unit-tests'],
      options: { [RULE]: { dirs: ['src/app'], testDirs: ['test', 'spec'] } },
    });
    const withSpec = await project.cli('unit-tests');

    expect(withDefaults.exitCode).toBe(1);
    expect(withDefaults.stderr).toContain('src/app/main.ts');
    expect(withSpec.stderr).toBe('');
    expect(withSpec.exitCode).toBe(0);
  });

  it('reads the path aliases from the tsconfig named in the options', async () => {
    const project = await unitTestsProject('valid', {
      packs: ['unit-tests'],
      options: { [RULE]: { ...DOMAIN, tsconfig: 'tsconfig.spec.json' } },
    });
    await project.write('tsconfig.spec.json', {
      compilerOptions: { paths: { '@/*': ['./nowhere/*'] } },
    });

    const result = await project.cli('unit-tests');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('src/domain/area.ts');
  });

  it('stops with an error when a folder does not exist', async () => {
    const project = await unitTestsProject('valid', {
      packs: ['unit-tests'],
      options: { [RULE]: { dirs: ['src/missing'] } },
    });

    const result = await project.cli('unit-tests');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('src/missing');
  });
});

describe('when the rule is not in effect', () => {
  it('does nothing and says so when the rule is excluded', async () => {
    const project = await unitTestsProject('invalid', {
      packs: ['unit-tests'],
      exclude: [RULE],
    });

    const result = await project.cli('unit-tests');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${RULE} is not in effect`);
    expect(result.stderr).toBe('');
  });

  it('does nothing and says so when the pack is not selected', async () => {
    const project = await unitTestsProject('invalid', { packs: ['naming'] });

    const result = await project.cli('unit-tests');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${RULE} is not in effect`);
  });
});

describe('the catalog and check', () => {
  it('lists the check with its own ID', async () => {
    const project = await unitTestsProject('valid');

    const result = await project.cli('list', '--json');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(RULE);
    expect((await project.cli('list')).stdout).toContain(RULE);
  });

  it('never runs the unit-tests check: check passes on a project with an unread file', async () => {
    const project = await unitTestsProject('invalid');
    expect((await project.cli('unit-tests')).exitCode).toBe(1);

    const result = await project.cli('check');

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });
});
