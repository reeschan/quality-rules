import { isObject, type Json, type JsonObject } from '../json.ts';

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
