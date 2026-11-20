/** Section headings of a convention file, in the order they are written. */
export const SECTIONS = {
  reason: '理由',
  bad: '悪い例',
  good: '良い例',
  questions: '確かめる問い',
  remainder: '機械では拾えない残り',
} as const;

export const SECTION_ORDER: readonly string[] = [
  SECTIONS.reason,
  SECTIONS.bad,
  SECTIONS.good,
  SECTIONS.questions,
  SECTIONS.remainder,
];

/** Front matter keys of a convention file, in the order they are written. */
export const FIELD_ORDER = ['id', 'layer', 'pack', 'added', 'check'] as const;

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
