import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CATEGORY_NAME,
  isMissingFile,
  listLines,
  QualityRulesError,
} from '../catalog/conventions.ts';
import { isObject, type Json, type JsonObject } from '../catalog/load.ts';

/** File name of the manifest, at the root of the project. */
export const MANIFEST_FILE = 'quality-rules.json';

/**
 * The set of tools that the generated files configure: Biome and oxlint, or ESLint and
 * Prettier. Every toolchain also gets the files of the tools it does not replace (knip,
 * dependency-cruiser).
 */
export const TOOLCHAINS = ['biome-oxlint', 'eslint-prettier'] as const;

/** One of {@link TOOLCHAINS}. */
export type Toolchain = (typeof TOOLCHAINS)[number];

/** The toolchain of a manifest that names none. */
export const DEFAULT_TOOLCHAIN: Toolchain = 'biome-oxlint';

/**
 * The project's manifest: which packs it takes, which rules and conventions it leaves out,
 * and the options of the rules. `packages` and `resolved` are written by `sync`.
 */
export interface Manifest {
  /** Package name to the version that the last sync read. */
  readonly packages: Readonly<Record<string, string>>;
  readonly packs: readonly string[];
  /** Rule and convention IDs that the project leaves out. */
  readonly exclude: readonly string[];
  /** Rules to take back although a convention that they check is excluded. */
  readonly include: readonly string[];
  /** Options by rule ID. */
  readonly options: Readonly<Record<string, Json>>;
  /** IDs of the rules and conventions in effect after the last sync. */
  readonly resolved: readonly string[];
  /** Where the project keeps its own conventions, when it has any. */
  readonly local: LocalConventionsField | undefined;
  /** The tools that the generated files are for; {@link DEFAULT_TOOLCHAIN} when not written. */
  readonly toolchain: Toolchain;
  /** The whole file as read, so that writing it back keeps the fields sync does not own. */
  readonly raw: JsonObject;
}

/**
 * The manifest's `local` field: the prefix of the project's own convention IDs (such as `PROJ`
 * for `PROJ-1`) and the folder of their files, relative to the project.
 */
export interface LocalConventionsField {
  readonly prefix: string;
  readonly dir: string;
}

const STRING_LISTS = ['packs', 'exclude', 'include', 'resolved'] as const;

/** Path of the manifest of the project at `projectDir`. */
export function manifestPath(projectDir: string): string {
  return path.join(projectDir, MANIFEST_FILE);
}

/** Reads and checks the manifest. Throws a {@link QualityRulesError} listing every problem. */
export async function readManifest(projectDir: string): Promise<Manifest> {
  const file = manifestPath(projectDir);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      throw new QualityRulesError(
        `No ${MANIFEST_FILE} in ${projectDir}. Create it with the packs to take, for example {"packs": ["baseline"]}.`
      );
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new QualityRulesError(`${MANIFEST_FILE} is not valid JSON (${reason})`);
  }
  if (!isObject(parsed)) {
    throw new QualityRulesError(`${MANIFEST_FILE} is not a JSON object`);
  }
  const problems = checkManifest(parsed);
  if (problems.length > 0) {
    throw new QualityRulesError(`${MANIFEST_FILE} has problems:\n${listLines(problems)}`);
  }
  const raw = parsed as JsonObject;
  return {
    packages: (raw.packages ?? {}) as Record<string, string>,
    packs: raw.packs as string[],
    exclude: (raw.exclude ?? []) as string[],
    include: (raw.include ?? []) as string[],
    options: (raw.options ?? {}) as Record<string, Json>,
    resolved: (raw.resolved ?? []) as string[],
    local: raw.local as LocalConventionsField | undefined,
    toolchain: (raw.toolchain ?? DEFAULT_TOOLCHAIN) as Toolchain,
    raw,
  };
}

function checkManifest(raw: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (raw.packs === undefined) {
    problems.push('"packs" is missing; list the packs to take, for example ["baseline"]');
  }
  for (const key of STRING_LISTS) {
    const value = raw[key];
    if (value !== undefined && !isStringList(value)) {
      problems.push(`"${key}" is not a list of strings`);
    }
  }
  if (raw.options !== undefined && !isObject(raw.options)) {
    problems.push('"options" is not an object of options by rule ID');
  }
  const { packages } = raw;
  if (
    packages !== undefined &&
    !(isObject(packages) && Object.values(packages).every((value) => typeof value === 'string'))
  ) {
    problems.push('"packages" is not an object of versions by package name');
  }
  problems.push(...checkLocal(raw.local));
  if (raw.toolchain !== undefined && !isToolchain(raw.toolchain)) {
    problems.push(
      `"toolchain" is ${JSON.stringify(raw.toolchain)}; use ${TOOLCHAINS.map((name) => `"${name}"`).join(' or ')} (default "${DEFAULT_TOOLCHAIN}")`
    );
  }
  return problems;
}

function isToolchain(value: unknown): value is Toolchain {
  return TOOLCHAINS.some((name) => name === value);
}

function checkLocal(local: unknown): string[] {
  if (local === undefined) {
    return [];
  }
  if (!isObject(local)) {
    return ['"local" is not an object such as {"prefix": "PROJ", "dir": "docs/conventions"}'];
  }
  const problems: string[] = [];
  if (typeof local.prefix !== 'string' || !CATEGORY_NAME.test(local.prefix)) {
    problems.push(
      '"local.prefix" is not an upper-case name such as PROJ (the IDs are then PROJ-1, PROJ-2, ...)'
    );
  }
  if (typeof local.dir !== 'string' || local.dir.trim() === '') {
    problems.push('"local.dir" is not a folder of the project, such as docs/conventions');
  }
  return problems;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** The fields of the manifest that `sync` writes. */
export interface ManifestUpdate {
  readonly packages: Readonly<Record<string, string>>;
  readonly resolved: readonly string[];
  /** `exclude` without the IDs that the installed packages no longer have. */
  readonly exclude: readonly string[];
  /** `include` without the IDs that the installed packages no longer have. */
  readonly include: readonly string[];
  /** `options` without the IDs that the installed packages no longer have. */
  readonly options: Readonly<Record<string, Json>>;
}

/**
 * Returns the manifest's content with `packages` and `resolved` replaced, and `exclude`,
 * `include` and `options` when IDs were removed from them. Other fields keep their values and
 * order; `packages` and `resolved` are added at the end when the file has none.
 */
export function updateManifest(manifest: Manifest, update: ManifestUpdate): JsonObject {
  const removedFrom = new Set(fieldsWithRemovedIds(manifest, update));
  return {
    ...manifest.raw,
    ...(removedFrom.has('exclude') ? { exclude: update.exclude } : {}),
    ...(removedFrom.has('include') ? { include: update.include } : {}),
    ...(removedFrom.has('options') ? { options: update.options as JsonObject } : {}),
    packages: update.packages,
    resolved: update.resolved,
  };
}

/** Names of the fields that {@link updateManifest} changes, for the output of `sync`. */
export function updatedFields(manifest: Manifest, update: ManifestUpdate): string[] {
  return ['packages', 'resolved', ...fieldsWithRemovedIds(manifest, update)];
}

/** The fields that the project writes and `sync` removed IDs from. */
function fieldsWithRemovedIds(manifest: Manifest, update: ManifestUpdate): string[] {
  const changed = [
    ['exclude', update.exclude.length !== manifest.exclude.length],
    ['include', update.include.length !== manifest.include.length],
    ['options', Object.keys(update.options).length !== Object.keys(manifest.options).length],
  ] as const;
  return changed.filter(([, removed]) => removed).map(([field]) => field);
}
