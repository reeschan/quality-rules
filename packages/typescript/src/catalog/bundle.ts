import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listLines, QualityRulesError } from '../errors.ts';
import {
  type ConventionDocument,
  parseConventionDocument,
  renderConventionDocument,
  SECTIONS,
} from './convention-document.ts';
import { ConventionLayer, readConvention, readMarkdownFolder } from './conventions.ts';

const EXAMPLE_SECTIONS: readonly string[] = [SECTIONS.bad, SECTIONS.good];

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
    const joined = joinCommonConvention({
      fileId,
      text,
      exampleText: examples.get(fileId),
      where: path.join(sources.commonDir, `${fileId}.md`),
    });
    problems.push(...joined.problems);
    if (joined.document !== undefined) {
      assembled.set(fileId, joined.document);
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
    if (document.fields.layer === ConventionLayer.COMMON) {
      layerProblems.push(
        `layer is "${ConventionLayer.COMMON}"; common conventions belong to the rules package`
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

/** A common convention file and the language package's example file for it. */
interface CommonConventionSource {
  /** The file name without `.md`. */
  readonly fileId: string;
  readonly text: string;
  /** Text of the example file, or `undefined` when there is none. */
  readonly exampleText: string | undefined;
  /** Path of the common convention file, which starts each problem message. */
  readonly where: string;
}

/**
 * Joins a common convention with its example. Returns the joined document (none when the
 * example file is missing) and the problems found, each starting with the file's path.
 */
function joinCommonConvention(source: CommonConventionSource): {
  document: ConventionDocument | undefined;
  problems: string[];
} {
  const { fileId, exampleText, where } = source;
  const { document, problems: parseProblems } = parseConventionDocument(source.text);
  const own = [...parseProblems];
  if (document.fields.layer !== undefined && document.fields.layer !== ConventionLayer.COMMON) {
    own.push(
      `layer is "${document.fields.layer}"; common conventions use "${ConventionLayer.COMMON}"`
    );
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
    return { document: undefined, problems: own.map((problem) => `${where}: ${problem}`) };
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
  return { document: joined, problems: own.map((problem) => `${where}: ${problem}`) };
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
