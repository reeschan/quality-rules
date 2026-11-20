import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectPool, sampleV1Dir, type TempProject } from './support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

const NOTES = 'Notes that the project keeps next to the generated files.\n';

describe('files in quality-rules/ that the CLI does not write', () => {
  let project: TempProject;
  let syncOutput: string;

  beforeAll(async () => {
    project = await pool.create();
    await project.installPackage(sampleV1Dir);
    await project.writeManifest({ packs: ['guards'] });
    await project.write('quality-rules/notes.md', NOTES);
    await project.write('quality-rules/old/eslint.config.mjs', 'export default [];\n');
    const result = await project.cli('sync');
    expect(result.exitCode).toBe(0);
    syncOutput = result.stdout;
  });

  it('are kept by sync', async () => {
    expect(await project.read('quality-rules/notes.md')).toBe(NOTES);
    expect(await project.read('quality-rules/old/eslint.config.mjs')).toBe('export default [];\n');
  });

  it('are named in the output of sync', () => {
    expect(syncOutput).toContain(
      'Files in quality-rules/ that quality-rules does not write (left in place):'
    );
    expect(syncOutput).toContain('  - quality-rules/notes.md');
    expect(syncOutput).toContain('  - quality-rules/old/eslint.config.mjs');
  });

  it('are named by check, which still passes', async () => {
    const result = await project.cli('check');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('  - quality-rules/notes.md');
    expect(result.stdout).toContain('Generated files are up to date.');
  });
});
