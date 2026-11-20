/** A JSON value, as read from pack files and the manifest. */
export type Json = null | boolean | number | string | readonly Json[] | JsonObject;

/** A JSON object. */
export interface JsonObject {
  readonly [key: string]: Json;
}

/** Whether a value is a plain JSON object (not an array or null). */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges configuration fragments: objects key by key, arrays as a union in order, and other
 * values replaced by the later fragment.
 */
export function mergeJson(base: Json, addition: Json): Json {
  if (isObject(base) && isObject(addition)) {
    const merged: Record<string, Json> = { ...(base as JsonObject) };
    for (const [key, value] of Object.entries(addition as JsonObject)) {
      merged[key] = Object.hasOwn(merged, key) ? mergeJson(merged[key] as Json, value) : value;
    }
    return merged;
  }
  if (Array.isArray(base) && Array.isArray(addition)) {
    const seen = new Set(base.map((item: Json) => JSON.stringify(item)));
    return [...base, ...addition.filter((item: Json) => !seen.has(JSON.stringify(item)))];
  }
  return addition;
}

/**
 * Adds the settings of `defaults` that `config` does not have. Where both set a value,
 * `config` wins, and its keys keep their order.
 */
export function withDefaults(config: Json, defaults: Json): Json {
  return mergeJson(config, mergeJson(defaults, config));
}
