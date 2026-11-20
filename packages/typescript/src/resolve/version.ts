/** A version such as `1.2.0` or `1.2.0-beta.1`, split into the parts that decide its order. */
interface ParsedVersion {
  /** Major, minor and patch. */
  readonly core: readonly number[];
  /** The dot-separated identifiers after `-`, empty for a release. */
  readonly prerelease: readonly string[];
}

const VERSION_PATTERN =
  /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const NUMERIC_IDENTIFIER = /^\d+$/;

/**
 * Whether `version` comes after `than` in semantic versioning order (build metadata after `+`
 * is ignored). A text that is not a version such as `1.2.0` is never newer, nor older.
 *
 * @param version The version to test, such as the version that added a rule.
 * @param than The version to compare with, such as the version in the manifest's `packages`.
 * @returns `true` only when both are versions and `version` is the later one.
 */
export function isNewerVersion(version: string, than: string): boolean {
  const a = parseVersion(version);
  const b = parseVersion(than);
  if (a === undefined || b === undefined) {
    return false;
  }
  return comparePrecedence(a, b) > 0;
}

function parseVersion(text: string): ParsedVersion | undefined {
  const groups = VERSION_PATTERN.exec(text)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  return {
    core: [groups.major, groups.minor, groups.patch].map(Number),
    prerelease: groups.prerelease?.split('.') ?? [],
  };
}

/** Negative when `a` comes first, positive when `b` comes first, 0 when they are equal. */
function comparePrecedence(a: ParsedVersion, b: ParsedVersion): number {
  for (const [index, part] of a.core.entries()) {
    const difference = part - (b.core[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    // A release comes after its prereleases.
    return Math.sign(b.prerelease.length - a.prerelease.length);
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === undefined || right === undefined) {
      // The shorter list of identifiers comes first when the shared ones are equal.
      return Math.sign(a.prerelease.length - b.prerelease.length);
    }
    const order = compareIdentifiers(left, right);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

/** Numeric identifiers compare as numbers and come before alphanumeric ones. */
function compareIdentifiers(a: string, b: string): number {
  const aNumeric = NUMERIC_IDENTIFIER.test(a);
  const bNumeric = NUMERIC_IDENTIFIER.test(b);
  if (aNumeric && bNumeric) {
    return Math.sign(Number(a) - Number(b));
  }
  if (aNumeric !== bNumeric) {
    return Number(bNumeric) - Number(aNumeric);
  }
  if (a === b) {
    return 0;
  }
  if (a < b) {
    return -1;
  }
  return 1;
}
