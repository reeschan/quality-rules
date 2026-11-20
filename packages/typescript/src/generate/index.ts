import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isMissingFile } from '../catalog/conventions.ts';
import type { Catalog } from '../catalog/load.ts';
import type { Toolchain } from '../manifest/manifest.ts';
import type { Resolution } from '../resolve/resolve.ts';
import { biomeConfig, biomeGenerator, type FormatStyle, styleOf } from './biome.ts';
import { dependencyCruiserGenerator } from './dependency-cruiser.ts';
import { eslintGenerator } from './eslint.ts';
import { knipGenerator } from './knip.ts';
import { oxlintGenerator } from './oxlint.ts';
import { oxlintPluginGenerator } from './oxlint-plugin.ts';
import { prettierConfig, prettierGenerator, prettierStyle } from './prettier.ts';

/** Folder of the project that holds the generated files. Only the CLI writes there. */
export const GENERATED_DIR = 'quality-rules';

/** What a generator reads. */
export interface GeneratorContext {
  readonly catalog: Catalog;
  readonly resolution: Resolution;
  /** Layout of the generated text files. */
  readonly style: FormatStyle;
}

/** Writes one file in the generated folder. */
export interface Generator {
  /** File name inside the generated folder. */
  readonly file: string;
  /**
   * How the project's own configuration loads the file, shown once when the file is first
   * created. Empty for files that another generated file loads.
   */
  readonly guidance: string | ((context: GeneratorContext) => string);
  render(context: GeneratorContext): string;
}

/** One generated file and its content. */
export interface GeneratedFile {
  /** Path relative to the generated folder, with `/` separators. */
  readonly file: string;
  readonly content: string;
  readonly guidance: string;
}

/** The generated files of one toolchain and how they are laid out. */
interface ToolchainSetup {
  /** The tools of the toolchain, as they are named in a sentence. */
  readonly label: string;
  /** The configuration fragment kinds that the toolchain's generators read. */
  readonly kinds: readonly string[];
  readonly generators: readonly Generator[];
  /** The layout that the toolchain's formatter gives the generated text files. */
  style(resolution: Resolution): FormatStyle;
}

const TOOLCHAIN_SETUPS: Readonly<Record<Toolchain, ToolchainSetup>> = {
  'biome-oxlint': {
    label: 'Biome and oxlint',
    kinds: ['biome', 'oxlint'],
    generators: [biomeGenerator, oxlintGenerator, oxlintPluginGenerator],
    style: (resolution) => styleOf(biomeConfig(resolution)),
  },
  'eslint-prettier': {
    label: 'ESLint and Prettier',
    kinds: ['eslint', 'prettier'],
    generators: [eslintGenerator, prettierGenerator],
    style: (resolution) => prettierStyle(prettierConfig(resolution)),
  },
};

/** Generators of the tools that every toolchain uses, written after the toolchain's own. */
const SHARED_GENERATORS: readonly Generator[] = [dependencyCruiserGenerator, knipGenerator];

/**
 * The tools that a toolchain stands for. A rule for one of them is checked only when it has a
 * configuration fragment for the toolchain in use.
 */
const TOOLCHAIN_TOOLS: ReadonlySet<string> = new Set(
  Object.values(TOOLCHAIN_SETUPS).flatMap((setup) => setup.kinds)
);

/** What {@link generateFiles} builds. */
export interface Generation {
  readonly files: GeneratedFile[];
  /** The layout of the generated text files, which the manifest is written in too. */
  readonly style: FormatStyle;
  /** The tools of the toolchain, as they are named in a sentence. */
  readonly toolsLabel: string;
  /**
   * IDs of the rules in effect that the toolchain cannot check: rules for a toolchain's tool
   * (such as Biome) without a configuration fragment for the toolchain in use.
   */
  readonly uncovered: readonly string[];
  /** Files that other toolchains write and this one does not. */
  readonly otherToolchainFiles: readonly string[];
}

/** Builds every generated file of the toolchain from the catalog and the resolved manifest. */
export function generateFiles(
  catalog: Catalog,
  resolution: Resolution,
  toolchain: Toolchain
): Generation {
  const setup = TOOLCHAIN_SETUPS[toolchain];
  const style = setup.style(resolution);
  const context: GeneratorContext = { catalog, resolution, style };
  const files = [...setup.generators, ...SHARED_GENERATORS].map((generator) => ({
    file: generator.file,
    content: generator.render(context),
    guidance:
      typeof generator.guidance === 'string' ? generator.guidance : generator.guidance(context),
  }));
  const uncovered = resolution.rules
    .filter(
      (item) =>
        item.active &&
        TOOLCHAIN_TOOLS.has(item.rule.tool) &&
        !setup.kinds.some((kind) => item.rule.config[kind] !== undefined)
    )
    .map((item) => item.rule.id);
  const written = new Set(files.map((item) => item.file));
  const otherToolchainFiles = Object.values(TOOLCHAIN_SETUPS)
    .flatMap((other) => other.generators.map((generator) => generator.file))
    .filter((file) => !written.has(file));
  return { files, style, toolsLabel: setup.label, uncovered, otherToolchainFiles };
}

/**
 * Files in the generated folder that no generator writes, as paths relative to the folder
 * with `/` separators. They are left in place and only reported.
 */
export async function findUnknownFiles(
  projectDir: string,
  files: readonly GeneratedFile[]
): Promise<string[]> {
  const dir = path.join(projectDir, GENERATED_DIR);
  const known = new Set(files.map((item) => item.file));
  let entries: Awaited<ReturnType<typeof listFiles>>;
  try {
    entries = await listFiles(dir);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
  return entries.filter((file) => !known.has(file)).sort();
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')
    );
}
