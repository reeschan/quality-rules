import type { ESLint } from 'eslint';
import { PLUGIN_NAME } from './plugin-name.ts';
import { rules } from './rules/index.ts';

/** Prefix of every custom rule id, for example `quality-rules/no-disable-comments`. */
export const pluginName = PLUGIN_NAME;

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
