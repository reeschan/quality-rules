import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { projectPool, sampleV1Dir, type TempProject } from './support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

interface ListJson {
  packages: { name: string; version: string }[];
  packs: {
    name: string;
    description: string | null;
    packages: string[];
    rules: { id: string; tool: string; description: string; added: string; package: string }[];
    conventions: {
      id: string;
      layer: string;
      description: string;
      added: string;
      package: string;
      check: string[];
    }[];
  }[];
}

async function sampleProject(): Promise<{ project: TempProject; installed: string }> {
  const project = await pool.create();
  const installed = await project.installPackage(sampleV1Dir);
  return { project, installed };
}

/** Rewrites a file of the installed sample package. */
async function editInstalled(
  installed: string,
  file: string,
  edit: (text: string) => string
): Promise<void> {
  const target = path.join(installed, ...file.split('/'));
  const text = (await readFile(target, 'utf8')).replaceAll('\r\n', '\n');
  const edited = edit(text);
  expect(edited).not.toBe(text);
  await writeFile(target, edited);
}

describe('quality-rules list', () => {
  it('prints each pack with its rules and conventions, their IDs, versions and descriptions', async () => {
    const { project } = await sampleProject();

    const result = await project.cli('list');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('@example/quality-rules-sample 1.0.0');
    expect(result.stdout).toContain(
      'guards: Sample guards against leftover debugging code [@example/quality-rules-sample]'
    );
    expect(result.stdout).toMatch(
      /rule\s+no-console\s+oxlint\s+added 1\.0\.0\s+Disallow console calls/
    );
    expect(result.stdout).toMatch(
      /convention\s+FIX-901\s+common\s+added 1\.0\.0\s+調べるためのコードを残さない \(checked by no-console, no-debugger\)/
    );
    expect(result.stdout).toContain('talk: Conventions only [@example/quality-rules-sample]');
    expect(result.stdout).toMatch(
      /convention\s+UX-901\s+common\s+added 1\.0\.0\s+決まっていない判断は実装の前に聞く/
    );
  });

  it('prints the same list as JSON with --json, including a pack of conventions only', async () => {
    const { project } = await sampleProject();

    const result = await project.cli('list', '--json');

    expect(result.exitCode).toBe(0);
    const list = JSON.parse(result.stdout) as ListJson;
    expect(list.packages).toEqual([{ name: '@example/quality-rules-sample', version: '1.0.0' }]);
    expect(list.packs.map((pack) => pack.name)).toEqual(['guards', 'talk']);
    const [guards, talk] = list.packs;
    expect(guards?.rules.map((rule) => [rule.id, rule.tool, rule.added])).toEqual([
      ['no-console', 'oxlint', '1.0.0'],
      ['no-debugger', 'oxlint', '1.0.0'],
      ['quality-rules/no-sample-call', 'oxlint', '1.0.0'],
    ]);
    expect(guards?.conventions).toEqual([
      {
        id: 'FIX-901',
        layer: 'common',
        description: '調べるためのコードを残さない',
        added: '1.0.0',
        package: '@example/quality-rules-sample',
        check: ['no-console', 'no-debugger'],
      },
    ]);
    expect(talk).toMatchObject({
      name: 'talk',
      description: null,
      rules: [],
      conventions: [{ id: 'UX-901', added: '1.0.0', check: [] }],
    });
  });

  it('fails when no installed package provides packs', async () => {
    const project = await pool.create();

    const result = await project.cli('list');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('No installed package provides packs');
  });

  describe('rejects a broken catalog', () => {
    it.each([
      ['added', 'missing field "added"'],
      ['pack', 'missing field "pack"'],
      ['check', 'missing field "check"'],
    ])('a convention without the field %s', async (field, message) => {
      const { project, installed } = await sampleProject();
      await editInstalled(installed, 'conventions/FIX-901.md', (text) =>
        text.replace(new RegExp(`^${field}: .*\\n`, 'm'), '')
      );

      const result = await project.cli('list');

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(`FIX-901.md: ${message}`);
    });

    it.each(['理由', '悪い例', '良い例', '確かめる問い', '機械では拾えない残り'])(
      'a convention without the section %s',
      async (heading) => {
        const { project, installed } = await sampleProject();
        await editInstalled(installed, 'conventions/FIX-901.md', (text) =>
          text.replace(`## ${heading}\n`, '')
        );

        const result = await project.cli('list');

        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain(`FIX-901.md: missing section "## ${heading}"`);
      }
    );

    it('a rule of a pack file without the version that added it', async () => {
      const { project, installed } = await sampleProject();
      await editInstalled(installed, 'packs/guards.json', (text) =>
        text.replace('"added": "1.0.0",', '')
      );

      const result = await project.cli('list');

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('packs/guards.json: rules[0] (no-console): missing "added"');
    });

    it('an ID used twice', async () => {
      const { project, installed } = await sampleProject();
      await writeFile(
        path.join(installed, 'packs', 'extra.json'),
        JSON.stringify({
          description: 'Repeats a rule',
          rules: [
            {
              id: 'no-console',
              tool: 'oxlint',
              description: 'Again',
              added: '1.0.0',
              config: { oxlint: { rules: { 'no-console': 'error' } } },
            },
          ],
        })
      );

      const result = await project.cli('list');

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('ID no-console is used more than once');
    });

    it('a convention whose checking rule is in another pack', async () => {
      const { project, installed } = await sampleProject();
      await editInstalled(installed, 'conventions/FIX-901.md', (text) =>
        text.replace('pack: guards', 'pack: talk')
      );

      const result = await project.cli('list');

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(
        'check rule no-console is in pack guards, but the convention is in pack talk'
      );
    });

    it('a convention whose checking rule does not exist', async () => {
      const { project, installed } = await sampleProject();
      await editInstalled(installed, 'conventions/UX-901.md', (text) =>
        text.replace('check: none', 'check: no-such-rule')
      );

      const result = await project.cli('list');

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('UX-901: check names no-such-rule, which is no rule');
    });
  });
});
