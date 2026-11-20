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
import {
  type AcceptRequest,
  acceptedVersions,
  checkAccept,
  type ItemState,
  newItemTest,
  type PendingItem,
} from './pending.ts';
import {
  findVanished,
  type KeptSelection,
  packagesChanged,
  type VanishedItem,
  withoutVanished,
} from './vanished.ts';

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
  /**
   * Version of each installed package whose additions have all been accepted or excluded, by
   * name. This is the manifest's `packages`.
   */
  readonly packages: Readonly<Record<string, string>>;
  /** The manifest's `exclude` without the IDs that the installed packages no longer have. */
  readonly exclude: readonly string[];
  /** The manifest's `include` without the IDs that the installed packages no longer have. */
  readonly include: readonly string[];
  /** The manifest's `options` without the IDs that the installed packages no longer have. */
  readonly options: Readonly<Record<string, Json>>;
  /** Rules and conventions that stay pending, sorted by ID. */
  readonly pending: readonly PendingItem[];
  /** IDs of the pending rules and conventions taken in by the accept request, sorted. */
  readonly accepted: readonly string[];
  /** IDs removed from the manifest, sorted by ID. */
  readonly vanished: readonly VanishedItem[];
  /** Things worth telling the user that do not stop the sync. */
  readonly notices: readonly string[];
}

/** The rules and conventions of the installed packages, by ID. */
interface CatalogIds {
  readonly rules: ReadonlyMap<string, CatalogRule>;
  readonly conventions: ReadonlyMap<string, CatalogConvention>;
  readonly known: (id: string) => boolean;
}

/**
 * Decides which rules and conventions are in effect when the project takes its packs.
 *
 * - Every rule and convention of the selected packs is in effect, except the IDs in `exclude`.
 *   Excluding a convention also leaves out the rules that check it, unless they are in
 *   `include`. Taking an ID out of `exclude` puts it back in effect at once.
 * - A rule or convention is pending, and not in effect, when its pack was taken at the last
 *   sync (some ID of the pack is in `resolved` or `exclude`), it was added in a later version
 *   of its package than the one in `packages`, and it is in neither `resolved` nor `exclude`
 *   (nor `include`, for a rule). It stays pending until `accept` takes it in or it is excluded.
 *   `packages` names, for each package, the version whose additions have all been accepted or
 *   excluded: it moves to the installed version once no item of the package stays pending.
 *   A package that `packages` does not have yet (a first sync) has no pending items, and a
 *   pack that is selected for the first time is taken whole, also together with an upgrade.
 * - IDs that the manifest names and no installed package has are vanished and removed: always
 *   from `resolved`, and from `exclude`, `include` and `options` when a package of `packages`
 *   is gone or has another version; with the same versions they are mistakes in the manifest
 *   and are reported.
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
  const ids = catalogIds(catalog);
  const installed = installedVersions(catalog);
  const vanished = findVanished(manifest, ids.known, packagesChanged(manifest.packages, installed));
  const kept = withoutVanished(manifest, vanished);
  problems.push(...checkSelection(kept, ids));
  const excluded = new Set(kept.exclude);
  const included = new Set(kept.include);

  const isNew = newItemTest(packs, manifest, excluded);
  const packConventions = packs.flatMap((pack) => pack.conventions);
  const excludedChecks = new Set(
    packConventions
      .filter((convention) => excluded.has(convention.id))
      .flatMap((convention) => convention.check)
  );
  for (const id of kept.include) {
    if (ids.rules.has(id) && !excludedChecks.has(id)) {
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
  problems.push(...checkAccept(accept, states, excluded, ids.known));
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
    const options = applyOptions(rule, optionsFor(kept, rule.id), problems);
    return { rule, active: isActive(state), pending: isPending(state), options };
  });
  checkOptionTargets(kept, ids, selectedRules, { problems, notices });
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
    packages: acceptedVersions(installed, manifest.packages, pending),
    exclude: kept.exclude,
    include: kept.include,
    options: kept.options,
    pending,
    accepted: idsOf(takes),
    vanished,
    notices,
  };
}

function catalogIds(catalog: Catalog): CatalogIds {
  const rules = new Map(catalog.rules.map((rule) => [rule.id, rule]));
  const conventions = new Map(catalog.conventions.map((item) => [item.id, item]));
  return { rules, conventions, known: (id) => rules.has(id) || conventions.has(id) };
}

/** Version of each installed package, by name, sorted by name. */
function installedVersions(catalog: Catalog): Record<string, string> {
  return Object.fromEntries(
    [...catalog.packages]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => [item.name, item.version])
  );
}

/** Problems with the IDs that `exclude`, `include` and `options` name. */
function checkSelection(kept: KeptSelection, ids: CatalogIds): string[] {
  const problems: string[] = [];
  reportUnknown('exclude', kept.exclude, ids.known, problems);
  reportUnknown('include', kept.include, ids.known, problems);
  reportUnknown('options', Object.keys(kept.options), ids.known, problems);
  const excluded = new Set(kept.exclude);
  for (const id of kept.include) {
    if (excluded.has(id)) {
      problems.push(`${id} is in both "exclude" and "include"`);
    }
    if (ids.conventions.has(id)) {
      problems.push(
        `"include" lists the convention ${id}; include takes back rules of excluded conventions, so remove ${id} from "exclude" instead`
      );
    }
  }
  return problems;
}

/** The manifest's options for a rule, or `undefined` when it has none. */
function optionsFor(kept: KeptSelection, id: string): Json | undefined {
  if (!Object.hasOwn(kept.options, id)) {
    return undefined;
  }
  return kept.options[id];
}

/** Reports the `options` entries for conventions and for rules of packs that are not selected. */
function checkOptionTargets(
  kept: KeptSelection,
  ids: CatalogIds,
  selectedRules: ReadonlySet<string>,
  report: { readonly problems: string[]; readonly notices: string[] }
): void {
  for (const id of Object.keys(kept.options)) {
    if (ids.conventions.has(id)) {
      report.problems.push(
        `"options" has an entry for the convention ${id}; only rules take options`
      );
    } else if (ids.rules.has(id) && !selectedRules.has(id)) {
      report.notices.push(`"options" for ${id} is not used, because no selected pack has the rule`);
    }
  }
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
