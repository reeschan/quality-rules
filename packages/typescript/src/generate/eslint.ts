import { FragmentKind } from '../catalog/fragment-kind.ts';
import type { Catalog } from '../catalog/types.ts';
import { isObject, type Json, type JsonObject, mergeJson, withDefaults } from '../json.ts';
import { PLUGIN_NAME } from '../plugin-name.ts';
import { fragmentsFor, type Resolution } from '../resolve/resolve.ts';
import { columns, type FormatStyle } from './format.ts';
import type { Generator, GeneratorContext } from './index.ts';

/**
 * File name of the generated ESLint configuration. It is not named `eslint.config.*`, so that
 * ESLint does not take it as the configuration of the `quality-rules/` folder.
 */
export const ESLINT_FILE = 'eslint.mjs';

/** The parser that the generated configuration gives ESLint, so that it reads TypeScript. */
export const TYPESCRIPT_PARSER = '@typescript-eslint/parser';

/** The files that the generated configuration applies to. */
const LINTED_FILES = '**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}';

/** Name of the variable that holds the plugin of the custom rules. */
const CUSTOM_PLUGIN_VARIABLE = 'qualityRules';
const PARSER_VARIABLE = 'typescriptParser';

/** The flat config settings of the rules in effect, before the imports are put in. */
export interface EslintSettings {
  /** Plugin name (the prefix of its rule IDs) to the package that exports the plugin. */
  readonly plugins: Readonly<Record<string, string>>;
  readonly linterOptions: JsonObject | undefined;
  readonly settings: JsonObject | undefined;
  readonly rules: JsonObject;
}

/**
 * The `eslint` fragments of the rules in effect, merged. Rules of the selected packs that are
 * left out are set to `off` (unless a rule in effect sets the same ESLint rule), so that they
 * stay quiet when the project's configuration turns them on before the generated one. Their
 * plugins are not loaded: ESLint does not look up the rule of an `off` setting.
 */
export function eslintSettings(resolution: Resolution): EslintSettings {
  const { active, inactive } = fragmentsFor(resolution, FragmentKind.ESLINT);
  const merged = active.reduce<Json>(mergeJson, {}) as JsonObject;
  const off: Record<string, Json> = {};
  for (const fragment of inactive) {
    for (const name of Object.keys(isObject(fragment.rules) ? fragment.rules : {})) {
      off[name] = 'off';
    }
  }
  const objectOrUndefined = (value: Json | undefined) =>
    isObject(value) ? (value as JsonObject) : undefined;
  return {
    plugins: (objectOrUndefined(merged.plugins) ?? {}) as Record<string, string>,
    linterOptions: objectOrUndefined(merged.linterOptions),
    settings: objectOrUndefined(merged.settings),
    rules: withDefaults(objectOrUndefined(merged.rules) ?? {}, off) as JsonObject,
  };
}

/** The packages that the generated configuration imports, other than the packs' own packages. */
export function eslintImports(settings: EslintSettings): string[] {
  return [TYPESCRIPT_PARSER, ...[...new Set(Object.values(settings.plugins))].sort()];
}

/** JavaScript written as it is in the generated file, such as the name of an imported value. */
class Code {
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }
}

/** A value of the generated configuration: JSON, or JavaScript written as it is. */
type JsValue = Json | Code | readonly JsValue[] | { readonly [key: string]: JsValue };

/**
 * The source of `quality-rules/eslint.mjs`: a flat config array with one configuration object.
 * It loads the TypeScript parser, a plugin named `quality-rules` that holds the custom rules
 * of every installed package that has them, and the plugins that the `eslint` fragments name,
 * all by package name, so that they resolve from the project's `node_modules`. The layout is
 * the one Prettier gives the file with the generated Prettier settings.
 */
export function eslintSource(catalog: Catalog, resolution: Resolution, style: FormatStyle): string {
  const settings = eslintSettings(resolution);
  const pluginNames = Object.keys(settings.plugins).sort();
  const pluginVariables = new Map(pluginNames.map((name, index) => [name, `plugin${index}`]));
  const rulesModules = catalog.packages
    .map((item) => item.rulesModule)
    .filter((specifier) => specifier !== undefined);
  const quoted = (text: string) => quote(text, style);

  const imports = [
    `import ${PARSER_VARIABLE} from ${quoted(TYPESCRIPT_PARSER)};`,
    ...pluginNames.map(
      (name) => `import ${pluginVariables.get(name)} from ${quoted(settings.plugins[name] ?? '')};`
    ),
    ...rulesModules.map(
      (specifier, index) => `import * as rules${index} from ${quoted(specifier)};`
    ),
  ];
  const plugins: Record<string, JsValue> = { [PLUGIN_NAME]: new Code(CUSTOM_PLUGIN_VARIABLE) };
  for (const [name, variable] of pluginVariables) {
    plugins[name] = new Code(variable);
  }
  const config: Record<string, JsValue> = {
    files: [LINTED_FILES],
    languageOptions: {
      parser: new Code(PARSER_VARIABLE),
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    ...(settings.linterOptions === undefined ? {} : { linterOptions: settings.linterOptions }),
    plugins,
    ...(settings.settings === undefined ? {} : { settings: settings.settings }),
    rules: settings.rules,
  };
  const lines = [
    '// Generated by quality-rules from quality-rules.json. Do not edit; run `quality-rules sync`.',
    "// Spread it first in the project's eslint.config.mjs and add the project's own settings after it.",
    ...imports,
    '',
    ...customPluginLines(rulesModules.length, style),
    '',
    `export default ${renderJs([config], style, 0, columns('export default ', style))};`,
  ];
  return `${lines.join('\n')}\n`;
}

/** The declaration of the plugin that holds the custom rules of every package. */
function customPluginLines(moduleCount: number, style: FormatStyle): string[] {
  const indent = style.indent;
  const lastComma = style.trailingComma ? ',' : '';
  const spreads = Array.from({ length: moduleCount }, (_item, index) => `...rules${index}.rules`);
  const rules =
    spreads.length === 0
      ? [`${indent}rules: {}${lastComma}`]
      : [
          `${indent}rules: {`,
          ...spreads.map(
            (spread, index) =>
              `${indent}${indent}${spread}${index < spreads.length - 1 ? ',' : lastComma}`
          ),
          `${indent}}${lastComma}`,
        ];
  return [
    `const ${CUSTOM_PLUGIN_VARIABLE} = {`,
    `${indent}meta: { name: ${quote(PLUGIN_NAME, style)} },`,
    ...rules,
    '};',
  ];
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Writes a value as a JavaScript expression laid out the way Prettier formats it: objects one
 * property per line (Prettier keeps an object expanded when it starts on a new line), arrays
 * on one line when they fit, and a string that does not fit after its key on the next line.
 * `usedColumns` is the width of the line before the value.
 */
function renderJs(value: JsValue, style: FormatStyle, depth: number, usedColumns: number): string {
  if (value instanceof Code) {
    return value.text;
  }
  if (Array.isArray(value)) {
    return renderArray(value, style, depth, usedColumns);
  }
  if (isObject(value)) {
    return renderObject(value as Record<string, JsValue>, style, depth);
  }
  if (typeof value === 'string') {
    return quote(value, style);
  }
  return JSON.stringify(value);
}

function renderObject(
  value: Readonly<Record<string, JsValue>>,
  style: FormatStyle,
  depth: number
): string {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return '{}';
  }
  const inner = style.indent.repeat(depth + 1);
  const lines = entries.map(([key, item], index) => {
    const name = IDENTIFIER.test(key) ? key : quote(key, style);
    const head = `${inner}${name}: `;
    const comma = commaWidth(index, entries.length, style);
    if (typeof item === 'string' && breaksAfterKey({ name, head, item, comma }, style)) {
      return `${inner}${name}:\n${inner}${style.indent}${quote(item, style)}`;
    }
    return `${head}${renderJs(item, style, depth + 1, columns(head, style) + comma)}`;
  });
  return `{\n${joinItems(lines, style)}\n${style.indent.repeat(depth)}}`;
}

/** A property whose value is a string, as {@link renderObject} lays it out. */
interface StringProperty {
  /** The key as written: an identifier or a string literal. */
  readonly name: string;
  /** The line up to the value: the indentation, the key and `: `. */
  readonly head: string;
  readonly item: string;
  /** Width of the comma after the value. */
  readonly comma: number;
}

/**
 * Whether Prettier puts a string value on the line after its key: when the property does not
 * fit in the line width and the key is long enough for the move to win columns.
 */
function breaksAfterKey(property: StringProperty, style: FormatStyle): boolean {
  const { name, head, item, comma } = property;
  const minimumOverlap = 3;
  const fits = columns(head, style) + quote(item, style).length + comma <= style.lineWidth;
  return !fits && name.length >= style.indentWidth + minimumOverlap;
}

function renderArray(
  items: readonly JsValue[],
  style: FormatStyle,
  depth: number,
  usedColumns: number
): string {
  if (items.length === 0) {
    return '[]';
  }
  if (items.every(isInline) && !isTable(items)) {
    const inline = `[${items.map((item) => renderJs(item, style, depth, 0)).join(', ')}]`;
    if (usedColumns + inline.length <= style.lineWidth) {
      return inline;
    }
  }
  const inner = style.indent.repeat(depth + 1);
  const lines = items.map(
    (item, index) =>
      `${inner}${renderJs(item, style, depth + 1, columns(inner, style) + commaWidth(index, items.length, style))}`
  );
  return `[\n${joinItems(lines, style)}\n${style.indent.repeat(depth)}]`;
}

/** Values that can stay on one line: everything but objects with properties. */
function isInline(value: JsValue): boolean {
  if (value instanceof Code) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isInline);
  }
  if (isObject(value)) {
    return Object.keys(value).length === 0;
  }
  return true;
}

/** Arrays that Prettier always writes one item per line: two or more arrays of two or more. */
function isTable(items: readonly JsValue[]): boolean {
  return items.length > 1 && items.every((item) => Array.isArray(item) && item.length > 1);
}

/** Width of the comma after an item: every item but the last has one, and the last may too. */
function commaWidth(index: number, count: number, style: FormatStyle): number {
  return index < count - 1 || style.trailingComma ? 1 : 0;
}

/** Joins the lines of a multi-line object or array, with a comma after the last if wanted. */
function joinItems(lines: readonly string[], style: FormatStyle): string {
  return `${lines.join(',\n')}${style.trailingComma ? ',' : ''}`;
}

/** A string literal in the quote style, switching quotes when that saves escapes as Prettier does. */
function quote(text: string, style: FormatStyle): string {
  const other = style.quote === "'" ? '"' : "'";
  const count = (mark: string) => text.split(mark).length - 1;
  const mark = count(style.quote) > count(other) ? other : style.quote;
  const body = JSON.stringify(text)
    .slice(1, -1)
    .replaceAll('\\"', '"')
    .replaceAll(mark, `\\${mark}`);
  return `${mark}${body}${mark}`;
}

/** Generates `quality-rules/eslint.mjs`. */
export const eslintGenerator: Generator = {
  file: ESLINT_FILE,
  guidance: (context: GeneratorContext) =>
    `eslint.config.mjs: import "./quality-rules/${ESLINT_FILE}" and spread its default export first (export default [...qualityRules, ...]); install the packages it imports: ${eslintImports(eslintSettings(context.resolution)).join(', ')}`,
  render: (context) => eslintSource(context.catalog, context.resolution, context.style),
};
