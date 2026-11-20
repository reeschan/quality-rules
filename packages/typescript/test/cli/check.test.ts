import { rm } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { projectPool, sampleV1Dir, type TempProject } from './support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

async function syncedProject(): Promise<TempProject> {
  const project = await pool.create();
  await project.installTypescriptPackage();
  await project.installPackage(sampleV1Dir);
  await project.writeManifest({ packs: ['baseline', 'size-limits', 'guards'] });
  const result = await project.cli('sync');
  expect(result.exitCode).toBe(0);
  return project;
}

describe('quality-rules check', () => {
  it('passes when the generated files match the manifest and the installed versions', async () => {
    const project = await syncedProject();

    const result = await project.cli('check');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Generated files are up to date.');
  });

  it('never passes while a generated file is edited by hand', async () => {
    const project = await syncedProject();
    const generated = await project.read('quality-rules/oxlint.json');
    await project.write('quality-rules/oxlint.json', generated.replace('"max": 4', '"max": 8'));

    const result = await project.cli('check');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      'quality-rules/oxlint.json differs from what sync generates (generated files must not be edited by hand)'
    );
    expect(await project.read('quality-rules/oxlint.json')).not.toBe(generated);
  });

  it('fails when a generated file is missing', async () => {
    const project = await syncedProject();
    await rm(project.path('quality-rules/oxlint-plugin.mjs'));

    const result = await project.cli('check');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('quality-rules/oxlint-plugin.mjs is missing');
  });

  it('fails when the manifest changed after the last sync', async () => {
    const project = await syncedProject();
    await project.writeManifest({
      ...(await project.readJson('quality-rules.json')),
      exclude: ['max-depth'],
    });

    const result = await project.cli('check');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('quality-rules/oxlint.json differs');
    expect(result.stderr).toContain('"resolved" in quality-rules.json is out of date');
  });

  it('fails when a convention was excluded after the last sync, even if no file changes', async () => {
    const project = await pool.create();
    await project.installPackage(sampleV1Dir);
    await project.writeManifest({ packs: ['talk'] });
    expect((await project.cli('sync')).exitCode).toBe(0);
    await project.writeManifest({
      ...(await project.readJson('quality-rules.json')),
      exclude: ['UX-901'],
    });

    const result = await project.cli('check');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('"resolved" in quality-rules.json is out of date');
  });

  it('accepts generated files whose line endings were changed to CRLF', async () => {
    const project = await syncedProject();
    const generated = await project.read('quality-rules/biome.json');
    await project.write('quality-rules/biome.json', generated.replaceAll('\n', '\r\n'));

    const result = await project.cli('check');

    expect(result.exitCode).toBe(0);
  });

  it('writes nothing', async () => {
    const project = await syncedProject();
    const generated = await project.read('quality-rules/oxlint.json');
    const edited = generated.replace('"max": 4', '"max": 8');
    await project.write('quality-rules/oxlint.json', edited);
    const manifest = await project.read('quality-rules.json');

    await project.cli('check');

    expect(await project.read('quality-rules/oxlint.json')).toBe(edited);
    expect(await project.read('quality-rules.json')).toBe(manifest);
  });
});
