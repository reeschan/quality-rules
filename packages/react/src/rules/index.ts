import type { Rule } from 'eslint';
import { noPropsDestructuring } from './no-props-destructuring.ts';

/** The custom rules of this package, keyed by rule name without the plugin prefix. */
export const rules: Readonly<Record<string, Rule.RuleModule>> = {
  'no-props-destructuring': noPropsDestructuring,
};
