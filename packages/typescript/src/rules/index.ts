import type { Rule } from 'eslint';
import { noBooleanArgument } from './no-boolean-argument.ts';
import { noDisableComments } from './no-disable-comments.ts';
import { noRangeBoundComparison } from './no-range-bound-comparison.ts';
import { noScientificLiteral } from './no-scientific-literal.ts';

/** The custom rules of this package, keyed by rule name without the plugin prefix. */
export const rules: Readonly<Record<string, Rule.RuleModule>> = {
  'no-boolean-argument': noBooleanArgument,
  'no-disable-comments': noDisableComments,
  'no-range-bound-comparison': noRangeBoundComparison,
  'no-scientific-literal': noScientificLiteral,
};
