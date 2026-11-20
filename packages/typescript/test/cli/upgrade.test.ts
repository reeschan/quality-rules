import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { projectPool, sampleV1Dir, type TempProject } from './support/temp-project.ts';

const pool = projectPool();
afterAll(() => pool.removeAll());

/**
 * Version 2 of the sample package. Pack guards gains the rule no-alert and the convention
 * FIX-902 and loses the rule quality-rules/no-sample-call and the convention FIX-901; pack talk
 * gains UX-902.
 */
const sampleV2Dir = fileURLToPath(new URL('../fixtures/packages/v2/', import.meta.url));
const SAMPLE_PACKAGE = '@example/quality-rules-sample';

const PENDING_HEADING = 'Pending (not in effect until accepted';
const VANISHED_HEADING =
  'Removed from quality-rules.json, because the installed packages no longer have them:';

interface Manifest {
  packages: Record<string, string>;
  exclude?: string[];
  resolved: string[];
}

interface OxlintConfig {
  rules: Record<string, unknown>;
}

/** A project that took the sample package at version 1 and synced once. */
async function projectOnV1(manifest: object): Promise<TempProject> {
  const project = await pool.create();
  await project.installPackage(sampleV1Dir);
  await project.writeManifest(manifest);
  await project.write('.oxlintrc.json', { extends: ['./quality-rules/oxlint.json'] });
  await sync(project);
  return project;
}

/** Replaces the installed sample package with version 2, as an upgrade does. */
async function upgradeToV2(project: TempProject): Promise<void> {
  await rm(project.path(`node_modules/${SAMPLE_PACKAGE}`), { recursive: true, force: true });
  await project.installPackage(sampleV2Dir);
}

async function sync(project: TempProject, ...args: string[]): Promise<string> {
  const result = await project.cli('sync', ...args);
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return result.stdout;
}

function manifestOf(project: TempProject): Promise<Manifest> {
  return project.readJson<Manifest>('quality-rules.json');
}

async function oxlintRules(project: TempProject): Promise<Record<string, unknown>> {
  return (await project.readJson<OxlintConfig>('quality-rules/oxlint.json')).rules;
}

/** The IDs listed under the pending heading of the output, in order. */
function pendingIds(output: string): string[] {
  return listedIds(output, PENDING_HEADING);
}

/** The IDs listed under the heading of removed IDs, with the field they were removed from. */
function vanishedIds(output: string): string[] {
  return listedIds(output, VANISHED_HEADING);
}

function listedIds(output: string, heading: string): string[] {
  const lines = output.split('\n');
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) {
    return [];
  }
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^ {2}- (?<id>\S+)/.exec(line);
    if (match?.groups?.id === undefined) {
      break;
    }
    items.push(line.trim().slice(2));
  }
  return items.map((item) => item.split(' ')[0] ?? item);
}

describe('sync after the installed package goes from 1.0.0 to 2.0.0', () => {
  it('never lets a pending rule report findings in lint', async () => {
    const project = await projectOnV1({ packs: ['guards'] });
    await project.write('src/ask.ts', "export function ask(): void {\n  alert('stop');\n}\n");
    await upgradeToV2(project);

    const output = await sync(project);

    expect(pendingIds(output)).toEqual(['FIX-902', 'no-alert']);
    expect(output).toContain('  - no-alert (added in @example/quality-rules-sample 2.0.0)');
    const manifest = await manifestOf(project);
    expect(manifest.resolved).not.toContain('no-alert');
    expect(manifest.resolved).not.toContain('FIX-902');
    expect((await oxlintRules(project))['no-alert']).toBe('off');
    expect(await project.oxlint('src')).toEqual([]);
  });

  it('leaves the additions to a pack taken before pending and takes a pack selected with the upgrade whole', async () => {
    const project = await projectOnV1({ packs: ['guards'] });
    await upgradeToV2(project);
    await project.writeManifest({ ...(await manifestOf(project)), packs: ['guards', 'talk'] });

    const output = await sync(project);

    expect(pendingIds(output)).toEqual(['FIX-902', 'no-alert']);
    expect((await manifestOf(project)).resolved).toEqual([
      'no-console',
      'no-debugger',
      'UX-901',
      'UX-902',
    ]);
  });

  it('keeps the other items of a pack active on a first sync with a hand-written packages and one excluded ID', async () => {
    const project = await pool.create();
    await project.installPackage(sampleV1Dir);
    await project.writeManifest({
      packages: { [SAMPLE_PACKAGE]: '1.0.0' },
      packs: ['guards'],
      exclude: ['no-console'],
    });
    await project.write('.oxlintrc.json', { extends: ['./quality-rules/oxlint.json'] });

    const output = await sync(project);

    expect(pendingIds(output)).toEqual([]);
    const { resolved } = await manifestOf(project);
    expect(resolved).toContain('no-debugger');
    expect(resolved).not.toContain('no-console');
  });

  it('writes the installed versions into packages and keeps the same items pending on the next sync', async () => {
    const project = await projectOnV1({ packs: ['guards'] });
    expect((await manifestOf(project)).packages).toEqual({ [SAMPLE_PACKAGE]: '1.0.0' });
    await upgradeToV2(project);

    const first = await sync(project);
    const afterFirst = await manifestOf(project);
    const second = await sync(project);
    const afterSecond = await manifestOf(project);

    expect(afterFirst.packages).toEqual({ [SAMPLE_PACKAGE]: '2.0.0' });
    expect(pendingIds(first)).toEqual(['FIX-902', 'no-alert']);
    expect(pendingIds(second)).toEqual(pendingIds(first));
    expect(afterSecond).toEqual(afterFirst);
    expect(second).toContain('Unchanged quality-rules.json');
  });

  it('takes only the pending items named by --accept, and every pending item with --accept-all', async () => {
    const project = await projectOnV1({ packs: ['guards'] });
    await project.write('src/ask.ts', "export function ask(): void {\n  alert('stop');\n}\n");
    await upgradeToV2(project);
    await sync(project);

    const accepted = await sync(project, '--accept', 'no-alert');

    expect(accepted).toContain('Accepted: no-alert');
    expect(pendingIds(accepted)).toEqual(['FIX-902']);
    expect((await manifestOf(project)).resolved).toEqual(['no-alert', 'no-console', 'no-debugger']);
    expect((await oxlintRules(project))['no-alert']).toBe('error');
    const findings = await project.oxlint('src');
    expect(findings.map((finding) => finding.code)).toEqual(['eslint(no-alert)']);

    const all = await sync(project, '--accept-all');

    expect(all).toContain('Accepted: FIX-902');
    expect(pendingIds(all)).toEqual([]);
    expect((await manifestOf(project)).resolved).toEqual([
      'FIX-902',
      'no-alert',
      'no-console',
      'no-debugger',
    ]);
  });

  it('does not take excluded rules with --accept-all', async () => {
    const project = await projectOnV1({ packs: ['guards'], exclude: ['no-debugger'] });
    await upgradeToV2(project);
    await sync(project);
    await project.writeManifest({
      ...(await manifestOf(project)),
      exclude: ['no-debugger', 'no-alert'],
    });

    const output = await sync(project, '--accept-all');

    expect(output).toContain('Accepted: FIX-902');
    expect(pendingIds(output)).toEqual([]);
    expect((await manifestOf(project)).resolved).toEqual(['FIX-902', 'no-console']);
    const rules = await oxlintRules(project);
    expect(rules['no-alert']).toBe('off');
    expect(rules['no-debugger']).toBe('off');
  });

  it('rejects --accept for an ID that is not pending', async () => {
    const project = await projectOnV1({ packs: ['guards'], exclude: ['no-debugger'] });
    await upgradeToV2(project);
    await sync(project);
    const manifest = await project.read('quality-rules.json');

    const excluded = await project.cli('sync', '--accept', 'no-debugger');
    const active = await project.cli('sync', '--accept', 'no-console');

    expect(excluded.exitCode).toBe(2);
    expect(excluded.stderr).toContain('no-debugger is in "exclude"');
    expect(active.exitCode).toBe(2);
    expect(active.stderr).toContain('no-console is not pending (pending: FIX-902, no-alert)');
    expect(await project.read('quality-rules.json')).toBe(manifest);
  });

  it('never turns an excluded rule back on through sync or an upgrade', async () => {
    const project = await projectOnV1({ packs: ['guards'], exclude: ['no-debugger'] });
    await project.write('src/stop.ts', 'export function stop(): void {\n  debugger;\n}\n');
    const expectStillOut = async () => {
      expect((await manifestOf(project)).resolved).not.toContain('no-debugger');
      expect((await manifestOf(project)).exclude).toContain('no-debugger');
      expect((await oxlintRules(project))['no-debugger']).toBe('off');
      expect(await project.oxlint('src')).toEqual([]);
    };
    await expectStillOut();

    await sync(project);
    await expectStillOut();
    await upgradeToV2(project);
    const upgraded = await sync(project);
    expect(pendingIds(upgraded)).not.toContain('no-debugger');
    await expectStillOut();
    await sync(project);
    await expectStillOut();
    await sync(project, '--accept-all');
    await expectStillOut();
  });

  it('never leaves a vanished rule or convention in the manifest while sync ends quietly', async () => {
    const project = await projectOnV1({
      packs: ['guards'],
      exclude: ['quality-rules/no-sample-call'],
    });
    expect((await manifestOf(project)).resolved).toContain('FIX-901');
    await upgradeToV2(project);

    const output = await sync(project);

    expect(output).toContain(VANISHED_HEADING);
    expect(vanishedIds(output)).toEqual(['FIX-901', 'quality-rules/no-sample-call']);
    expect(output).toContain('  - FIX-901 (from "resolved")');
    expect(output).toContain('  - quality-rules/no-sample-call (from "exclude")');
    expect(output).toContain('Updated quality-rules.json (packages, resolved, exclude)');
    const manifest = await manifestOf(project);
    expect(manifest.resolved).not.toContain('FIX-901');
    expect(manifest.exclude).toEqual([]);
  });

  it('drops a vanished rule from the generated files', async () => {
    const project = await projectOnV1({ packs: ['guards'] });
    expect((await oxlintRules(project))['quality-rules/no-sample-call']).toBe('error');
    await upgradeToV2(project);

    const output = await sync(project);

    expect(vanishedIds(output)).toEqual(['FIX-901', 'quality-rules/no-sample-call']);
    expect(await oxlintRules(project)).not.toHaveProperty('quality-rules/no-sample-call');
    expect(await project.read('quality-rules/oxlint.json')).not.toContain('no-sample-call');
    expect((await manifestOf(project)).resolved).not.toContain('quality-rules/no-sample-call');
    expect((await project.cli('check')).exitCode).toBe(0);
  });

  it('still rejects an unknown ID in exclude when no package changed its version', async () => {
    const project = await projectOnV1({ packs: ['guards'] });
    await project.writeManifest({ ...(await manifestOf(project)), exclude: ['no-such-rule'] });

    const result = await project.cli('sync');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('"exclude" names no-such-rule');
  });
});

describe('check after the upgrade', () => {
  it('reports the pending items and passes while the generated files match', async () => {
    const project = await projectOnV1({ packs: ['guards'] });
    await upgradeToV2(project);
    await sync(project);

    const result = await project.cli('check');

    expect(result.exitCode).toBe(0);
    expect(pendingIds(result.stdout)).toEqual(['FIX-902', 'no-alert']);
    expect(result.stdout).toContain('Generated files are up to date.');
  });

  it('fails until sync runs after the upgrade', async () => {
    const project = await projectOnV1({ packs: ['guards'] });
    await upgradeToV2(project);

    const result = await project.cli('check');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('"packages" in quality-rules.json');
  });
});
