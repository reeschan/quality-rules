import { afterAll, describe, expect, it } from 'vitest';
import { projectPool, sampleV1Dir, type TempProject } from './support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

/** Category names of the package conventions, which a project's own prefix must not reuse. */
const CATEGORIES = [
  'NAME',
  'GEN',
  'FIX',
  'REUSE',
  'CONCERN',
  'TYPE',
  'CMT',
  'UX',
  'E2E',
  'UNIT',
  'STYLE',
];

/** A project-specific convention file with the given front matter ID. */
function localConvention(id: string): string {
  return [
    '---',
    `id: ${id}`,
    'layer: project',
    '---',
    '',
    '# 案件の決まりの見本',
    '',
    '## 理由',
    '',
    '見本の規約。',
    '',
  ].join('\n');
}

async function sampleProject(local: object): Promise<TempProject> {
  const project = await pool.create();
  await project.installPackage(sampleV1Dir);
  await project.writeManifest({ packs: ['guards', 'talk'], local });
  return project;
}

describe('the local field of the manifest', () => {
  it.each(CATEGORIES)('stops sync when the prefix is the package category %s', async (prefix) => {
    const project = await sampleProject({ prefix, dir: 'docs/conventions' });

    const result = await project.cli('sync');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(`"local.prefix" ${prefix} is a category name`);
  });

  it('stops sync and names the IDs when a local convention file has the ID of a package convention', async () => {
    const project = await sampleProject({ prefix: 'PROJ', dir: 'docs/conventions' });
    await project.write('docs/conventions/PROJ-1.md', localConvention('PROJ-1'));
    await project.write('docs/conventions/FIX-901.md', localConvention('FIX-901'));
    await project.write('docs/conventions/PROJ-2.md', localConvention('UX-901'));

    const result = await project.cli('sync');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('docs/conventions/FIX-901.md: ID FIX-901');
    expect(result.stderr).toContain('docs/conventions/PROJ-2.md: ID UX-901');
    expect(result.stderr).not.toContain('PROJ-1.md');
  });

  it('lets sync pass when no ID overlaps, and keeps the local IDs out of resolved', async () => {
    const project = await sampleProject({ prefix: 'PROJ', dir: 'docs/conventions' });
    await project.write('docs/conventions/PROJ-1.md', localConvention('PROJ-1'));
    await project.write('docs/conventions/PROJ-2.md', localConvention('PROJ-2'));

    const result = await project.cli('sync');

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const manifest = await project.readJson<{ resolved: string[]; local: unknown }>(
      'quality-rules.json'
    );
    expect(manifest.resolved).not.toContain('PROJ-1');
    expect(manifest.local).toEqual({ prefix: 'PROJ', dir: 'docs/conventions' });
    expect((await project.cli('check')).exitCode).toBe(0);
  });

  it('rejects a local field of the wrong shape', async () => {
    const project = await sampleProject({ prefix: 'proj-', dir: '' });

    const result = await project.cli('sync');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('"local.prefix"');
    expect(result.stderr).toContain('"local.dir"');
  });
});
