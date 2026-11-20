import type { Rule } from 'eslint';
import { suppressionDirectiveOf } from './suppression-directive.ts';

/**
 * Reports every lint suppression comment, so that exceptions are written in the lint
 * configuration (with a reason) instead of next to the code.
 */
export const noDisableComments: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow comments that suppress eslint, oxlint or biome diagnostics',
    },
    messages: {
      noDisableComment:
        "Lint suppression comment '{{directive}}' is not allowed. Configure the exception in the lint configuration with a reason instead.",
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          const directive = suppressionDirectiveOf(comment.value);
          if (directive === undefined || !directive.suppresses || comment.loc == null) {
            continue;
          }
          context.report({
            loc: comment.loc,
            messageId: 'noDisableComment',
            data: { directive: directive.name },
          });
        }
      },
    };
  },
};
