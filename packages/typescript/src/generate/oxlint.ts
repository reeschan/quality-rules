import { isObject, type Json, type JsonObject } from '../catalog/load.ts';
import { fragmentsFor, type Resolution } from '../resolve/resolve.ts';
import { formatJson, mergeJson, withDefaults } from './biome.ts';
import type { Generator } from './index.ts';
import { OXLINT_PLUGIN_FILE } from './oxlint-plugin.ts';

/**
 * The content of `quality-rules/oxlint.json`, which the project's `.oxlintrc.json` extends.
 * Rules of the selected packs that are left out are set to `off`, so that a rule that oxlint
 * turns on by default stays quiet too.
 */
export function oxlintConfig(resolution: Resolution): JsonObject {
  const { active, inactive } = fragmentsFor(resolution, 'oxlint');
  const merged = active.reduce<Json>(mergeJson, {}) as JsonObject;
  const off: Record<string, Json> = {};
  for (const fragment of inactive) {
    const rules = isObject(fragment.rules) ? fragment.rules : {};
    for (const name of Object.keys(rules)) {
      off[name] = 'off';
    }
  }
  const { plugins, jsPlugins, rules, ...rest } = merged;
  // oxlint resolves `jsPlugins` relative to this file, also when another file extends it.
  const pluginPaths = mergeJson([`./${OXLINT_PLUGIN_FILE}`], jsPlugins ?? []);
  return {
    ...(plugins === undefined ? {} : { plugins }),
    jsPlugins: pluginPaths,
    ...rest,
    rules: withDefaults(rules ?? {}, off),
  };
}

/** Generates `quality-rules/oxlint.json`. */
export const oxlintGenerator: Generator = {
  file: 'oxlint.json',
  guidance: '.oxlintrc.json: add "extends": ["./quality-rules/oxlint.json"]',
  render: (context) => formatJson(oxlintConfig(context.resolution), context.style),
};
