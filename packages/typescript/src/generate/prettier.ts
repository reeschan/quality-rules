import { FragmentKind } from '../catalog/fragment-kind.ts';
import { type Json, type JsonObject, mergeJson } from '../json.ts';
import { fragmentsFor, type Resolution } from '../resolve/resolve.ts';
import { type FormatStyle, formatJson } from './format.ts';
import type { Generator } from './index.ts';

/** File name of the generated Prettier configuration. */
export const PRETTIER_FILE = 'prettier.json';

/** Prettier's defaults, used for the layout when no formatter settings are generated. */
const DEFAULT_PRINT_WIDTH = 80;
const DEFAULT_TAB_WIDTH = 2;

/**
 * Prettier options that a `prettier` fragment fills with a Biome formatter option, and the
 * Prettier value of each Biome value. The pack keeps one set of formatter options (Biome's),
 * and these two are the ones whose values differ between the tools; the other options
 * (`printWidth`, `tabWidth`, `trailingComma`) take Biome's values as they are.
 */
const FROM_BIOME_VALUES: Readonly<Record<string, Readonly<Record<string, boolean>>>> = {
  useTabs: { tab: true, space: false },
  singleQuote: { single: true, double: false },
};

/**
 * The content of `quality-rules/prettier.json`: the `prettier` fragments of the rules in effect.
 * Prettier has no rules to turn off, so left-out rules add nothing and Prettier's defaults
 * apply to what they would have set.
 */
export function prettierConfig(resolution: Resolution): JsonObject {
  const { active } = fragmentsFor(resolution, FragmentKind.PRETTIER);
  const merged = active.reduce<Json>(mergeJson, {}) as JsonObject;
  return Object.fromEntries(
    Object.entries(merged).map(([key, value]) => [key, prettierValue(key, value)])
  );
}

function prettierValue(key: string, value: Json): Json {
  const values = FROM_BIOME_VALUES[key];
  if (values === undefined || typeof value !== 'string') {
    return value;
  }
  return values[value] ?? value;
}

/** The layout that Prettier gives files formatted with `config`. */
export function prettierStyle(config: JsonObject): FormatStyle {
  const tabWidth = typeof config.tabWidth === 'number' ? config.tabWidth : DEFAULT_TAB_WIDTH;
  return {
    indent: config.useTabs === true ? '\t' : ' '.repeat(tabWidth),
    indentWidth: tabWidth,
    lineWidth: typeof config.printWidth === 'number' ? config.printWidth : DEFAULT_PRINT_WIDTH,
    quote: config.singleQuote === true ? "'" : '"',
    trailingComma: config.trailingComma !== 'none',
  };
}

/** Generates `quality-rules/prettier.json`. */
export const prettierGenerator: Generator = {
  file: PRETTIER_FILE,
  guidance: `.prettierrc.json: "./quality-rules/${PRETTIER_FILE}" (or spread it in prettier.config.mjs to add the project's own settings after it)`,
  render: (context) => formatJson(prettierConfig(context.resolution), context.style),
};
