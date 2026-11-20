import { FragmentKind } from '../catalog/fragment-kind.ts';
import { listLines, QualityRulesError } from '../errors.ts';
import { isObject, type Json, type JsonObject } from '../json.ts';
import type { Resolution, ResolvedRule } from '../resolve/resolve.ts';
import { formatJson } from './format.ts';
import type { Generator } from './index.ts';

/** File name of the generated dependency-cruiser configuration. */
export const DEPENDENCY_CRUISER_FILE = 'dependency-cruiser.json';

/**
 * What a rule checks, named by the `check` key of its `dependency-cruiser` fragment. The
 * generator turns the rule's options into dependency-cruiser's `forbidden` rules.
 */
const CHECKS = {
  layerOrder: 'layer-order',
  closedModules: 'closed-modules',
  noCircular: 'no-circular',
  noUiInPureLayer: 'no-ui-in-pure-layer',
} as const;

/** A layer: a name and the folder it covers, relative to the project. */
interface Layer {
  readonly name: string;
  readonly folder: string;
}

/** Turns a rule's options into `forbidden` rules, reporting what is wrong with the options. */
type Build = (rule: ResolvedRule, shared: SharedOptions, problems: string[]) => JsonObject[];

/** Options that more than one rule reads. */
interface SharedOptions {
  /** The layers from the options of the layer-order rule, from top to bottom. */
  layers(problems: string[]): readonly Layer[];
}

const BUILDERS: Readonly<Record<string, Build>> = {
  [CHECKS.layerOrder]: layerOrderRules,
  [CHECKS.closedModules]: closedModuleRules,
  [CHECKS.noCircular]: noCircularRules,
  [CHECKS.noUiInPureLayer]: noUiInPureLayerRules,
};

/**
 * The content of `quality-rules/dependency-cruiser.json`, which the project's
 * dependency-cruiser configuration extends: one or more `forbidden` rules for each rule of
 * the structure pack that is in effect, named after the rule ID. Rules that are left out
 * add nothing. Throws a {@link QualityRulesError} when the options do not describe valid
 * layers or modules.
 */
export function dependencyCruiserConfig(resolution: Resolution): JsonObject {
  const problems: string[] = [];
  const shared = sharedOptions(resolution);
  const forbidden: JsonObject[] = [];
  for (const item of resolution.rules) {
    const check = checkOf(item);
    if (check === undefined || !item.active) {
      continue;
    }
    const build = BUILDERS[check];
    if (build === undefined) {
      problems.push(
        `${item.rule.id}: "${check}" is no dependency-cruiser check (known: ${Object.keys(BUILDERS).join(', ')})`
      );
      continue;
    }
    forbidden.push(...build(item, shared, problems));
  }
  if (problems.length > 0) {
    throw new QualityRulesError(
      `The options of the dependency-cruiser rules have problems:\n${listLines([...new Set(problems)])}`
    );
  }
  return {
    forbidden,
    options: {
      doNotFollow: { path: ['node_modules'] },
      // Type imports count too: a type from another layer or a module's inside is a dependency.
      tsPreCompilationDeps: true,
    },
  };
}

function checkOf(item: ResolvedRule): string | undefined {
  const fragment = item.rule.config[FragmentKind.DEPENDENCY_CRUISER];
  if (fragment === undefined) {
    return undefined;
  }
  return typeof fragment.check === 'string' ? fragment.check : '';
}

function sharedOptions(resolution: Resolution): SharedOptions {
  const layerRule = resolution.rules.find((item) => checkOf(item) === CHECKS.layerOrder);
  return {
    layers(problems) {
      if (layerRule === undefined) {
        return [];
      }
      return readLayers(layerRule, problems);
    },
  };
}

function readLayers(item: ResolvedRule, problems: string[]): Layer[] {
  const where = `"options" for ${item.rule.id}`;
  const value = optionsOf(item).layers;
  if (!Array.isArray(value)) {
    problems.push(`${where}: "layers" is not a list of { "name", "path" } from top to bottom`);
    return [];
  }
  const layers: Layer[] = [];
  value.forEach((entry: Json, index: number) => {
    const name = isObject(entry) ? entry.name : undefined;
    const folder = isObject(entry) ? toFolder(entry.path) : undefined;
    if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(name)) {
      problems.push(`${where}: layers[${index}] needs a "name" of letters, digits, _, . or -`);
    } else if (folder === undefined) {
      problems.push(`${where}: layers[${index}] (${name}) needs a "path": ${FOLDER_HINT}`);
    } else if (layers.some((layer) => layer.name === name)) {
      problems.push(`${where}: the layer name ${name} is used more than once`);
    } else {
      layers.push({ name, folder });
    }
  });
  return layers;
}

function optionsOf(item: ResolvedRule): JsonObject {
  return isObject(item.options) ? (item.options as JsonObject) : {};
}

const FOLDER_HINT =
  'a folder relative to the project such as src/domain, where * stands for one folder name';

/**
 * A folder or file path relative to the project, with `/` separators and no `./` at the
 * start or `/` at the end, or `undefined` when the value is no such path.
 */
function toFolder(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const folder = value
    .trim()
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');
  const segments = folder.split('/');
  const valid =
    folder !== '' &&
    !folder.startsWith('/') &&
    !/^[A-Za-z]:/.test(folder) &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..') &&
    !folder.includes('**');
  return valid ? folder : undefined;
}

/** A path as a regular expression, where `*` matches one folder or file name. */
function pathPattern(folder: string): string {
  return folder
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
}

function anyOf(patterns: readonly string[]): string {
  return `(?:${patterns.join('|')})`;
}

function list(names: readonly string[]): string {
  return names.join(', ');
}

/**
 * For each layer below the top one: files in the layer do not import files of the layers
 * above it.
 */
function layerOrderRules(item: ResolvedRule, shared: SharedOptions, problems: string[]) {
  const layers = shared.layers(problems);
  return layers.slice(1).map((layer, index): JsonObject => {
    const above = layers.slice(0, index + 1);
    return {
      name: `${item.rule.id}:${layer.name}`,
      comment: `The layer ${layer.name} (${layer.folder}) must not import from the layers above it: ${list(above.map((upper) => upper.name))}`,
      severity: 'error',
      from: { path: `^${anyOf([pathPattern(layer.folder)])}/` },
      to: { path: `^${anyOf(above.map((upper) => pathPattern(upper.folder)))}/` },
    };
  });
}

/**
 * For each closed module: files outside the module import only its public files. A module
 * path with `*` stands for each folder at that place, and those modules are closed to each
 * other as well.
 */
function closedModuleRules(item: ResolvedRule, _shared: SharedOptions, problems: string[]) {
  const where = `"options" for ${item.rule.id}`;
  const options = optionsOf(item);
  const defaultPublic = readFiles(options.public, `${where}: "public"`, problems);
  if (!Array.isArray(options.modules)) {
    problems.push(
      `${where}: "modules" is not a list of module folders or { "path", "public" } objects`
    );
    return [];
  }
  return options.modules.flatMap((entry: Json, index: number): JsonObject[] => {
    const folder = toFolder(isObject(entry) ? entry.path : entry);
    if (folder === undefined) {
      problems.push(`${where}: modules[${index}] needs a path: ${FOLDER_HINT}`);
      return [];
    }
    const publicFiles =
      isObject(entry) && entry.public !== undefined
        ? readFiles(entry.public, `${where}: modules[${index}].public`, problems)
        : defaultPublic;
    return closedModule(item.rule.id, folder, publicFiles);
  });
}

function readFiles(value: Json | undefined, where: string, problems: string[]): string[] {
  const files = Array.isArray(value) ? value.map(toFolder) : [];
  if (!Array.isArray(value) || files.length === 0 || files.some((file) => file === undefined)) {
    problems.push(
      `${where} is not a list of files relative to the module folder, such as ["index.ts"]`
    );
    return [];
  }
  return files as string[];
}

function closedModule(id: string, folder: string, publicFiles: readonly string[]): JsonObject[] {
  const module = pathPattern(folder);
  const exposed = `${module}/${anyOf(publicFiles.map(pathPattern))}$`;
  const exposedList = list(publicFiles);
  const fromOutside: JsonObject = {
    name: `${id}:${folder}`,
    comment: `Code outside ${folder} imports only its public files: ${exposedList}`,
    severity: 'error',
    from: { pathNot: `^${module}/` },
    to: { path: `^${module}/`, pathNot: `^${exposed}` },
  };
  if (!folder.includes('*')) {
    return [fromOutside];
  }
  // `$1` in `to` is the module that the importing file is in (dependency-cruiser's group match).
  const fromOtherModule: JsonObject = {
    name: `${id}:${folder}:from-another-module`,
    comment: `Code in one module of ${folder} imports only the public files of another: ${exposedList}`,
    severity: 'error',
    from: { path: `^(${module})/` },
    to: { path: `^${module}/`, pathNot: `^(?:$1/|${exposed})` },
  };
  return [fromOutside, fromOtherModule];
}

/** No import cycles. A cycle made only of type imports goes away at compile time. */
function noCircularRules(item: ResolvedRule): JsonObject[] {
  return [
    {
      name: item.rule.id,
      comment: 'Modules must not import each other in a cycle',
      severity: 'error',
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },
  ];
}

/** Files in the layers of pure computation do not import UI libraries. */
function noUiInPureLayerRules(item: ResolvedRule, shared: SharedOptions, problems: string[]) {
  const where = `"options" for ${item.rule.id}`;
  const options = optionsOf(item);
  const names = stringList(options.layers);
  const libraries = stringList(options.uiLibraries);
  if (names === undefined) {
    problems.push(`${where}: "layers" is not a list of layer names`);
  }
  if (libraries === undefined) {
    problems.push(`${where}: "uiLibraries" is not a list of package names`);
  }
  if (names === undefined || libraries === undefined || names.length === 0) {
    return [];
  }
  const layers = shared.layers(problems);
  const pure = names.flatMap((name) => {
    const layer = layers.find((candidate) => candidate.name === name);
    if (layer === undefined) {
      problems.push(
        `${where}: "layers" names ${name}, which is no layer in the options of the layer-order rule (layers: ${list(layers.map((candidate) => candidate.name)) || 'none'})`
      );
      return [];
    }
    return [layer];
  });
  if (pure.length !== names.length || libraries.length === 0) {
    return [];
  }
  const packages = anyOf(libraries.map(pathPattern));
  return [
    {
      name: item.rule.id,
      comment: `The layers of pure computation (${list(names)}) must not import UI libraries: ${list(libraries)}`,
      severity: 'error',
      from: { path: `^${anyOf(pure.map((layer) => pathPattern(layer.folder)))}/` },
      // An installed package resolves into node_modules; one that is not installed stays a name.
      to: { path: `(?:^|(?:^|/)node_modules/)${packages}(?:/|$)` },
    },
  ];
}

function stringList(value: Json | undefined): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item !== '')) {
    return undefined;
  }
  return value as string[];
}

/** Generates `quality-rules/dependency-cruiser.json`. */
export const dependencyCruiserGenerator: Generator = {
  file: DEPENDENCY_CRUISER_FILE,
  guidance: `.dependency-cruiser.cjs: add extends: "./quality-rules/${DEPENDENCY_CRUISER_FILE}"`,
  render: (context) => formatJson(dependencyCruiserConfig(context.resolution), context.style),
};
