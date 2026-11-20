import { listLines, QualityRulesError } from '../catalog/conventions.ts';
import {
  type Catalog,
  type CatalogConvention,
  type CatalogPack,
  type CatalogRule,
  compareIds,
  isObject,
  type Json,
  type JsonObject,
  OPTIONS_PLACEHOLDER,
} from '../catalog/load.ts';
import type { Manifest } from '../manifest/manifest.ts';

/** A rule of a selected pack and whether it is in effect. */
export interface ResolvedRule {
  readonly rule: CatalogRule;
  readonly active: boolean;
  /** Whether the rule is pending: new in a pack taken before, and not accepted yet. */
  readonly pending: boolean;
  /** The default options with the manifest's options for the rule applied. */
  readonly options: Json | undefined;
}

/** A convention of a selected pack and whether it is in effect. */
export interface ResolvedConvention {
  readonly convention: CatalogConvention;
  readonly active: boolean;
  /** Whether the convention is pending: new in a pack taken before, and not accepted yet. */
  readonly pending: boolean;
}

/** A rule or convention that is pending, with the package and version that added it. */
export interface PendingItem {
  readonly id: string;
  readonly package: string;
  readonly added: string;
}

/** An ID that the manifest names but the installed packages no longer have. */
export interface VanishedItem {
  readonly id: string;
  /** The manifest field that `sync` removes the ID from. */
  readonly field: 'resolved' | 'exclude';
}

/** Which pending items to take in: those named by `--accept`, or all with `--accept-all`. */
export interface AcceptRequest {
  readonly ids: readonly string[];
  readonly all: boolean;
}

const ACCEPT_NONE: AcceptRequest = { ids: [], all: false };

/** What the manifest selects from the catalog. */
export interface Resolution {
  readonly packs: readonly CatalogPack[];
  /** Every rule of the selected packs, in catalog order. */
  readonly rules: readonly ResolvedRule[];
  /** Every convention of the selected packs, in catalog order. */
  readonly conventions: readonly ResolvedConvention[];
  /** IDs of the rules and conventions in effect, sorted. This is the manifest's `resolved`. */
  readonly resolved: readonly string[];
  /** Version of each installed package, by name. This is the manifest's `packages`. */
  readonly packages: Readonly<Record<string, string>>;
  /** The manifest's `exclude` without the IDs that the installed packages no longer have. */
  readonly exclude: readonly string[];
  /** Rules and conventions that stay pending, sorted by ID. */
  readonly pending: readonly PendingItem[];
  /** IDs of the pending rules and conventions taken in by the accept request, sorted. */
  readonly accepted: readonly string[];
  /** IDs removed from `resolved` and `exclude`, sorted by ID. */
  readonly vanished: readonly VanishedItem[];
  /** Things worth telling the user that do not stop the sync. */
  readonly notices: readonly string[];
}

/** The fields of a rule or convention that decide whether it is new since the last sync. */
interface ItemOrigin {
  readonly id: string;
  readonly pack: string;
  readonly package: string;
  readonly added: string;
}

/** A rule or convention of the selected packs, with its state before accepting. */
interface ItemState {
  readonly item: ItemOrigin;
  /** Excluded, or left out because a convention that it checks is excluded. */
  readonly out: boolean;
  /** New since the last sync: pending unless the accept request takes it in. */
  readonly isNew: boolean;
}

/**
 * Decides which rules and conventions are in effect when the project takes its packs.
 *
 * - Every rule and convention of the selected packs is in effect, except the IDs in `exclude`.
 *   Excluding a convention also leaves out the rules that check it, unless they are in
 *   `include`.
 * - A rule or convention is pending, and not in effect, when its pack was taken at the last
 *   sync (some ID of the pack is in `resolved` or `exclude`), its package is in `packages`,
 *   and its ID is in neither `resolved` nor `exclude` (nor `include`, for a rule). The last
 *   sync put every item it saw into `resolved`, `exclude`, or among the rules of excluded
 *   conventions, so these are the items that a later version of the package added (their
 *   `added` is later than the version in `packages`). They stay pending on later syncs, after
 *   `packages` has the new version, until `accept` takes them in. A pack that is selected for
 *   the first time is taken whole, also when it is selected together with an upgrade.
 * - IDs in `resolved` that no installed package has are vanished. So are such IDs in `exclude`
 *   when a package of `packages` is gone or has another version; with the same versions they
 *   are mistakes in the manifest and are reported.
 *
 * Throws a {@link QualityRulesError} when the manifest or `accept` names something unknown.
 */
export function resolve(
  catalog: Catalog,
  manifest: Manifest,
  accept: AcceptRequest = ACCEPT_NONE
): Resolution {
  const problems: string[] = [];
  const notices: string[] = [];
  const packs = selectPacks(catalog, manifest.packs, problems);
  const rulesById = new Map(catalog.rules.map((rule) => [rule.id, rule]));
  const conventionsById = new Map(catalog.conventions.map((item) => [item.id, item]));
  const known = (id: string) => rulesById.has(id) || conventionsById.has(id);
  const packages = installedVersions(catalog);

  const vanished = findVanished(manifest, known, packagesChanged(manifest.packages, packages));
  const removed = new Set(vanished.map((item) => item.id));
  const exclude = manifest.exclude.filter((id) => !removed.has(id));
  const excluded = new Set(exclude);
  const included = new Set(manifest.include);
  reportUnknown('exclude', exclude, known, problems);
  reportUnknown('include', manifest.include, known, problems);
  reportUnknown('options', Object.keys(manifest.options), known, problems);
  for (const id of manifest.include) {
    if (excluded.has(id)) {
      problems.push(`${id} is in both "exclude" and "include"`);
    }
    if (conventionsById.has(id)) {
      problems.push(
        `"include" lists the convention ${id}; include takes back rules of excluded conventions, so remove ${id} from "exclude" instead`
      );
    }
  }

  const isNew = newItemTest(packs, manifest, excluded);
  const packConventions = packs.flatMap((pack) => pack.conventions);
  const excludedChecks = new Set(
    packConventions
      .filter((convention) => excluded.has(convention.id))
      .flatMap((convention) => convention.check)
  );
  for (const id of manifest.include) {
    if (rulesById.has(id) && !excludedChecks.has(id)) {
      notices.push(`"include" lists ${id}, but no excluded convention leaves it out`);
    }
  }
  const selectedRules = new Set(packs.flatMap((pack) => pack.rules.map((rule) => rule.id)));
  const packRules = catalog.rules.filter((rule) => selectedRules.has(rule.id));

  const conventionStates = packConventions.map((convention): ItemState => {
    const out = excluded.has(convention.id);
    return { item: convention, out, isNew: !out && isNew(convention) };
  });
  const ruleStates = packRules.map((rule): ItemState => {
    const out = excluded.has(rule.id) || (excludedChecks.has(rule.id) && !included.has(rule.id));
    return { item: rule, out, isNew: !out && !included.has(rule.id) && isNew(rule) };
  });
  const states = [...ruleStates, ...conventionStates];
  problems.push(...checkAccept(accept, states, excluded, known));
  const takes = (state: ItemState) =>
    state.isNew && (accept.all || accept.ids.includes(state.item.id));
  const isPending = (state: ItemState) => state.isNew && !takes(state);
  const isActive = (state: ItemState) => !state.out && !isPending(state);

  const conventions = conventionStates.map(
    (state, index): ResolvedConvention => ({
      convention: packConventions[index] as CatalogConvention,
      active: isActive(state),
      pending: isPending(state),
    })
  );
  const rules = ruleStates.map((state, index): ResolvedRule => {
    const rule = packRules[index] as CatalogRule;
    const override = Object.hasOwn(manifest.options, rule.id)
      ? manifest.options[rule.id]
      : undefined;
    const options = applyOptions(rule, override, problems);
    return { rule, active: isActive(state), pending: isPending(state), options };
  });
  for (const id of Object.keys(manifest.options)) {
    if (conventionsById.has(id)) {
      problems.push(`"options" has an entry for the convention ${id}; only rules take options`);
    } else if (rulesById.has(id) && !selectedRules.has(id)) {
      notices.push(`"options" for ${id} is not used, because no selected pack has the rule`);
    }
  }
  if (problems.length > 0) {
    throw new QualityRulesError(`The manifest does not match the packs:\n${listLines(problems)}`);
  }

  const idsOf = (filter: (state: ItemState) => boolean) =>
    states
      .filter(filter)
      .map((state) => state.item.id)
      .sort(compareIds);
  const pending = states
    .filter(isPending)
    .map(({ item }): PendingItem => ({ id: item.id, package: item.package, added: item.added }))
    .sort((a, b) => compareIds(a.id, b.id));
  return {
    packs,
    rules,
    conventions,
    resolved: idsOf(isActive),
    packages,
    exclude,
    pending,
    accepted: idsOf(takes),
    vanished,
    notices,
  };
}

/** Version of each installed package, by name, sorted by name. */
function installedVersions(catalog: Catalog): Record<string, string> {
  return Object.fromEntries(
    [...catalog.packages]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => [item.name, item.version])
  );
}

/** Whether a package of the last sync is gone or has another version now. */
function packagesChanged(
  synced: Readonly<Record<string, string>>,
  installed: Readonly<Record<string, string>>
): boolean {
  return Object.entries(synced).some(([name, version]) => installed[name] !== version);
}

/**
 * IDs in `resolved` that no installed package has, and such IDs in `exclude` when the
 * packages changed since the last sync. Without a change, an unknown ID in `exclude` is a
 * mistake in the manifest, which {@link reportUnknown} reports.
 */
function findVanished(
  manifest: Manifest,
  known: (id: string) => boolean,
  changed: boolean
): VanishedItem[] {
  const fromResolved = manifest.resolved
    .filter((id) => !known(id))
    .map((id): VanishedItem => ({ id, field: 'resolved' }));
  const fromExclude = (changed ? manifest.exclude : [])
    .filter((id) => !known(id))
    .map((id): VanishedItem => ({ id, field: 'exclude' }));
  return [...fromResolved, ...fromExclude].sort(
    (a, b) => compareIds(a.id, b.id) || a.field.localeCompare(b.field)
  );
}

/**
 * Returns the test for "new since the last sync": the item's pack was taken at the last sync,
 * its package was synced before, and its ID is in neither `resolved` nor `exclude`.
 */
function newItemTest(
  packs: readonly CatalogPack[],
  manifest: Manifest,
  excluded: ReadonlySet<string>
): (item: ItemOrigin) => boolean {
  const previous = new Set(manifest.resolved);
  const seen = (id: string) => previous.has(id) || excluded.has(id);
  // With nothing in `resolved` this is a first sync: IDs in `exclude` alone do not show that a
  // pack was taken before, so a pack chosen now has no pending items.
  const takenBefore = new Set(
    previous.size === 0
      ? []
      : packs
          .filter((pack) => [...pack.rules, ...pack.conventions].some((item) => seen(item.id)))
          .map((pack) => pack.name)
  );
  return (item) =>
    takenBefore.has(item.pack) && Object.hasOwn(manifest.packages, item.package) && !seen(item.id);
}

/** Problems with the IDs that `--accept` names: each must be pending. */
function checkAccept(
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

function selectPacks(
  catalog: Catalog,
  names: readonly string[],
  problems: string[]
): CatalogPack[] {
  const wanted = new Set(names);
  for (const name of wanted) {
    if (!catalog.packs.some((pack) => pack.name === name)) {
      problems.push(
        `pack "${name}" is not in the installed packages (packs: ${catalog.packs.map((pack) => pack.name).join(', ')})`
      );
    }
  }
  return catalog.packs.filter((pack) => wanted.has(pack.name));
}

function reportUnknown(
  field: string,
  ids: readonly string[],
  known: (id: string) => boolean,
  problems: string[]
): void {
  for (const id of ids) {
    if (!known(id)) {
      problems.push(
        `"${field}" names ${id}, which is no rule or convention of the installed packs`
      );
    }
  }
}

/** Applies the manifest's options for a rule to the rule's defaults. */
function applyOptions(
  rule: CatalogRule,
  override: Json | undefined,
  problems: string[]
): Json | undefined {
  const defaults = rule.options;
  if (override === undefined) {
    return defaults;
  }
  if (defaults === undefined) {
    problems.push(`"options" has an entry for ${rule.id}, which takes no options`);
    return defaults;
  }
  if (isObject(defaults)) {
    if (!isObject(override)) {
      problems.push(`"options" for ${rule.id} must be an object like ${JSON.stringify(defaults)}`);
      return defaults;
    }
    const unknownKeys = Object.keys(override).filter((key) => !Object.hasOwn(defaults, key));
    if (unknownKeys.length > 0) {
      problems.push(
        `"options" for ${rule.id} has unknown keys ${unknownKeys.join(', ')} (known: ${Object.keys(defaults).join(', ')})`
      );
    }
    return { ...defaults, ...(override as JsonObject) };
  }
  if (Array.isArray(defaults) !== Array.isArray(override) || typeof defaults !== typeof override) {
    problems.push(`"options" for ${rule.id} must be like ${JSON.stringify(defaults)}`);
    return defaults;
  }
  return override;
}

/**
 * The configuration fragments of one generated file kind (such as `biome` or `oxlint`), with
 * the options put in: `active` for the rules in effect and `inactive` for the rules of the
 * selected packs that are left out, so that the generator can turn those off.
 */
export function fragmentsFor(
  resolution: Resolution,
  kind: string
): { active: JsonObject[]; inactive: JsonObject[] } {
  const active: JsonObject[] = [];
  const inactive: JsonObject[] = [];
  for (const item of resolution.rules) {
    const fragment = item.rule.config[kind];
    if (fragment !== undefined) {
      (item.active ? active : inactive).push(fillOptions(fragment, item.options) as JsonObject);
    }
  }
  return { active, inactive };
}

function fillOptions(value: Json, options: Json | undefined): Json {
  if (typeof value === 'string') {
    const match = OPTIONS_PLACEHOLDER.exec(value);
    if (match === null) {
      return value;
    }
    const key = match.groups?.key;
    if (key === undefined) {
      return options ?? null;
    }
    return isObject(options) ? (options[key] ?? null) : null;
  }
  if (Array.isArray(value)) {
    return value.map((item: Json) => fillOptions(item, options));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, fillOptions(item as Json, options)])
    );
  }
  return value;
}
