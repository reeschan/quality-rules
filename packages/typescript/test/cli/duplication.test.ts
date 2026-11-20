import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { projectPool, type TempProject } from './support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

const RULE = 'jscpd/changed-lines-duplication';

/** A function of about 25 lines, long enough to count as a duplicate when it is copied. */
function block(name: string): string {
  return [
    `export function ${name}(items: number[], limit: number): number {`,
    '  let total = 0;',
    '  let skipped = 0;',
    '  for (const item of items) {',
    '    if (item < 0) {',
    '      skipped += 1;',
    '      continue;',
    '    }',
    '    if (item > limit) {',
    '      total += limit;',
    '    } else {',
    '      total += item * 2;',
    '    }',
    '  }',
    '  const average = items.length === 0 ? 0 : total / items.length;',
    '  const spread = Math.max(total - skipped, 0) + Math.min(average, limit);',
    '  if (spread > limit * 4) {',
    '    return limit * 4;',
    '  }',
    '  if (spread < 0) {',
    '    return 0;',
    '  }',
    '  return Math.round(spread);',
    '}',
    '',
  ].join('\n');
}

const OTHER = 'export const answer = 42;\n';

interface GitResult {
  readonly stdout: string;
}

function git(project: TempProject, ...args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: project.dir }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ stdout });
      } else {
        reject(new Error(`git ${args.join(' ')} failed:\n${stderr}${stdout}`));
      }
    });
  });
}

async function commitAll(project: TempProject, message: string): Promise<void> {
  await git(project, 'add', '-A');
  await git(project, 'commit', '-q', '-m', message);
}

/**
 * A synced project in a git repository on the branch `main`, with one function in
 * `src/original.ts` and an unrelated file, all committed.
 */
async function repository(manifest: object = { packs: ['duplication'] }): Promise<TempProject> {
  const project = await pool.create();
  await project.installTypescriptPackage();
  await project.writeManifest(manifest);
  await project.write('.gitignore', 'node_modules/\n');
  await project.write('src/original.ts', block('original'));
  await project.write('src/other.ts', OTHER);
  const synced = await project.cli('sync');
  expect(synced.exitCode).toBe(0);
  await git(project, 'init', '-q', '-b', 'main');
  await git(project, 'config', 'user.name', 'Test');
  await git(project, 'config', 'user.email', 'test@example.com');
  await git(project, 'config', 'core.autocrlf', 'false');
  await commitAll(project, 'base');
  return project;
}

async function branchOff(project: TempProject, name: string, from = 'main'): Promise<void> {
  await git(project, 'checkout', '-q', '-b', name, from);
}

describe('quality-rules duplication on a branch', () => {
  it('fails and shows where the duplicate is when the branch copies a function', async () => {
    const project = await repository();
    await branchOff(project, 'feature');
    await project.write('src/copy.ts', block('copy'));
    await commitAll(project, 'copy a function');

    const result = await project.cli('duplication');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/src\/copy\.ts:\d+-\d+/);
    expect(result.stderr).toMatch(/src\/original\.ts:\d+-\d+/);
    expect(result.stderr).toContain('main');
  });

  it('passes when the only duplicate was already on the base branch', async () => {
    const project = await repository();
    await project.write('src/twin.ts', block('twin'));
    await commitAll(project, 'a duplicate that is already there');
    await branchOff(project, 'feature');
    await project.write('src/other.ts', `${OTHER}export const question = 'unknown';\n`);
    await commitAll(project, 'change something else');

    const result = await project.cli('duplication');

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No duplicate touches the lines changed since');
  });

  it('also finds a duplicate in a file that is changed but not committed yet', async () => {
    const project = await repository();
    await branchOff(project, 'feature');
    await project.write('src/copy.ts', block('copy'));

    const result = await project.cli('duplication');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/src\/copy\.ts:\d+-\d+/);
  });
});

describe('the base branch', () => {
  it('looks at the remote-tracking branch before the local branch of the same name', async () => {
    const project = await repository();
    const before = (await git(project, 'rev-parse', 'HEAD')).stdout.trim();
    await project.write('src/copy.ts', block('copy'));
    await commitAll(project, 'the local main has a duplicate that origin/main has not');
    await git(project, 'update-ref', 'refs/remotes/origin/main', before);
    await branchOff(project, 'feature');

    const result = await project.cli('duplication');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('origin/main');
    expect(result.stderr).toMatch(/src\/copy\.ts:\d+-\d+/);
  });

  it('falls back to the local branch when there is no remote-tracking branch', async () => {
    const project = await repository();
    await branchOff(project, 'feature');
    await project.write('src/copy.ts', block('copy'));
    await commitAll(project, 'copy a function');

    const result = await project.cli('duplication');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain('origin/');
  });

  it('uses the base branch from the options', async () => {
    const project = await repository();
    await branchOff(project, 'develop');
    await project.write('src/copy.ts', block('copy'));
    await commitAll(project, 'develop has a duplicate');
    await branchOff(project, 'feature', 'develop');
    await project.write('src/other.ts', `${OTHER}export const question = 'unknown';\n`);
    await commitAll(project, 'change something else');

    const againstMain = await project.cli('duplication');
    await project.writeManifest({
      packs: ['duplication'],
      options: { [RULE]: { baseBranch: 'develop' } },
    });
    const againstDevelop = await project.cli('duplication');

    expect(againstMain.exitCode).toBe(1);
    expect(againstDevelop.stderr).toBe('');
    expect(againstDevelop.exitCode).toBe(0);
  });

  it('stops with an error when the base branch does not exist', async () => {
    const project = await repository({
      packs: ['duplication'],
      options: { [RULE]: { baseBranch: 'trunk' } },
    });

    const result = await project.cli('duplication');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('trunk');
  });
});

describe('the folders to check', () => {
  it('checks only the folders from the options', async () => {
    const project = await repository({ packs: ['duplication'] });
    await branchOff(project, 'feature');
    await project.write('lib/copy.ts', block('copy'));
    await commitAll(project, 'a duplicate outside src');

    const outsideSrc = await project.cli('duplication');
    await project.writeManifest({
      packs: ['duplication'],
      options: { [RULE]: { dirs: ['src', 'lib'] } },
    });
    const withLib = await project.cli('duplication');

    expect(outsideSrc.stderr).toBe('');
    expect(outsideSrc.exitCode).toBe(0);
    expect(withLib.exitCode).toBe(1);
    expect(withLib.stderr).toMatch(/lib\/copy\.ts:\d+-\d+/);
    expect(withLib.stderr).toMatch(/src\/original\.ts:\d+-\d+/);
  });

  it('stops with an error when a folder does not exist', async () => {
    const project = await repository({
      packs: ['duplication'],
      options: { [RULE]: { dirs: ['nowhere'] } },
    });

    const result = await project.cli('duplication');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('nowhere');
  });
});

describe('when the rule is not in effect', () => {
  it('does nothing and says so when the rule is excluded', async () => {
    const project = await repository({ packs: ['duplication'], exclude: [RULE] });
    await branchOff(project, 'feature');
    await project.write('src/copy.ts', block('copy'));
    await commitAll(project, 'copy a function');

    const result = await project.cli('duplication');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${RULE} is not in effect`);
    expect(result.stderr).toBe('');
  });

  it('does nothing and says so when the pack is not selected, even outside a git repository', async () => {
    const project = await pool.create();
    await project.installTypescriptPackage();
    await project.writeManifest({ packs: ['size-limits'] });

    const result = await project.cli('duplication');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${RULE} is not in effect`);
  });
});

describe('quality-rules check', () => {
  it('never runs the duplication check: it passes on a project with a new duplicate', async () => {
    const project = await repository();
    await branchOff(project, 'feature');
    await project.write('src/copy.ts', block('copy'));
    await commitAll(project, 'copy a function');
    expect((await project.cli('duplication')).exitCode).toBe(1);

    const result = await project.cli('check');

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
});

describe('what the check changes', () => {
  async function snapshot(project: TempProject) {
    return {
      index: (await readFile(project.path('.git/index'))).toString('hex'),
      head: (await git(project, 'rev-parse', 'HEAD')).stdout,
      branches: (await git(project, 'branch', '--list', '--format=%(refname) %(objectname)'))
        .stdout,
      current: (await git(project, 'symbolic-ref', 'HEAD')).stdout,
      copy: await project.read('src/copy.ts'),
    };
  }

  it('never changes the working tree, the index or the branches', async () => {
    const project = await repository();
    await branchOff(project, 'feature');
    await project.write('src/copy.ts', block('copy'));
    await commitAll(project, 'copy a function');
    await project.write('src/copy.ts', `${block('copy')}// edited, not committed\n`);
    await project.write('src/untracked.ts', block('untracked'));
    const status = (await git(project, 'status', '--porcelain')).stdout;
    const before = await snapshot(project);

    const result = await project.cli('duplication');

    expect(result.exitCode).toBe(1);
    expect(await snapshot(project)).toEqual(before);
    expect((await git(project, 'status', '--porcelain')).stdout).toBe(status);
  });
});
