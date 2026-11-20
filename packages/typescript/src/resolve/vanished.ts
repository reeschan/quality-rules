import { compareIds, type Json } from '../catalog/load.ts';
import type { Manifest } from '../manifest/manifest.ts';

/** The manifest fields that name rules and conventions by ID. */
export const ManifestField = {
  RESOLVED: 'resolved',
  EXCLUDE: 'exclude',
  INCLUDE: 'include',
  OPTIONS: 'options',
} as const;
export type ManifestField = (typeof ManifestField)[keyof typeof ManifestField];

/** An ID that the manifest names but the installed packages no longer have. */
export interface VanishedItem {
  readonly id: string;
  /** The manifest fields that `sync` removes the ID from, in the order of {@link ManifestField}. */
  readonly fields: readonly ManifestField[];
}

/** The fields of the manifest that the project writes, without the vanished IDs. */
export interface KeptSelection {
  readonly exclude: readonly string[];
  readonly include: readonly string[];
  readonly options: Readonly<Record<string, Json>>;
}

/** Whether a package of the last sync is gone or has another version now. */
export function packagesChanged(
  synced: Readonly<Record<string, string>>,
  installed: Readonly<Record<string, string>>
): boolean {
  return Object.entries(synced).some(([name, version]) => installed[name] !== version);
}

/**
 * The IDs that the manifest names and no installed package has, with every field that names
 * them, sorted by ID. IDs in `resolved` always count. IDs in `exclude`, `include` and `options`
 * count when the packages changed since the version in `packages`; without a change, such an ID
 * is a mistake in the manifest, which `resolve` reports.
 */
export function findVanished(
  manifest: Manifest,
  known: (id: string) => boolean,
  changed: boolean
): VanishedItem[] {
  const named: [ManifestField, readonly string[]][] = [[ManifestField.RESOLVED, manifest.resolved]];
  if (changed) {
    named.push(
      [ManifestField.EXCLUDE, manifest.exclude],
      [ManifestField.INCLUDE, manifest.include],
      [ManifestField.OPTIONS, Object.keys(manifest.options)]
    );
  }
  const fieldsById = new Map<string, ManifestField[]>();
  for (const [field, ids] of named) {
    for (const id of new Set(ids)) {
      if (!known(id)) {
        fieldsById.set(id, [...(fieldsById.get(id) ?? []), field]);
      }
    }
  }
  return [...fieldsById]
    .map(([id, fields]): VanishedItem => ({ id, fields }))
    .sort((a, b) => compareIds(a.id, b.id));
}

/** The manifest's `exclude`, `include` and `options` with the vanished IDs removed. */
export function withoutVanished(
  manifest: Manifest,
  vanished: readonly VanishedItem[]
): KeptSelection {
  const removed = new Set(vanished.map((item) => item.id));
  const keep = (id: string) => !removed.has(id);
  return {
    exclude: manifest.exclude.filter(keep),
    include: manifest.include.filter(keep),
    options: Object.fromEntries(Object.entries(manifest.options).filter(([id]) => keep(id))),
  };
}
