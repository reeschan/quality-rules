/**
 * Kinds of the configuration fragments that a rule of a pack file carries under `config`, one
 * for each tool whose generated file reads them.
 */
export const FragmentKind = {
  BIOME: 'biome',
  OXLINT: 'oxlint',
  ESLINT: 'eslint',
  PRETTIER: 'prettier',
  KNIP: 'knip',
  DEPENDENCY_CRUISER: 'dependency-cruiser',
} as const;
export type FragmentKind = (typeof FragmentKind)[keyof typeof FragmentKind];
