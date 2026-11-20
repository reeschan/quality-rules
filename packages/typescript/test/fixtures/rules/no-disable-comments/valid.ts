// Disable the submit button while the request is pending.
export function isSubmitDisabled(pending: boolean): boolean {
  return pending;
}

/* The ignore list below is read by the build step, not by a linter. */
export const ignoredFolders = ['dist', 'coverage'];

// See the eslint and oxlint documentation for the list of available rules.
export const documentationTopic = 'rules';

// eslint-disablement is not a directive, and neither is biome-ignored or oxlint-disabled.
export const wordsThatLookLikeDirectives = 3;

// A string literal is not a comment, so the text below is not reported.
export const directiveSample = '// eslint-disable-line no-console';
