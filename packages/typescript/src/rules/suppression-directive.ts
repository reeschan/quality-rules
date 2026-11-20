/**
 * Matches the start of a comment that is an eslint, oxlint or biome suppression directive, or
 * the directive that ends a suppressed stretch. A directive must be followed by whitespace or
 * the end of the comment, so words such as `eslint-disablement` in ordinary prose do not match.
 */
const DIRECTIVE =
  /^(?<directive>(?:eslint|oxlint)-(?:disable(?:-next-line|-line)?|enable)|biome-ignore(?:-all|-start|-end)?)(?=\s|$)/;

/** The directives that end a suppressed stretch instead of starting one. */
const ENDING_DIRECTIVES: ReadonlySet<string> = new Set([
  'eslint-enable',
  'oxlint-enable',
  'biome-ignore-end',
]);

/** A lint directive found at the start of a comment. */
export interface SuppressionDirective {
  /** The directive as written, such as `oxlint-disable-next-line`. */
  readonly name: string;
  /** False for a directive that only ends a suppressed stretch, such as `eslint-enable`. */
  readonly suppresses: boolean;
}

/**
 * The lint directive that a comment starts with, if any. `text` is the comment without its
 * comment markers; leading whitespace is ignored.
 */
export function suppressionDirectiveOf(text: string): SuppressionDirective | undefined {
  const name = DIRECTIVE.exec(text.trimStart())?.groups?.directive;
  if (name === undefined) {
    return undefined;
  }
  return { name, suppresses: !ENDING_DIRECTIVES.has(name) };
}
