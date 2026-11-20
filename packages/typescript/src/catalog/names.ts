/** Shape of a category name, and of the prefix of a project's own conventions. */
export const CATEGORY_NAME = /^[A-Z][A-Z0-9]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PACK_NAME = /^[a-z][a-z0-9-]*$/;
const PACKAGE_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;

/** Whether a version string has the `major.minor.patch` shape. */
export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION.test(value);
}

/** Whether a pack name has the lowercase shape used for `packs/<pack>.json`. */
export function isPackName(value: string): boolean {
  return PACK_NAME.test(value);
}

/** Whether a name has the shape of an npm package name, with or without a scope. */
export function isPackageName(value: string): boolean {
  return PACKAGE_NAME.test(value);
}

/** Orders IDs by text, with numbers by value (`NAME-2` before `NAME-10`). */
export function compareIds(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}
