/** A comment of JavaScript or TypeScript source code. */
export interface SourceComment {
  /** The text between the comment markers. */
  readonly text: string;
  /** 1-based line where the comment starts. */
  readonly line: number;
  /** Offset of the first character of the comment. */
  readonly start: number;
  /** Offset just after the comment. */
  readonly end: number;
}

/** The characters after which a `/` starts a regular expression rather than a division. */
const BEFORE_REGEX = new Set([...'(,=:[!&|?{};+-*%<>~^']);

/** The keywords after which a `/` starts a regular expression rather than a division. */
const KEYWORDS_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

const WORD_CHARACTER = /[\w$]/;

/**
 * The comments of source code. Strings, template literals and regular expressions are skipped,
 * so text such as `'// note'` in them is not read as a comment. It is a small tokenizer, not a
 * parser: comments inside the `${...}` of a template literal are not read.
 */
export function commentsOf(code: string): SourceComment[] {
  const comments: SourceComment[] = [];
  let index = 0;
  let line = 1;
  let regexAllowed = true;
  while (index < code.length) {
    const token = nextToken(code, index, regexAllowed);
    if (token.comment !== undefined) {
      comments.push({ text: token.comment, line, start: index, end: token.end });
    } else if (token.regexAllowed !== undefined) {
      regexAllowed = token.regexAllowed;
    }
    line += newlinesIn(code, index, token.end);
    index = token.end;
  }
  return comments;
}

/**
 * Removes the comments from source code and keeps the strings, so that an import written in a
 * comment is not read as an import. Each comment becomes one space.
 */
export function stripComments(code: string): string {
  let result = '';
  let index = 0;
  for (const comment of commentsOf(code)) {
    result += `${code.slice(index, comment.start)} `;
    index = comment.end;
  }
  return result + code.slice(index);
}

/** One token: where it ends, the text of a comment, and whether a regex may follow it. */
interface Token {
  readonly end: number;
  /** The text of the comment, when the token is one. */
  readonly comment?: string;
  /** Whether a `/` after the token starts a regular expression; unset for whitespace. */
  readonly regexAllowed?: boolean;
}

function nextToken(code: string, index: number, regexAllowed: boolean): Token {
  const char = code.charAt(index);
  const next = code.charAt(index + 1);
  if (char === '/' && next === '/') {
    const end = lineEnd(code, index);
    return { end, comment: code.slice(index + 2, end) };
  }
  if (char === '/' && next === '*') {
    const close = code.indexOf('*/', index + 2);
    const end = close === -1 ? code.length : close + 2;
    return { end, comment: code.slice(index + 2, close === -1 ? code.length : close) };
  }
  if (char === '"' || char === "'" || char === '`') {
    return { end: quotedEnd(code, index), regexAllowed: false };
  }
  if (char === '/' && regexAllowed) {
    const end = regexEnd(code, index);
    return { end, regexAllowed: end === index + 1 };
  }
  if (WORD_CHARACTER.test(char)) {
    const end = wordEnd(code, index);
    return { end, regexAllowed: KEYWORDS_BEFORE_REGEX.has(code.slice(index, end)) };
  }
  if (/\s/.test(char)) {
    return { end: index + 1 };
  }
  return { end: index + 1, regexAllowed: BEFORE_REGEX.has(char) };
}

function lineEnd(code: string, index: number): number {
  const newline = code.indexOf('\n', index);
  return newline === -1 ? code.length : newline;
}

function wordEnd(code: string, index: number): number {
  let end = index;
  while (end < code.length && WORD_CHARACTER.test(code.charAt(end))) {
    end += 1;
  }
  return end;
}

/** The end of a string or template literal. A quote string also ends at the end of its line. */
function quotedEnd(code: string, index: number): number {
  const quote = code.charAt(index);
  let end = index + 1;
  while (end < code.length && code.charAt(end) !== quote) {
    if (quote !== '`' && code.charAt(end) === '\n') {
      return end;
    }
    end += code.charAt(end) === '\\' ? 2 : 1;
  }
  return Math.min(end + 1, code.length);
}

/**
 * The end of a regular expression with its flags. When the line ends before the closing `/`,
 * the `/` was not a regular expression, and the token is the `/` alone.
 */
function regexEnd(code: string, index: number): number {
  let end = index + 1;
  let inClass = false;
  while (end < code.length) {
    const char = code.charAt(end);
    if (char === '\n') {
      return index + 1;
    }
    if (char === '/' && !inClass) {
      return wordEnd(code, end + 1);
    }
    if (char === '[' || char === ']') {
      inClass = char === '[';
    }
    end += char === '\\' ? 2 : 1;
  }
  return index + 1;
}

function newlinesIn(code: string, start: number, end: number): number {
  let count = 0;
  for (let index = start; index < end; index += 1) {
    if (code.charAt(index) === '\n') {
      count += 1;
    }
  }
  return count;
}
