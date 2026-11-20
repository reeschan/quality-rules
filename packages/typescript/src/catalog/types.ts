import type { Json, JsonObject } from '../json.ts';
import type { Convention } from './conventions.ts';

/** An installed package that provides packs. */
export interface CatalogPackage {
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  /** Import specifier of the module whose named export `rules` holds the custom lint rules. */
  readonly rulesModule: string | undefined;
}

/** One rule of a pack file (`packs/<pack>.json`). */
export interface CatalogRule {
  readonly id: string;
  readonly pack: string;
  readonly package: string;
  /** The tool that checks the rule, such as `oxlint` or `biome`. */
  readonly tool: string;
  readonly description: string;
  /** Package version that added the rule. */
  readonly added: string;
  /**
   * Default options. The manifest's `options` entry for the rule replaces a scalar default
   * and is merged key by key into an object default.
   */
  readonly options: Json | undefined;
  /**
   * Configuration fragments by generated file kind (`biome`, `oxlint`, `eslint`, `prettier`,
   * ...). The string `{{options}}` stands for the resolved options and `{{options.<key>}}` for
   * one of their keys. An `eslint` fragment is a flat config object with only `rules`,
   * `plugins`, `settings` and `linterOptions`, where `plugins` maps each plugin's name (the
   * prefix of its rule IDs) to the package whose default export is the plugin.
   */
  readonly config: Readonly<Record<string, JsonObject>>;
}

/** One convention, with the package that ships it. */
export interface CatalogConvention extends Convention {
  readonly package: string;
}

/** A pack: the rules of its pack files and the conventions whose `pack` field names it. */
export interface CatalogPack {
  readonly name: string;
  /** Description from the pack file. Packs of conventions only have none. */
  readonly description: string | undefined;
  readonly packages: readonly string[];
  readonly rules: readonly CatalogRule[];
  readonly conventions: readonly CatalogConvention[];
}

/** Everything the installed packages provide. */
export interface Catalog {
  readonly packages: readonly CatalogPackage[];
  readonly packs: readonly CatalogPack[];
  readonly rules: readonly CatalogRule[];
  readonly conventions: readonly CatalogConvention[];
}
