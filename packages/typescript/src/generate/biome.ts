import { isObject, type Json, type JsonObject } from '../catalog/load.ts';
import { fragmentsFor, type Resolution } from '../resolve/resolve.ts';
import type { Generator } from './index.ts';

/**
 * How the generated files are laid out. Biome reads `quality-rules/biome.json` as the nested
 * configuration of the `quality-rules/` folder, so the files there are checked with the
 * formatter settings of that file; the generated files follow the same settings.
 */
export interface FormatStyle {
  /** One level of indentation: a tab or spaces. */
  readonly indent: string;
  /** Columns that one level of indentation takes. */
  readonly indentWidth: number;
  readonly lineWidth: number;
  readonly quote: "'" | '"';
  /** Whether a multi-line JavaScript object ends with a comma. */
  readonly trailingComma: boolean;
}

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
 * Writes JSON as Biome formats it: objects one key per line, and arrays of plain values on one
 * line when they fit in the line width, otherwise one item per line.
 */
export function formatJson(value: Json, style: FormatStyle): string {
  return `${renderJson(value, style, 0, 0)}\n`;
}

function renderJson(value: Json, style: FormatStyle, depth: number, usedColumns: number): string {
  if (Array.isArray(value)) {
    return renderArray(value, style, depth, usedColumns);
  }
  if (isObject(value)) {
    const entries = Object.entries(value as JsonObject);
    if (entries.length === 0) {
      return '{}';
    }
    const inner = style.indent.repeat(depth + 1);
    const lines = entries.map(([key, item], index) => {
      const head = `${inner}${JSON.stringify(key)}: `;
      const comma = index < entries.length - 1 ? 1 : 0;
      return `${head}${renderJson(item, style, depth + 1, columns(head, style) + comma)}`;
    });
    return `{\n${lines.join(',\n')}\n${style.indent.repeat(depth)}}`;
  }
  return JSON.stringify(value);
}

function renderArray(
  items: readonly Json[],
  style: FormatStyle,
  depth: number,
  usedColumns: number
): string {
  if (items.length === 0) {
    return '[]';
  }
  if (items.every(isFlat)) {
    const inline = `[${items.map((item) => JSON.stringify(item)).join(', ')}]`;
    if (usedColumns + inline.length <= style.lineWidth) {
      return inline;
    }
  }
  const inner = style.indent.repeat(depth + 1);
  const lines = items.map((item, index) => {
    const comma = index < items.length - 1 ? 1 : 0;
    return `${inner}${renderJson(item, style, depth + 1, columns(inner, style) + comma)}`;
  });
  return `[\n${lines.join(',\n')}\n${style.indent.repeat(depth)}]`;
}

/** Values that Biome keeps on one line inside an array: scalars and empty containers. */
function isFlat(value: Json): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (isObject(value)) {
    return Object.keys(value).length === 0;
  }
  return true;
}

/** Width of a line start, counting a tab as one indentation level. */
export function columns(text: string, style: FormatStyle): number {
  return text.replaceAll('\t', ' '.repeat(style.indentWidth)).length;
}

/**
 * Merges configuration fragments: objects key by key, arrays as a union in order, and other
 * values replaced by the later fragment.
 */
export function mergeJson(base: Json, addition: Json): Json {
  if (isObject(base) && isObject(addition)) {
    const merged: Record<string, Json> = { ...(base as JsonObject) };
    for (const [key, value] of Object.entries(addition as JsonObject)) {
      merged[key] = Object.hasOwn(merged, key) ? mergeJson(merged[key] as Json, value) : value;
    }
    return merged;
  }
  if (Array.isArray(base) && Array.isArray(addition)) {
    const seen = new Set(base.map((item: Json) => JSON.stringify(item)));
    return [...base, ...addition.filter((item: Json) => !seen.has(JSON.stringify(item)))];
  }
  return addition;
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
  const { active, inactive } = fragmentsFor(resolution, 'biome');
  // The file sits in the project as a nested configuration, which Biome requires to say so.
  const config = active.reduce<Json>(mergeJson, { root: false });
  const off = inactive.map(turnedOff).reduce<Json>(mergeJson, {});
  return withDefaults(config, off) as JsonObject;
}

/**
 * Adds the settings of `defaults` that `config` does not have. Where both set a value,
 * `config` wins, and its keys keep their order.
 */
export function withDefaults(config: Json, defaults: Json): Json {
  return mergeJson(config, mergeJson(defaults, config));
}

/** Generates `quality-rules/biome.json`. */
export const biomeGenerator: Generator = {
  file: 'biome.json',
  guidance: 'biome.json: add "extends": ["./quality-rules/biome.json"]',
  render: (context) => formatJson(biomeConfig(context.resolution), context.style),
};
