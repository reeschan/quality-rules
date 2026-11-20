import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { QualityRulesError } from '../errors.ts';

/** JavaScript and TypeScript source files, with or without JSX. */
export const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** Whether an absolute path is in the project folder `cwd`. */
export function isInside(cwd: string, absolute: string): boolean {
  const relative = path.relative(cwd, absolute);
  return !(relative.startsWith('..') || path.isAbsolute(relative));
}

export async function isDirectory(absolute: string): Promise<boolean> {
  const info = await stat(absolute).catch(() => undefined);
  return info?.isDirectory() === true;
}

/**
 * The folders of the option `dirs` as absolute paths. Throws when one is missing or outside the
 * project.
 */
export async function existingDirs(cwd: string, dirs: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const dir of dirs) {
    const absolute = path.resolve(cwd, dir);
    if (!isInside(cwd, absolute)) {
      throw new QualityRulesError(`The folder "${dir}" in "dirs" is outside the project`);
    }
    if (!(await isDirectory(absolute))) {
      throw new QualityRulesError(`The folder "${dir}" in "dirs" does not exist`);
    }
    found.push(absolute);
  }
  return found;
}

/** Every file under the folder, without descending into `node_modules` and `.git`. */
export async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'node_modules' || entry.name === '.git' ? [] : filesUnder(absolute);
      }
      return entry.isFile() ? [absolute] : [];
    })
  );
  return nested.flat();
}
