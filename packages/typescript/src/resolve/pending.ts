import { type CatalogPack, compareIds } from '../catalog/load.ts';
import type { Manifest } from '../manifest/manifest.ts';
import { isNewerVersion } from './version.ts';

/** A rule or convention that is pending, with the package and version that added it. */
export interface PendingItem {
  readonly id: string;
  readonly package: string;
  readonly added: string;
}

/** Which pending items to take in: those named by `--accept`, or all with `--accept-all`. */
export interface AcceptRequest {
  readonly ids: readonly string[];
  readonly all: boolean;
}

/** The fields of a rule or convention that decide whether it is new since the last sync. */
export interface ItemOrigin {
  readonly id: string;
  readonly pack: string;
  readonly package: string;
  readonly added: string;
}

/** A rule or convention of the selected packs, with its state before accepting. */
export interface ItemState {
  readonly item: ItemOrigin;
  /** Excluded, or left out because a convention that it checks is excluded. */
  readonly out: boolean;
  /** New since the version in `packages`: pending unless the accept request takes it in. */
  readonly isNew: boolean;
}

/**
 * Returns the test for "new since the version in `packages`": the item's pack was taken at the
 * last sync (some ID of the pack is in `resolved` or `exclude`), the manifest's `packages` has
 * the item's package, the item was added in a later version than that, and the item is not in
 * `resolved` (where an accepted item goes).
 *
 * @param packs The selected packs.
 * @param manifest The manifest as the project wrote it.
 * @param excluded The manifest's `exclude` without the vanished IDs.
 */
export function newItemTest(
  packs: readonly CatalogPack[],
  manifest: Manifest,
  excluded: ReadonlySet<string>
): (item: ItemOrigin) => boolean {
  const previous = new Set(manifest.resolved);
  const seen = (id: string) => previous.has(id) || excluded.has(id);
  const takenBefore = new Set(
    packs
      .filter((pack) => [...pack.rules, ...pack.conventions].some((item) => seen(item.id)))
      .map((pack) => pack.name)
  );
  return (item) => {
    if (!(takenBefore.has(item.pack) && Object.hasOwn(manifest.packages, item.package))) {
      return false;
    }
    const synced = manifest.packages[item.package] ?? '';
    return !previous.has(item.id) && isNewerVersion(item.added, synced);
  };
}

/**
 * The versions that `sync` writes into `packages`: the installed version of each package,
 * except that a package with pending items keeps the version in the manifest, because
 * `packages` names the version whose additions have all been accepted or excluded.
 *
 * @param installed Version of each installed package, by name.
 * @param synced The manifest's `packages`.
 * @param pending The items that stay pending after this sync.
 */
export function acceptedVersions(
  installed: Readonly<Record<string, string>>,
  synced: Readonly<Record<string, string>>,
  pending: readonly PendingItem[]
): Record<string, string> {
  const waiting = new Set(pending.map((item) => item.package));
  const versionOf = (name: string, version: string) => {
    if (waiting.has(name) && Object.hasOwn(synced, name)) {
      return synced[name] ?? version;
    }
    return version;
  };
  return Object.fromEntries(
    Object.entries(installed).map(([name, version]) => [name, versionOf(name, version)])
  );
}

/** Problems with the IDs that `--accept` names: each must be pending. */
export function checkAccept(
  accept: AcceptRequest,
  states: readonly ItemState[],
  excluded: ReadonlySet<string>,
  known: (id: string) => boolean
): string[] {
  const pendingIds = states
    .filter((state) => state.isNew)
    .map((state) => state.item.id)
    .sort(compareIds);
  const pendingList = pendingIds.length === 0 ? 'none' : pendingIds.join(', ');
  const problems: string[] = [];
  for (const id of new Set(accept.ids)) {
    if (pendingIds.includes(id)) {
      continue;
    }
    if (!known(id)) {
      problems.push(`--accept names ${id}, which is no rule or convention of the installed packs`);
    } else if (excluded.has(id)) {
      problems.push(
        `--accept names ${id}, but ${id} is in "exclude"; remove it from "exclude" first to take it back`
      );
    } else if (!states.some((state) => state.item.id === id)) {
      problems.push(`--accept names ${id}, which is in no selected pack`);
    } else {
      problems.push(`--accept names ${id}, but ${id} is not pending (pending: ${pendingList})`);
    }
  }
  return problems;
}
