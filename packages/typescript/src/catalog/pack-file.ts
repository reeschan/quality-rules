import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isMissingFile } from '../errors.ts';
import { isObject, type Json, type JsonObject } from '../json.ts';
import { PLUGIN_NAME } from '../plugin-name.ts';
import { FragmentKind } from './fragment-kind.ts';
import { isPackageName, isPackName, isVersion } from './names.ts';
import type { CatalogRule } from './types.ts';

/** A string in a configuration fragment that stands for the options or one of their keys. */
export const OPTIONS_PLACEHOLDER = /^\{\{options(?:\.(?<key>[^{}.]+))?\}\}$/;
/** The keys that an `eslint` fragment may have. */
const ESLINT_FRAGMENT_KEYS = ['rules', 'plugins', 'settings', 'linterOptions'];

/** What {@link readPackFile} reads from one pack file. */
export interface PackFile {
  readonly description: string;
  readonly rules: CatalogRule[];
  readonly problems: string[];
}

/** Reads every `<pack>.json` file directly in a folder, as text by pack name. */
export async function readPackFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isMissingFile(error)) {
      return files;
    }
    throw error;
  }
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    files.set(name.slice(0, -'.json'.length), await readFile(path.join(dir, name), 'utf8'));
  }
  return files;
}

/**
 * Reads the text of a pack file. Problems with it are returned as messages instead of thrown,
 * so that one run can report every broken file.
 */
export function readPackFile(text: string, pack: string, packageName: string): PackFile {
  const problems: string[] = [];
  if (!isPackName(pack)) {
    problems.push(`pack name "${pack}" is not a lowercase name such as size-limits`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    problems.push(`is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    return { description: '', rules: [], problems };
  }
  if (!isObject(parsed)) {
    problems.push('is not a JSON object');
    return { description: '', rules: [], problems };
  }
  const description = typeof parsed.description === 'string' ? parsed.description : '';
  if (description === '') {
    problems.push('missing "description"');
  }
  if (!Array.isArray(parsed.rules)) {
    problems.push('missing the "rules" array');
    return { description, rules: [], problems };
  }
  const rules: CatalogRule[] = [];
  parsed.rules.forEach((entry: unknown, index: number) => {
    const rule = readRuleEntry(entry, pack, packageName);
    const label = typeof rule.id === 'string' && rule.id !== '' ? ` (${rule.id})` : '';
    problems.push(...rule.problems.map((problem) => `rules[${index}]${label}: ${problem}`));
    if (rule.problems.length === 0 && rule.value !== undefined) {
      rules.push(rule.value);
    }
  });
  return { description, rules, problems };
}

function readRuleEntry(
  entry: unknown,
  pack: string,
  packageName: string
): { id: unknown; value: CatalogRule | undefined; problems: string[] } {
  if (!isObject(entry)) {
    return { id: undefined, value: undefined, problems: ['is not a JSON object'] };
  }
  const problems: string[] = [];
  const { id, tool, description, added, options } = entry;
  for (const [key, value] of Object.entries({ id, tool, description })) {
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`missing "${key}"`);
    }
  }
  if (typeof id === 'string' && /\s/.test(id)) {
    problems.push(`id "${id}" contains white space`);
  }
  if (added === undefined) {
    problems.push('missing "added" (the package version that added the rule)');
  } else if (!isVersion(added)) {
    problems.push(`added "${String(added)}" is not a version such as 1.2.0`);
  }
  const config = entry.config ?? {};
  if (!isObject(config) || !Object.values(config).every(isObject)) {
    problems.push('"config" is not an object of configuration objects by tool');
  } else {
    problems.push(...checkPlaceholders(config, options as Json | undefined));
    problems.push(...checkEslintFragment(config[FragmentKind.ESLINT]));
  }
  if (problems.length > 0) {
    return { id, value: undefined, problems };
  }
  return {
    id,
    value: {
      id: id as string,
      pack,
      package: packageName,
      tool: tool as string,
      description: description as string,
      added: added as string,
      options: options as Json | undefined,
      config: config as Record<string, JsonObject>,
    },
    problems,
  };
}

function checkPlaceholders(config: unknown, options: Json | undefined): string[] {
  const problems: string[] = [];
  visitStrings(config, (value) => {
    if (!value.includes('{{')) {
      return;
    }
    const match = OPTIONS_PLACEHOLDER.exec(value);
    if (match === null) {
      problems.push(`"${value}" is not {{options}} or {{options.<key>}}`);
    } else if (options === undefined) {
      problems.push(`"${value}" is used but the rule has no default "options"`);
    } else if (match.groups?.key !== undefined) {
      const key = match.groups.key;
      if (!isObject(options) || !Object.hasOwn(options, key)) {
        problems.push(`"${value}" names a key that the default "options" do not have`);
      }
    }
  });
  return problems;
}

/**
 * Problems with an `eslint` fragment. Its plugin packages end up in the import statements of
 * the generated configuration, so they must be package names.
 */
function checkEslintFragment(fragment: unknown): string[] {
  if (!isObject(fragment)) {
    return [];
  }
  const problems = Object.keys(fragment)
    .filter((key) => !ESLINT_FRAGMENT_KEYS.includes(key))
    .map((key) => `"config.eslint" has "${key}"; it takes ${ESLINT_FRAGMENT_KEYS.join(', ')}`);
  const { plugins } = fragment;
  if (plugins === undefined) {
    return problems;
  }
  if (!isObject(plugins)) {
    problems.push('"config.eslint.plugins" is not an object of package names by plugin name');
    return problems;
  }
  for (const [name, packageName] of Object.entries(plugins)) {
    if (!isPackageName(name) || name === PLUGIN_NAME) {
      problems.push(`"config.eslint.plugins" has the plugin name "${name}", which is not allowed`);
    }
    if (typeof packageName !== 'string' || !isPackageName(packageName)) {
      problems.push(`"config.eslint.plugins.${name}" is not a package name`);
    }
  }
  return problems;
}

function visitStrings(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') {
    visit(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      visitStrings(item, visit);
    }
  } else if (isObject(value)) {
    for (const item of Object.values(value)) {
      visitStrings(item, visit);
    }
  }
}
