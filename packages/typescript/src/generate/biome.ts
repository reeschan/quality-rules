import { FragmentKind } from '../catalog/fragment-kind.ts';
import { isObject, type Json, type JsonObject, mergeJson, withDefaults } from '../json.ts';
import { fragmentsFor, type Resolution } from '../resolve/resolve.ts';
import { type FormatStyle, formatJson } from './format.ts';
import type { Generator } from './index.ts';

/** Biome's formatter defaults, used when no formatter settings are generated. */
const DEFAULT_INDENT_WIDTH = 2;
const DEFAULT_LINE_WIDTH = 80;

/** The layout that Biome gives files checked with the settings of `config`. */
export function styleOf(config: JsonObject): FormatStyle {
  const formatter = isObject(config.formatter) ? config.formatter : {};
  const javascript = isObject(config.javascript) ? config.javascript : {};
  const jsFormatter = isObject(javascript.formatter) ? javascript.formatter : {};
  const indentWidth =
    typeof formatter.indentWidth === 'number' ? formatter.indentWidth : DEFAULT_INDENT_WIDTH;
  return {
    indent: formatter.indentStyle === 'space' ? ' '.repeat(indentWidth) : '\t',
    indentWidth,
    lineWidth: typeof formatter.lineWidth === 'number' ? formatter.lineWidth : DEFAULT_LINE_WIDTH,
    quote: jsFormatter.quoteStyle === 'single' ? "'" : '"',
    trailingComma: jsFormatter.trailingCommas !== 'none',
  };
}

/**
 * The part of a Biome fragment that turns its lint rules off: rule levels become `off`, a
 * `preset` becomes `none` and `recommended` becomes `false`. Formatter settings are dropped.
 */
function turnedOff(fragment: JsonObject): JsonObject {
  const linter = isObject(fragment.linter) ? fragment.linter : {};
  const rules = isObject(linter.rules) ? linter.rules : undefined;
  if (rules === undefined) {
    return {};
  }
  return { linter: { rules: offLevels(rules as JsonObject, true) } };
}

function offLevels(rules: JsonObject, isTop: boolean): JsonObject {
  const off: Record<string, Json> = {};
  for (const [key, value] of Object.entries(rules)) {
    if (key === 'preset') {
      off[key] = 'none';
    } else if (key === 'recommended') {
      off[key] = false;
    } else if (isTop && isObject(value)) {
      off[key] = offLevels(value as JsonObject, false);
    } else {
      off[key] = 'off';
    }
  }
  return off;
}

/** The content of `quality-rules/biome.json`, which the project's biome.json extends. */
export function biomeConfig(resolution: Resolution): JsonObject {
  const { active, inactive } = fragmentsFor(resolution, FragmentKind.BIOME);
  // The file sits in the project as a nested configuration, which Biome requires to say so.
  const config = active.reduce<Json>(mergeJson, { root: false });
  const off = inactive.map(turnedOff).reduce<Json>(mergeJson, {});
  return withDefaults(config, off) as JsonObject;
}

/** Generates `quality-rules/biome.json`. */
export const biomeGenerator: Generator = {
  file: 'biome.json',
  guidance: 'biome.json: add "extends": ["./quality-rules/biome.json"]',
  render: (context) => formatJson(biomeConfig(context.resolution), context.style),
};
