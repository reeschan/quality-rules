import type { Rule } from 'eslint';

/** Options of `quality-rules/no-scientific-literal`. */
interface NoScientificLiteralOptions {
  /**
   * Glob patterns of the files where scientific notation is allowed. A pattern is matched
   * against the end of the file path, so `src/tolerance.ts` matches `/work/app/src/tolerance.ts`.
   * `*` matches within one path segment, `**` matches across segments and `?` matches one character.
   */
  readonly allowFiles?: readonly string[];
}

/** A decimal literal with an exponent, such as `1e-9` or `2.5E3`. Hex and binary never match. */
const SCIENTIFIC_NOTATION = /^[\d._]+[eE]/;

const REGEXP_SPECIAL = /[\\^$.*+?()[\]{}|]/g;

/** Turns one glob pattern into a regular expression that must match the end of a path. */
function globToRegExp(glob: string): RegExp {
  const normalized = glob.replaceAll('\\', '/').replace(/^\.\//, '');
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized.charAt(index);
    if (char === '*') {
      if (normalized.charAt(index + 1) === '*') {
        index += 1;
        if (normalized.charAt(index + 1) === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(REGEXP_SPECIAL, '\\$&');
    }
  }
  return new RegExp(`(?:^|/)${source}$`);
}

/**
 * Builds a test that tells whether a file path matches one of the glob patterns.
 * Shared by the rules that take a list of allowed files.
 */
export function createFileMatcher(globs: readonly string[]): (filename: string) => boolean {
  const patterns = globs.map(globToRegExp);
  return (filename) => {
    const normalized = filename.replaceAll('\\', '/');
    return patterns.some((pattern) => pattern.test(normalized));
  };
}

/** JSON schema of the options of the rules that take a list of allowed files. */
export const allowFilesSchema = [
  {
    type: 'object',
    properties: {
      allowFiles: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    },
    additionalProperties: false,
  },
] as const;

/**
 * Reports numeric literals written in scientific notation, so that tolerances and other small
 * values are defined once in the allowed files instead of being spread over the code.
 */
export const noScientificLiteral: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow numeric literals in scientific notation outside the allowed files',
    },
    messages: {
      noScientificLiteral:
        "Scientific notation '{{raw}}' is not allowed here. Define the value in one of the allowed files and import it instead.",
    },
    schema: [...allowFilesSchema],
  },
  create(context) {
    const options = (context.options[0] ?? {}) as NoScientificLiteralOptions;
    if (createFileMatcher(options.allowFiles ?? [])(context.filename)) {
      return {};
    }
    return {
      Literal(node) {
        if (typeof node.value !== 'number') {
          return;
        }
        const raw = node.raw ?? '';
        if (SCIENTIFIC_NOTATION.test(raw)) {
          context.report({ node, messageId: 'noScientificLiteral', data: { raw } });
        }
      },
    };
  },
};
