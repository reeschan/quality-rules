import type { Rule } from 'eslint';
import { allowFilesSchema, createFileMatcher } from './no-scientific-literal.ts';

type BinaryExpression = Extract<Rule.Node, { type: 'BinaryExpression' }>;
type Operand = BinaryExpression['left'];

/** Options of `quality-rules/no-range-bound-comparison`. */
interface NoRangeBoundComparisonOptions {
  /** Glob patterns of the files where range bounds may be compared by hand. */
  readonly allowFiles?: readonly string[];
}

const RELATIONAL_OPERATORS = new Set(['<', '<=', '>', '>=']);

type Bound = 'min' | 'max';

interface BoundAccess {
  readonly bound: Bound;
  /** The expression the bound is read from, which stands for the range. */
  readonly range: Extract<Operand, { type: 'MemberExpression' }>['object'];
}

function unwrapChain(
  node: Operand
): Operand | Extract<Operand, { type: 'ChainExpression' }>['expression'] {
  return node.type === 'ChainExpression' ? node.expression : node;
}

function toBound(name: unknown): Bound | undefined {
  return name === 'min' || name === 'max' ? name : undefined;
}

/** Reads `range.min`, `range.max`, `range?.min` or `range['min']`. */
function readBoundAccess(node: Operand): BoundAccess | undefined {
  const member = unwrapChain(node);
  if (member.type !== 'MemberExpression') {
    return undefined;
  }
  const { property } = member;
  const bound = member.computed
    ? property.type === 'Literal'
      ? toBound(property.value)
      : undefined
    : property.type === 'Identifier'
      ? toBound(property.name)
      : undefined;
  return bound === undefined ? undefined : { bound, range: member.object };
}

/**
 * Reports a hand-written comparison between the minimum of one range and the maximum of another
 * (for example `a.min <= b.max`), so that range checks live in one shared function.
 */
export const noRangeBoundComparison: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow comparing the min of one range with the max of another outside the allowed files',
    },
    messages: {
      noRangeBoundComparison:
        'Comparing range bounds by hand is not allowed here. Use a shared range function instead.',
    },
    schema: [...allowFilesSchema],
  },
  create(context) {
    const options = (context.options[0] ?? {}) as NoRangeBoundComparisonOptions;
    if (createFileMatcher(options.allowFiles ?? [])(context.filename)) {
      return {};
    }
    const { sourceCode } = context;
    return {
      BinaryExpression(node) {
        if (!RELATIONAL_OPERATORS.has(node.operator)) {
          return;
        }
        const left = readBoundAccess(node.left);
        const right = readBoundAccess(node.right);
        if (left === undefined || right === undefined || left.bound === right.bound) {
          return;
        }
        if (sourceCode.getText(left.range) === sourceCode.getText(right.range)) {
          return;
        }
        context.report({ node, messageId: 'noRangeBoundComparison' });
      },
    };
  },
};
