import type { Rule } from 'eslint';

/**
 * Matches the start of a comment that suppresses eslint, oxlint or biome diagnostics.
 * A directive must be followed by whitespace or the end of the comment, so words such as
 * `eslint-disablement` in ordinary prose do not match.
 */
const SUPPRESSION_DIRECTIVE =
  /^(?<directive>eslint-disable(?:-next-line|-line)?|oxlint-disable(?:-next-line|-line)?|biome-ignore(?:-all|-start)?)(?=\s|$)/;

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
          const directive = SUPPRESSION_DIRECTIVE.exec(comment.value.trimStart())?.groups
            ?.directive;
          if (directive === undefined || comment.loc == null) {
            continue;
          }
          context.report({
            loc: comment.loc,
            messageId: 'noDisableComment',
            data: { directive },
          });
        }
      },
    };
  },
};
