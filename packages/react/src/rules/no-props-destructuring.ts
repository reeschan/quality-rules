import type { Rule } from 'eslint';

type FunctionNode = Rule.Node & {
  type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression';
};

/** Calls that wrap a component function without changing which component it is. */
const COMPONENT_WRAPPERS = new Set(['memo', 'forwardRef']);

/** Wrapper nodes that TypeScript or parentheses put around an expression. */
const TRANSPARENT_PARENTS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'ChainExpression',
]);

function isComponentName(name: string | undefined): boolean {
  return name !== undefined && /^[A-Z]/.test(name);
}

type Callee = Extract<Rule.Node, { type: 'CallExpression' }>['callee'];

function calleeName(callee: Callee): string | undefined {
  if (callee.type === 'Identifier') {
    return callee.name;
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier'
  ) {
    return callee.property.name;
  }
  return undefined;
}

/** Name of the binding that a function expression is assigned to, looking through wrappers. */
function boundName(node: Rule.Node): string | undefined {
  let current: Rule.Node = node;
  let parent: Rule.Node | null = current.parent;
  while (parent !== null && parent !== undefined) {
    if (TRANSPARENT_PARENTS.has(parent.type)) {
      // Fall through to the next level.
    } else if (
      parent.type === 'CallExpression' &&
      parent.arguments[0] === current &&
      COMPONENT_WRAPPERS.has(calleeName(parent.callee) ?? '')
    ) {
      // memo(...) and forwardRef(...) keep the wrapped function as the component.
    } else if (parent.type === 'VariableDeclarator') {
      return parent.id.type === 'Identifier' ? parent.id.name : undefined;
    } else if (parent.type === 'AssignmentExpression' && parent.right === current) {
      return parent.left.type === 'Identifier' ? parent.left.name : undefined;
    } else if (
      (parent.type === 'Property' || parent.type === 'PropertyDefinition') &&
      parent.value === current &&
      !parent.computed &&
      parent.key.type === 'Identifier'
    ) {
      return parent.key.name;
    } else {
      return undefined;
    }
    current = parent;
    parent = current.parent;
  }
  return undefined;
}

function functionName(node: FunctionNode): string | undefined {
  if (node.type !== 'ArrowFunctionExpression' && node.id) {
    return node.id.name;
  }
  return boundName(node);
}

/**
 * Reports a destructuring pattern in the first parameter of a component, so that props are
 * read as `props.xxx` and stay recognisable at the place where they are used.
 * A component is a function whose name starts with an uppercase letter, including functions
 * wrapped in `memo` or `forwardRef`.
 */
export const noPropsDestructuring: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow destructuring props in the parameter list of a component',
    },
    messages: {
      noPropsDestructuring:
        "Do not destructure props in the parameter list of component '{{name}}'. Take 'props' and read 'props.xxx' instead.",
    },
    schema: [],
  },
  create(context) {
    function check(node: FunctionNode): void {
      const first = node.params[0];
      if (first === undefined) {
        return;
      }
      const pattern = first.type === 'AssignmentPattern' ? first.left : first;
      if (pattern.type !== 'ObjectPattern') {
        return;
      }
      const name = functionName(node);
      if (!isComponentName(name)) {
        return;
      }
      context.report({ node: first, messageId: 'noPropsDestructuring', data: { name } });
    }

    return {
      FunctionDeclaration: (node) => check(node as FunctionNode),
      FunctionExpression: (node) => check(node as FunctionNode),
      ArrowFunctionExpression: (node) => check(node as FunctionNode),
    };
  },
};
