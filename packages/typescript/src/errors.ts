/**
 * An error the user can fix (a broken catalog, manifest or command line). The CLI prints its
 * message without a stack trace and exits with code 2.
 */
export class QualityRulesError extends Error {
  override name = 'QualityRulesError';
}

/** Indents problem messages as a list under a heading line. */
export function listLines(lines: readonly string[]): string {
  return lines.map((line) => `  - ${line}`).join('\n');
}

/** Whether an error from `node:fs` means that the path does not exist. */
export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
