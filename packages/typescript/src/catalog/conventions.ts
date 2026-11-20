import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * An error the user can fix (a broken catalog, manifest or command line). The CLI prints its
 * message without a stack trace and exits with code 2.
 */
export class QualityRulesError extends Error {
  override name = 'QualityRulesError';
}

/** Category names that convention IDs start with, as in `NAME-1` or `STYLE-2`. */
export const CONVENTION_CATEGORIES: readonly string[] = [
  'NAME',
  'GEN',
  'FIX',
  'REUSE',
  'CONCERN',
  'TYPE',
  'CMT',
  'UX',
  'E2E',
  'UNIT',
  'STYLE',
];

/** Layer of the conventions that do not depend on a language. They carry no example code. */
export const COMMON_LAYER = 'common';

/** Section headings of a convention file, in the order they are written. */
export const SECTIONS = {
  reason: '理由',
  bad: '悪い例',
  good: '良い例',
  questions: '確かめる問い',
  remainder: '機械では拾えない残り',
} as const;

const SECTION_ORDER: readonly string[] = [
  SECTIONS.reason,
  SECTIONS.bad,
  SECTIONS.good,
  SECTIONS.questions,
  SECTIONS.remainder,
];

const EXAMPLE_SECTIONS: readonly string[] = [SECTIONS.bad, SECTIONS.good];

/** Front matter keys of a convention file, in the order they are written. */
const FIELD_ORDER = ['id', 'layer', 'pack', 'added', 'check'] as const;

/** Value of the `check` field when no rule checks the convention. */
const NO_CHECK = 'none';

const CONVENTION_ID = /^(?<category>[A-Z][A-Z0-9]*)-[1-9]\d*$/;
/** Shape of a category name, and of the prefix of a project's own conventions. */
export const CATEGORY_NAME = /^[A-Z][A-Z0-9]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PACK_NAME = /^[a-z][a-z0-9-]*$/;
const FIELD_LINE = /^(?<key>[a-z][a-z-]*):\s*(?<value>.*)$/;
const FENCE = /^ {0,3}(?<marker>`{3,}|~{3,})/;

/** One `## heading` of a convention file and the text under it. */
export interface ConventionSection {
  readonly heading: string;
  readonly body: string;
}

/** A convention file split into its front matter, title and sections. */
export interface ConventionDocument {
  readonly fields: Readonly<Record<string, string>>;
  /** Text of the `# title` line, which is the one-line description of the convention. */
  readonly title: string | undefined;
  /** Text between the title and the first section. */
  readonly preamble: string;
  readonly sections: readonly ConventionSection[];
  /** Whether the text outside the front matter holds a fenced code block. */
  readonly hasCode: boolean;
}

/** A convention as the catalog knows it. */
export interface Convention {
  readonly id: string;
  readonly layer: string;
  readonly pack: string;
  /** Package version that added the convention. */
  readonly added: string;
  /** IDs of the rules that check the convention by machine. Empty when none does. */
  readonly check: readonly string[];
  readonly title: string;
}

/**
 * Splits the text of a convention file. The file starts with front matter of `key: value`
 * lines between `---` lines, then a `# title` line, then `## section` blocks.
 * Problems with the shape are returned as messages instead of thrown, so that one run can
 * report every broken file.
 */
export function parseConventionDocument(text: string): {
  document: ConventionDocument;
  problems: string[];
} {
  const problems: string[] = [];
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const fields: Record<string, string> = {};
  let index = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end === -1) {
      problems.push('front matter is not closed with a "---" line');
    } else {
      for (const line of lines.slice(1, end)) {
        readFieldLine(line, fields, problems);
      }
      index = end + 1;
    }
  }
  const body = splitBody(lines.slice(index));
  return { document: { fields, ...body }, problems };
}

function readFieldLine(line: string, fields: Record<string, string>, problems: string[]): void {
  if (line.trim() === '') {
    return;
  }
  const groups = FIELD_LINE.exec(line)?.groups;
  if (groups?.key === undefined || groups.value === undefined) {
    problems.push(`front matter line "${line}" is not "key: value"`);
    return;
  }
  if (Object.hasOwn(fields, groups.key)) {
    problems.push(`front matter field "${groups.key}" is written twice`);
    return;
  }
  fields[groups.key] = groups.value.trim();
}

function splitBody(lines: readonly string[]): Omit<ConventionDocument, 'fields'> {
  let title: string | undefined;
  const preamble: string[] = [];
  const sections: { heading: string; lines: string[] }[] = [];
  let fence: string | undefined;
  let hasCode = false;
  for (const line of lines) {
    const marker = FENCE.exec(line)?.groups?.marker;
    if (marker !== undefined) {
      hasCode = true;
      if (fence === undefined) {
        fence = marker;
      } else if (marker.startsWith(fence)) {
        fence = undefined;
      }
    }
    const isOutsideCode = fence === undefined && marker === undefined;
    if (isOutsideCode && title === undefined && sections.length === 0 && line.startsWith('# ')) {
      title = line.slice(2).trim();
    } else if (isOutsideCode && line.startsWith('## ')) {
      sections.push({ heading: line.slice(3).trim(), lines: [] });
    } else {
      (sections.at(-1)?.lines ?? preamble).push(line);
    }
  }
  return {
    title,
    preamble: preamble.join('\n').trim(),
    sections: sections.map((section) => ({
      heading: section.heading,
      body: section.lines.join('\n').trim(),
    })),
    hasCode,
  };
}

/**
 * Checks a complete convention (as published, with its examples) and returns it with the
 * problems found. `fileId` is the file name without `.md`, which must equal the ID.
 */
export function readConvention(
  document: ConventionDocument,
  fileId: string
): { convention: Convention; problems: string[] } {
  const problems = checkFields(document, fileId);
  problems.push(...checkSections(document, SECTION_ORDER));
  return { convention: toConvention(document), problems };
}

function checkFields(document: ConventionDocument, fileId: string): string[] {
  const problems: string[] = [];
  const { fields } = document;
  for (const key of FIELD_ORDER) {
    if ((fields[key] ?? '') === '') {
      problems.push(`missing field "${key}"`);
    }
  }
  for (const key of Object.keys(fields)) {
    if (!(FIELD_ORDER as readonly string[]).includes(key)) {
      problems.push(`unknown field "${key}"`);
    }
  }
  const id = fields.id ?? '';
  const category = CONVENTION_ID.exec(id)?.groups?.category;
  if (id !== '' && category === undefined) {
    problems.push(`id "${id}" is not a category name and a number, such as NAME-1`);
  } else if (category !== undefined && !CONVENTION_CATEGORIES.includes(category)) {
    problems.push(
      `id "${id}" does not start with a category name (${CONVENTION_CATEGORIES.join(', ')})`
    );
  }
  if (id !== '' && id !== fileId) {
    problems.push(`id "${id}" does not match the file name ${fileId}.md`);
  }
  if (fields.pack !== undefined && fields.pack !== '' && !PACK_NAME.test(fields.pack)) {
    problems.push(`pack "${fields.pack}" is not a lowercase name such as size-limits`);
  }
  if (fields.added !== undefined && fields.added !== '' && !VERSION.test(fields.added)) {
    problems.push(`added "${fields.added}" is not a version such as 1.2.0`);
  }
  if ((document.title ?? '') === '') {
    problems.push('missing the "# title" line');
  }
  return problems;
}

function checkSections(document: ConventionDocument, required: readonly string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const section of document.sections) {
    if (seen.has(section.heading)) {
      problems.push(`section "${section.heading}" is written twice`);
    }
    seen.add(section.heading);
  }
  for (const heading of required) {
    const section = document.sections.find((candidate) => candidate.heading === heading);
    if (section === undefined) {
      problems.push(`missing section "## ${heading}"`);
    } else if (section.body === '') {
      problems.push(`section "## ${heading}" is empty`);
    }
  }
  return problems;
}

function toConvention(document: ConventionDocument): Convention {
  const { fields } = document;
  const check = (fields.check ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '' && value !== NO_CHECK);
  return {
    id: fields.id ?? '',
    layer: fields.layer ?? '',
    pack: fields.pack ?? '',
    added: fields.added ?? '',
    check,
    title: document.title ?? '',
  };
}

/** Writes a convention back as text, with fields and sections in the canonical order. */
export function renderConventionDocument(document: ConventionDocument): string {
  const fieldLines = [
    ...FIELD_ORDER.filter((key) => document.fields[key] !== undefined),
    ...Object.keys(document.fields).filter(
      (key) => !(FIELD_ORDER as readonly string[]).includes(key)
    ),
  ].map((key) => `${key}: ${document.fields[key] ?? ''}`);
  const sections = [
    ...SECTION_ORDER.flatMap((heading) =>
      document.sections.filter((section) => section.heading === heading)
    ),
    ...document.sections.filter((section) => !SECTION_ORDER.includes(section.heading)),
  ];
  const blocks = [
    ['---', ...fieldLines, '---'].join('\n'),
    `# ${document.title ?? ''}`,
    ...(document.preamble === '' ? [] : [document.preamble]),
    ...sections.map((section) => `## ${section.heading}\n\n${section.body}`),
  ];
  return `${blocks.join('\n\n')}\n`;
}

/** Where the convention sources of a language package are, for {@link bundleConventions}. */
export interface ConventionSources {
  /** Folder of the common conventions (`<ID>.md`, prose only). */
  readonly commonDir: string;
  /** Folder of the language's examples for the common conventions (`<ID>.md`). */
  readonly examplesDir: string;
  /** Folder of the language layer's own conventions (`<ID>.md`, with their examples). */
  readonly layerDir: string;
}

/**
 * Builds the published conventions of a language package: each common convention joined with
 * the language's example for it, and each convention of the language layer as it is.
 * Returns the documents by ID, or throws a {@link QualityRulesError} listing every problem.
 */
export async function assembleConventions(
  sources: ConventionSources
): Promise<Map<string, ConventionDocument>> {
  const problems: string[] = [];
  const common = await readMarkdownFolder(sources.commonDir);
  const examples = await readMarkdownFolder(sources.examplesDir);
  const layer = await readMarkdownFolder(sources.layerDir);
  const assembled = new Map<string, ConventionDocument>();

  for (const [fileId, text] of common) {
    const where = path.join(sources.commonDir, `${fileId}.md`);
    const document = joinCommonConvention(fileId, text, examples.get(fileId), problems, where);
    if (document !== undefined) {
      assembled.set(fileId, document);
    }
  }
  for (const fileId of examples.keys()) {
    if (!common.has(fileId)) {
      problems.push(
        `${path.join(sources.examplesDir, `${fileId}.md`)}: no common convention ${fileId}.md`
      );
    }
  }
  for (const [fileId, text] of layer) {
    const where = path.join(sources.layerDir, `${fileId}.md`);
    const { document, problems: parseProblems } = parseConventionDocument(text);
    const { problems: shapeProblems } = readConvention(document, fileId);
    const layerProblems = [...parseProblems, ...shapeProblems];
    if (document.fields.layer === COMMON_LAYER) {
      layerProblems.push(
        `layer is "${COMMON_LAYER}"; common conventions belong to the rules package`
      );
    }
    if (assembled.has(fileId)) {
      layerProblems.push(`ID ${fileId} is also a common convention`);
    }
    problems.push(...layerProblems.map((problem) => `${where}: ${problem}`));
    assembled.set(fileId, document);
  }
  if (problems.length > 0) {
    throw new QualityRulesError(`Convention sources have problems:\n${listLines(problems)}`);
  }
  return assembled;
}

function joinCommonConvention(
  fileId: string,
  text: string,
  exampleText: string | undefined,
  problems: string[],
  where: string
): ConventionDocument | undefined {
  const { document, problems: parseProblems } = parseConventionDocument(text);
  const own = [...parseProblems];
  if (document.fields.layer !== undefined && document.fields.layer !== COMMON_LAYER) {
    own.push(`layer is "${document.fields.layer}"; common conventions use "${COMMON_LAYER}"`);
  }
  if (document.hasCode) {
    own.push('common conventions hold no example code; write examples in the language package');
  }
  for (const heading of EXAMPLE_SECTIONS) {
    if (document.sections.some((section) => section.heading === heading)) {
      own.push(`section "## ${heading}" belongs in the language package's example file`);
    }
  }
  if (exampleText === undefined) {
    own.push(`no example file ${fileId}.md in the language package`);
    problems.push(...own.map((problem) => `${where}: ${problem}`));
    return undefined;
  }
  const example = parseConventionDocument(exampleText).document;
  const unexpected = example.sections.filter(
    (section) => !EXAMPLE_SECTIONS.includes(section.heading)
  );
  for (const section of unexpected) {
    own.push(
      `example file has section "## ${section.heading}"; only 悪い例 and 良い例 belong there`
    );
  }
  const joined: ConventionDocument = {
    ...document,
    sections: [...document.sections, ...example.sections],
    hasCode: example.hasCode,
  };
  own.push(...readConvention(joined, fileId).problems);
  problems.push(...own.map((problem) => `${where}: ${problem}`));
  return joined;
}

/**
 * Reads every `<ID>.md` file directly in a folder, as text by file name without `.md`.
 * A missing folder has no files.
 */
export async function readMarkdownFolder(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isMissingFile(error)) {
      return files;
    }
    throw error;
  }
  for (const name of names.filter((entry) => entry.endsWith('.md')).sort()) {
    files.set(name.slice(0, -'.md'.length), await readFile(path.join(dir, name), 'utf8'));
  }
  return files;
}

/**
 * Writes the published conventions (`<outDir>/<ID>.md`). Earlier `.md` files in `outDir` are
 * removed first so that a deleted convention does not linger. Returns the written IDs.
 */
export async function bundleConventions(
  sources: ConventionSources,
  outDir: string
): Promise<string[]> {
  const assembled = await assembleConventions(sources);
  await mkdir(outDir, { recursive: true });
  for (const name of await readdir(outDir)) {
    if (name.endsWith('.md')) {
      await rm(path.join(outDir, name));
    }
  }
  const ids = [...assembled.keys()].sort();
  for (const id of ids) {
    const document = assembled.get(id);
    if (document !== undefined) {
      await writeFile(path.join(outDir, `${id}.md`), renderConventionDocument(document));
    }
  }
  return ids;
}

/** Reads the published conventions of an installed package. A missing folder has none. */
export async function readPublishedConventions(
  dir: string
): Promise<{ conventions: Convention[]; problems: string[] }> {
  const conventions: Convention[] = [];
  const problems: string[] = [];
  for (const [fileId, text] of await readMarkdownFolder(dir)) {
    const { document, problems: parseProblems } = parseConventionDocument(text);
    const { convention, problems: shapeProblems } = readConvention(document, fileId);
    const fileProblems = [...parseProblems, ...shapeProblems];
    problems.push(...fileProblems.map((problem) => `${fileId}.md: ${problem}`));
    if (fileProblems.length === 0) {
      conventions.push(convention);
    }
  }
  return { conventions, problems };
}

/** Indents problem messages as a list under a heading line. */
export function listLines(lines: readonly string[]): string {
  return lines.map((line) => `  - ${line}`).join('\n');
}

/** Whether an error from `node:fs` means that the path does not exist. */
export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Whether a version string has the `major.minor.patch` shape. */
export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION.test(value);
}

/** Whether a pack name has the lowercase shape used for `packs/<pack>.json`. */
export function isPackName(value: string): boolean {
  return PACK_NAME.test(value);
}
