import path from 'node:path';
import { GENERATED_DIR } from '../../generate/index.ts';
import { MANIFEST_FILE } from '../../manifest/manifest.ts';
import type { CommandSpec } from '../main.ts';
import {
  generatedPath,
  planSync,
  readTextIfExists,
  reportNotices,
  reportPending,
  reportUnknownFiles,
} from './sync.ts';

/**
 * `quality-rules check`: fails when the generated files of the manifest's toolchain or the
 * manifest's `packages` and `resolved` differ from what `sync` would write now. Pending rules
 * and conventions are listed but do not fail the check. Writes nothing. Meant for CI.
 */
export const checkCommand: CommandSpec = {
  summary: 'Fail when the generated files differ from what sync would write (for CI)',
  options: {},
  async run(_values, io) {
    const plan = await planSync(io.cwd);
    reportNotices(plan.notices, io);
    reportPending(plan.resolution, io);
    const problems: string[] = [];
    for (const file of plan.files) {
      const current = await readTextIfExists(path.join(io.cwd, GENERATED_DIR, file.file));
      if (current === undefined) {
        problems.push(`${generatedPath(file.file)} is missing`);
      } else if (current !== file.content) {
        problems.push(
          `${generatedPath(file.file)} differs from what sync generates (generated files must not be edited by hand)`
        );
      }
    }
    const { raw } = plan.manifest;
    if (!sameJson(raw.resolved, plan.resolution.resolved)) {
      problems.push(`"resolved" in ${MANIFEST_FILE} is out of date`);
    }
    if (!sameJson(raw.packages, plan.resolution.packages)) {
      problems.push(`"packages" in ${MANIFEST_FILE} is out of date`);
    }

    reportUnknownFiles(plan, io);
    if (problems.length > 0) {
      io.err(
        [
          ...problems.map((problem) => `- ${problem}`),
          'Run `quality-rules sync` to rebuild them. Put project-specific settings in the project configuration after "extends" instead of editing generated files.',
          '',
        ].join('\n')
      );
      return 1;
    }
    io.out('Generated files are up to date.\n');
    return 0;
  },
};

/** Compares two JSON values, ignoring the order of object keys. */
function sameJson(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
