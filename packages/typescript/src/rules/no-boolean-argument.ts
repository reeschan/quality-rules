import type { Rule } from 'eslint';

type CallExpression = Extract<Rule.Node, { type: 'CallExpression' }>;
type NewExpression = Extract<Rule.Node, { type: 'NewExpression' }>;

/** Options of `quality-rules/no-boolean-argument`. */
interface NoBooleanArgumentOptions {
  /** Names of functions that may take a boolean literal, such as `setEnabled`. */
  readonly allowFunctions?: readonly string[];
  /** Regular expressions (as strings) for function names that may take a boolean literal. */
  readonly allowNamePatterns?: readonly string[];
}

/**
 * The name a call is made through: `f` for `f(x)` and `m` for `obj.m(x)`.
 * Calls through other expressions have no name.
 */
function calleeName(node: CallExpression | NewExpression): string | undefined {
  const { callee } = node;
  if (callee.type === 'Identifier') {
    return callee.name;
  }
  if (callee.type === 'MemberExpression') {
    if (!callee.computed && callee.property.type === 'Identifier') {
      return callee.property.name;
    }
    if (callee.property.type === 'Literal' && typeof callee.property.value === 'string') {
      return callee.property.value;
    }
  }
  return undefined;
}

/**
 * Reports `true` and `false` literals passed as call arguments, because the call site then
 * does not say what the flag means. Split the call into functions with descriptive names.
 */
export const noBooleanArgument: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow boolean literals as arguments of function calls',
    },
    messages: {
      noBooleanArgument:
        "Boolean literal '{{value}}' is not allowed as an argument. Use separate functions with descriptive names instead.",
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowFunctions: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          allowNamePatterns: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = (context.options[0] ?? {}) as NoBooleanArgumentOptions;
    const allowedNames = new Set(options.allowFunctions ?? []);
    const allowedPatterns = (options.allowNamePatterns ?? []).map((pattern) => new RegExp(pattern));

    function isAllowed(node: CallExpression | NewExpression): boolean {
      const name = calleeName(node);
      if (name === undefined) {
        return false;
      }
      return allowedNames.has(name) || allowedPatterns.some((pattern) => pattern.test(name));
    }

    function check(node: CallExpression | NewExpression): void {
      if (isAllowed(node)) {
        return;
      }
      for (const argument of node.arguments) {
        if (argument.type === 'Literal' && typeof argument.value === 'boolean') {
          context.report({
            node: argument,
            messageId: 'noBooleanArgument',
            data: { value: String(argument.value) },
          });
        }
      }
    }

    return { CallExpression: check, NewExpression: check };
  },
};
