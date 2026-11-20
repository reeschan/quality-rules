import type { ESLint } from 'eslint';
import { rules } from './rules/index.ts';

/** Prefix of every custom rule id, for example `quality-rules/no-disable-comments`. */
export const pluginName = 'quality-rules';

/**
 * Plugin object that both oxlint (`jsPlugins`) and ESLint (`plugins`) load.
 * oxlint takes the rule prefix from `meta.name`.
 */
export const plugin = {
  meta: { name: pluginName },
  rules,
} satisfies ESLint.Plugin;

export { rules };

export default plugin;
