import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isMissingFile } from '../../catalog/conventions.ts';
import { type Catalog, loadCatalog } from '../../catalog/load.ts';
import { formatJson } from '../../generate/biome.ts';
import {
  findUnknownFiles,
  GENERATED_DIR,
  type GeneratedFile,
  generateFiles,
} from '../../generate/index.ts';
import { checkLocalConventions } from '../../manifest/local-conventions.ts';
import {
  MANIFEST_FILE,
  type Manifest,
  type ManifestUpdate,
  manifestPath,
  readManifest,
  type Toolchain,
  updatedFields,
  updateManifest,
} from '../../manifest/manifest.ts';
import type { AcceptRequest } from '../../resolve/pending.ts';
import { type Resolution, resolve } from '../../resolve/resolve.ts';
import type { CommandIo, CommandSpec, OptionValues } from '../main.ts';

/** Everything `sync` would write, worked out without writing anything. */
export interface SyncPlan {
  readonly catalog: Catalog;
  readonly manifest: Manifest;
  readonly resolution: Resolution;
  readonly files: readonly GeneratedFile[];
  /** The fields of the manifest that `sync` writes, as they are after this sync. */
  readonly manifestUpdate: ManifestUpdate;
  /** The manifest's text with the fields that `sync` writes brought up to date. */
  readonly manifestText: string;
  /** The toolchain that the generated files are for. */
  readonly toolchain: Toolchain;
  /** The tools of the toolchain, as they are named in a sentence. */
  readonly toolsLabel: string;
  /** IDs of the rules in effect that the toolchain has no counterpart for. */
  readonly uncovered: readonly string[];
  /** Files in the generated folder that no toolchain writes. */
  readonly unknownFiles: readonly string[];
  /** Files in the generated folder that another toolchain writes and this one does not. */
  readonly otherToolchainFiles: readonly string[];
  /** Things worth telling the user that do not stop the sync. */
  readonly notices: readonly string[];
}

/**
 * Reads the catalog and the manifest of the project and builds what `sync` writes, taking in
 * the pending rules and conventions that `accept` names. Throws a `QualityRulesError` when the
 * manifest does not match the packages, or the project's own conventions overlap them.
 */
export async function planSync(projectDir: string, accept?: AcceptRequest): Promise<SyncPlan> {
  const catalog = await loadCatalog(projectDir);
  const manifest = await readManifest(projectDir);
  const local = await checkLocalConventions(projectDir, manifest.local, catalog);
  const resolution = resolve(catalog, manifest, accept);
  const generation = generateFiles(catalog, resolution, manifest.toolchain);
  const { files, style } = generation;
  const manifestUpdate: ManifestUpdate = {
    packages: resolution.packages,
    resolved: resolution.resolved,
    exclude: resolution.exclude,
    include: resolution.include,
    options: resolution.options,
  };
  const manifestText = formatJson(updateManifest(manifest, manifestUpdate), style);
  const leftFiles = await findUnknownFiles(projectDir, files);
  const otherToolchain = new Set(generation.otherToolchainFiles);
  const notices = [...resolution.notices, ...local.notices];
  return {
    catalog,
    manifest,
    resolution,
    files,
    manifestUpdate,
    manifestText,
    toolchain: manifest.toolchain,
    toolsLabel: generation.toolsLabel,
    uncovered: generation.uncovered,
    unknownFiles: leftFiles.filter((file) => !otherToolchain.has(file)),
    otherToolchainFiles: leftFiles.filter((file) => otherToolchain.has(file)),
    notices,
  };
}

/** Reads a text file with its line endings made `\n`, or `undefined` when it does not exist. */
export async function readTextIfExists(file: string): Promise<string | undefined> {
  try {
    return (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Path of a generated file, relative to the project, with `/` separators. */
export function generatedPath(file: string): string {
  return `${GENERATED_DIR}/${file}`;
}

/**
 * Tells the user about the files in the generated folder that the CLI does not write: those
 * of another toolchain (written before the manifest switched toolchains) and unknown ones.
 * Both are left in place.
 */
export function reportUnknownFiles(plan: SyncPlan, io: CommandIo): void {
  reportFiles(
    `Files in ${GENERATED_DIR}/ that quality-rules no longer writes, because the toolchain is now ${plan.toolchain} (left in place; delete them once the project configuration no longer loads them):`,
    plan.otherToolchainFiles,
    io
  );
  reportFiles(
    `Files in ${GENERATED_DIR}/ that quality-rules does not write (left in place):`,
    plan.unknownFiles,
    io
  );
}

function reportFiles(heading: string, files: readonly string[], io: CommandIo): void {
  if (files.length === 0) {
    return;
  }
  io.out(['', heading, ...files.map((file) => `  - ${generatedPath(file)}`), ''].join('\n'));
}

/** Lists the rules in effect that the toolchain cannot check, so that none is lost unseen. */
function reportUncovered(plan: SyncPlan, io: CommandIo): void {
  if (plan.uncovered.length === 0) {
    return;
  }
  io.out(
    [
      `In effect but not checked with the ${plan.toolchain} toolchain, because ${plan.toolsLabel} have no counterpart:`,
      ...plan.uncovered.map((id) => `  - ${id}`),
      '',
    ].join('\n')
  );
}

/** Prints the notices of a plan, one `Note:` line each. */
export function reportNotices(notices: readonly string[], io: CommandIo): void {
  for (const notice of notices) {
    io.out(`Note: ${notice}\n`);
  }
}

/** Heading of the list of pending rules and conventions. */
const PENDING_HEADING =
  'Pending (not in effect until accepted with `quality-rules sync --accept <id>` or `--accept-all`):';

/** Lists the pending rules and conventions, which are not in effect until they are accepted. */
export function reportPending(resolution: Resolution, io: CommandIo): void {
  if (resolution.pending.length === 0) {
    return;
  }
  io.out(
    [
      PENDING_HEADING,
      ...resolution.pending.map(
        (item) => `  - ${item.id} (added in ${item.package} ${item.added})`
      ),
      '',
    ].join('\n')
  );
}

/**
 * Lists every ID that `sync` removes from the manifest because no installed package has it,
 * with the fields it is removed from.
 */
function reportVanished(resolution: Resolution, io: CommandIo): void {
  if (resolution.vanished.length === 0) {
    return;
  }
  io.out(
    [
      `Removed from ${MANIFEST_FILE}, because the installed packages no longer have them:`,
      ...resolution.vanished.map(
        (item) => `  - ${item.id} (from ${item.fields.map((field) => `"${field}"`).join(', ')})`
      ),
      '',
    ].join('\n')
  );
}

/** Reads `--accept <id>` (repeatable) and `--accept-all`. */
function acceptRequest(values: OptionValues): AcceptRequest {
  const ids = values.accept;
  return {
    ids: Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [],
    all: values['accept-all'] === true,
  };
}

/**
 * `quality-rules sync`: rebuilds the generated files and the manifest's `packages` and
 * `resolved`, removes vanished IDs from `resolved`, `exclude`, `include` and `options`, and
 * takes in the pending rules and conventions named by `--accept` (or all of them with
 * `--accept-all`). `packages` moves to the installed version of a package once none of its
 * items stays pending.
 */
export const syncCommand: CommandSpec = {
  summary: 'Rebuild the generated files from quality-rules.json and the installed packages',
  options: {
    accept: {
      type: 'string',
      multiple: true,
      valueName: 'id',
      description: 'Take in a pending rule or convention by ID (repeatable)',
    },
    'accept-all': {
      type: 'boolean',
      description: 'Take in every pending rule and convention',
    },
  },
  async run(values, io) {
    const plan = await planSync(io.cwd, acceptRequest(values));
    reportNotices(plan.notices, io);
    io.out(summary(plan.resolution));
    reportVanished(plan.resolution, io);
    if (plan.resolution.accepted.length > 0) {
      io.out(`Accepted: ${plan.resolution.accepted.join(', ')}\n`);
    }
    reportPending(plan.resolution, io);
    reportUncovered(plan, io);

    const created: GeneratedFile[] = [];
    for (const file of plan.files) {
      const target = path.join(io.cwd, GENERATED_DIR, file.file);
      const current = await readTextIfExists(target);
      if (current === file.content) {
        io.out(`Unchanged ${generatedPath(file.file)}\n`);
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content);
      io.out(`${current === undefined ? 'Created' : 'Updated'} ${generatedPath(file.file)}\n`);
      if (current === undefined) {
        created.push(file);
      }
    }
    const manifestFile = manifestPath(io.cwd);
    if ((await readTextIfExists(manifestFile)) === plan.manifestText) {
      io.out(`Unchanged ${MANIFEST_FILE}\n`);
    } else {
      await writeFile(manifestFile, plan.manifestText);
      const fields = updatedFields(plan.manifest, plan.manifestUpdate).join(', ');
      io.out(`Updated ${MANIFEST_FILE} (${fields})\n`);
    }

    reportUnknownFiles(plan, io);
    reportGuidance(created, io);
    return 0;
  },
};

function summary(resolution: Resolution): string {
  const activeRules = resolution.rules.filter((item) => item.active).length;
  const activeConventions = resolution.conventions.filter((item) => item.active).length;
  const leftOut = [
    ...resolution.rules
      .filter((item) => !(item.active || item.pending))
      .map((item) => item.rule.id),
    ...resolution.conventions
      .filter((item) => !(item.active || item.pending))
      .map((item) => item.convention.id),
  ];
  return [
    `Packs: ${resolution.packs.map((pack) => pack.name).join(', ') || '(none)'}`,
    `In effect: ${count(activeRules, 'rule')}, ${count(activeConventions, 'convention')}`,
    ...(leftOut.length === 0 ? [] : [`Left out: ${leftOut.join(', ')}`]),
    '',
  ].join('\n');
}

function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? '' : 's'}`;
}

/**
 * Says once, when a generated file is first created, how the project's configuration loads
 * it. The CLI never edits the project's own configuration files.
 */
function reportGuidance(created: readonly GeneratedFile[], io: CommandIo): void {
  const lines = created
    .filter((file) => file.guidance !== '')
    .map((file) => `  - ${file.guidance}`);
  if (lines.length === 0) {
    return;
  }
  io.out(
    [
      '',
      'Load the generated files from the project configuration (quality-rules does not edit it):',
      ...lines,
      '',
    ].join('\n')
  );
}
