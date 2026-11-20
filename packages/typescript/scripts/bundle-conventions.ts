/**
 * Writes the published conventions of this package: every common convention of the rules
 * package joined with its TypeScript example, and every convention of the TypeScript layer,
 * as `<ID>.md` in the folder that `qualityRules.conventions` of package.json names.
 *
 * Options (each defaults to this package's layout):
 *   --common <dir>    common conventions (`<ID>.md`, prose only)
 *   --examples <dir>  TypeScript examples of the common conventions (`<ID>.md`)
 *   --layer <dir>     conventions of the TypeScript layer (`<ID>.md`)
 *   --out <dir>       output folder
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { bundleConventions } from '../src/catalog/bundle.ts';
import { PACKAGE_FIELD } from '../src/catalog/load.ts';
import { QualityRulesError } from '../src/errors.ts';

/** Name of the private workspace package that holds the common conventions. */
const COMMON_PACKAGE = '@reeschan/quality-rules-common';

const packageDir = path.resolve(fileURLToPath(import.meta.url), '..', '..');

async function defaultOutDir(): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8')) as {
    [PACKAGE_FIELD]?: { conventions?: string };
  };
  return path.join(packageDir, manifest[PACKAGE_FIELD]?.conventions ?? 'dist/conventions');
}

function defaultCommonDir(): string {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve(`${COMMON_PACKAGE}/package.json`)), 'conventions');
}

const { values } = parseArgs({
  options: {
    common: { type: 'string' },
    examples: { type: 'string' },
    layer: { type: 'string' },
    out: { type: 'string' },
  },
});

try {
  const outDir = path.resolve(values.out ?? (await defaultOutDir()));
  const ids = await bundleConventions(
    {
      commonDir: path.resolve(values.common ?? defaultCommonDir()),
      examplesDir: path.resolve(
        values.examples ?? path.join(packageDir, 'conventions', 'examples')
      ),
      layerDir: path.resolve(values.layer ?? path.join(packageDir, 'conventions')),
    },
    outDir
  );
  process.stdout.write(`Bundled ${ids.length} conventions into ${outDir}\n`);
} catch (error) {
  if (!(error instanceof QualityRulesError)) {
    throw error;
  }
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
