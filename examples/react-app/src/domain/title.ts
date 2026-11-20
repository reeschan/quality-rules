const MAX_TITLE_LENGTH = 80;

/** Returns the title without surrounding spaces and cut to the longest length a task may have. */
export function normalizeTitle(raw: string): string {
  return raw.trim().slice(0, MAX_TITLE_LENGTH);
}
