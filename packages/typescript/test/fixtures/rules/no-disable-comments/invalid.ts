// Each suppression comment below names another rule, so that oxlint and ESLint do not
// hide the report of quality-rules/no-disable-comments itself.

export function describeItem(name: string): string {
  // eslint-disable-next-line no-console
  console.log(name);
  return `item: ${name}`; // eslint-disable-line no-useless-concat
}

/* eslint-disable no-console */
export const title = 'Summary';

// eslint-disable-next-line no-console -- explained in the comment instead of the config
export const subtitle = 'Details';

// oxlint-disable-next-line no-debugger
export const width = 320;

export const height = 240; // oxlint-disable-line no-magic-numbers

/* oxlint-disable no-empty */
export const depth = 16;

// biome-ignore lint/style/useConst: reassigned by callers
export let counter = 0;

// biome-ignore-all lint/suspicious/noConsole: logging is allowed in this file

/* biome-ignore-start lint/style/useConst: legacy block */
export let total = 0;
/* biome-ignore-end lint/style/useConst: legacy block */

/*
  eslint-disable no-alert
*/
export const ratio = width / height;
