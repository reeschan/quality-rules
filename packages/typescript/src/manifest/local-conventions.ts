import path from 'node:path';
import {
  CONVENTION_CATEGORIES,
  listLines,
  parseConventionDocument,
  QualityRulesError,
  readMarkdownFolder,
} from '../catalog/conventions.ts';
import type { Catalog } from '../catalog/load.ts';
import type { LocalConventionsField } from './manifest.ts';

/** The project's own conventions, as `sync` sees them. */
export interface LocalConventions {
  /** IDs of the convention files in the folder, sorted. */
  readonly ids: readonly string[];
  /** Things worth telling the user that do not stop the sync. */
  readonly notices: readonly string[];
}

/**
 * Checks the project's own conventions against the installed packages. Throws a
 * {@link QualityRulesError} when the prefix is a category name of the package conventions, or
 * when a convention file in the folder has the ID of a rule or convention of the packages.
 * The ID of a file is its `id` field, and its file name without `.md`; both are checked.
 */
export async function checkLocalConventions(
  projectDir: string,
  local: LocalConventionsField | undefined,
  catalog: Catalog
): Promise<LocalConventions> {
  if (local === undefined) {
    return { ids: [], notices: [] };
  }
  const problems: string[] = [];
  const notices: string[] = [];
  if (CONVENTION_CATEGORIES.includes(local.prefix)) {
    problems.push(
      `"local.prefix" ${local.prefix} is a category name of the package conventions (${CONVENTION_CATEGORIES.join(', ')}); choose another prefix, such as PROJ`
    );
  }
  const packageIds = new Map<string, string>([
    ...catalog.rules.map((rule): [string, string] => [rule.id, `a rule in ${rule.package}`]),
    ...catalog.conventions.map((convention): [string, string] => [
      convention.id,
      `a convention in ${convention.package}`,
    ]),
  ]);
  const dir = path.resolve(projectDir, local.dir);
  const files = await readMarkdownFolder(dir);
  if (files.size === 0) {
    notices.push(`"local.dir" ${local.dir} has no convention files (<ID>.md)`);
  }
  const ids = new Set<string>();
  for (const [fileId, text] of files) {
    const where = toProjectPath(projectDir, path.join(dir, `${fileId}.md`));
    const fieldId = parseConventionDocument(text).document.fields.id;
    const fileIds = [...new Set([fileId, ...(fieldId === undefined ? [] : [fieldId])])];
    for (const id of fileIds) {
      ids.add(id);
      const owner = packageIds.get(id);
      if (owner !== undefined) {
        problems.push(
          `${where}: ID ${id} is also ${owner}; give the project's conventions the prefix ${local.prefix}-`
        );
      } else if (!id.startsWith(`${local.prefix}-`)) {
        notices.push(`${where}: ID ${id} does not start with the prefix ${local.prefix}-`);
      }
    }
  }
  if (problems.length > 0) {
    throw new QualityRulesError(
      `The project's own conventions overlap the packages:\n${listLines(problems)}`
    );
  }
  return { ids: [...ids].sort(), notices };
}

/** A path relative to the project with `/` separators, or the absolute path when outside. */
function toProjectPath(projectDir: string, file: string): string {
  const relative = path.relative(projectDir, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return file;
  }
  return relative.split(path.sep).join('/');
}
