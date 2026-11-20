import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isMissingFile } from '../errors.ts';
import {
  type ConventionDocument,
  FIELD_ORDER,
  parseConventionDocument,
  SECTION_ORDER,
} from './convention-document.ts';
import { isPackName, isVersion } from './names.ts';

/** Category names that convention IDs start with, as in `NAME-1` or `STYLE-2`. */
export const ConventionCategory = {
  NAME: 'NAME',
  GEN: 'GEN',
  FIX: 'FIX',
  REUSE: 'REUSE',
  CONCERN: 'CONCERN',
  TYPE: 'TYPE',
  CMT: 'CMT',
  UX: 'UX',
  E2E: 'E2E',
  UNIT: 'UNIT',
  STYLE: 'STYLE',
} as const;
export type ConventionCategory = (typeof ConventionCategory)[keyof typeof ConventionCategory];

/** The {@link ConventionCategory} names, in the order that messages list them. */
export const CONVENTION_CATEGORY_NAMES: readonly ConventionCategory[] =
  Object.values(ConventionCategory);

/** Whether a name is one of the {@link ConventionCategory} names. */
export function isConventionCategory(name: string): name is ConventionCategory {
  return CONVENTION_CATEGORY_NAMES.some((category) => category === name);
}

/**
 * Layers that the CLI treats in a special way. A language package names its own layer (such as
 * `typescript`), which the CLI reads as it is, so a new language needs no change here.
 */
export const ConventionLayer = {
  /** The conventions that do not depend on a language. They carry no example code. */
  COMMON: 'common',
} as const;
export type ConventionLayer = (typeof ConventionLayer)[keyof typeof ConventionLayer];

/** Value of the `check` field when no rule checks the convention. */
const NO_CHECK = 'none';

const CONVENTION_ID = /^(?<category>[A-Z][A-Z0-9]*)-[1-9]\d*$/;

/** A convention as the catalog knows it. */
export interface Convention {
  readonly id: string;
  /** The layer: {@link ConventionLayer.COMMON} or the layer of a language package. */
  readonly layer: string;
  readonly pack: string;
  /** Package version that added the convention. */
  readonly added: string;
  /** IDs of the rules that check the convention by machine. Empty when none does. */
  readonly check: readonly string[];
  readonly title: string;
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
  const { fields } = document;
  const problems = [
    ...checkFieldKeys(fields),
    ...checkId(fields.id ?? '', fileId),
    ...checkFieldValues(fields),
  ];
  if ((document.title ?? '') === '') {
    problems.push('missing the "# title" line');
  }
  return problems;
}

/** Problems with the front matter keys: missing or empty fields, and unknown ones. */
function checkFieldKeys(fields: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
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
  return problems;
}

/** Problems with the `id` field: its shape, its category and whether it matches the file. */
function checkId(id: string, fileId: string): string[] {
  const problems: string[] = [];
  const category = CONVENTION_ID.exec(id)?.groups?.category;
  if (id !== '' && category === undefined) {
    problems.push(`id "${id}" is not a category name and a number, such as NAME-1`);
  } else if (category !== undefined && !isConventionCategory(category)) {
    problems.push(
      `id "${id}" does not start with a category name (${CONVENTION_CATEGORY_NAMES.join(', ')})`
    );
  }
  if (id !== '' && id !== fileId) {
    problems.push(`id "${id}" does not match the file name ${fileId}.md`);
  }
  return problems;
}

/** Problems with the shape of the `pack` and `added` fields, when they are written. */
function checkFieldValues(fields: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const { pack, added } = fields;
  if (pack !== undefined && pack !== '' && !isPackName(pack)) {
    problems.push(`pack "${pack}" is not a lowercase name such as size-limits`);
  }
  if (added !== undefined && added !== '' && !isVersion(added)) {
    problems.push(`added "${added}" is not a version such as 1.2.0`);
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
