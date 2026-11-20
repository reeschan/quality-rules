/** Custom rules of the sample package, in the shape ESLint and oxlint plugins use. */
export const rules = {
  'no-sample-call': {
    meta: {
      type: 'suggestion',
      docs: { description: 'Disallow calls to a function named sample' },
      messages: { noSampleCall: 'Do not call sample().' },
      schema: [],
    },
    create(context) {
      return {
        CallExpression(node) {
          if (node.callee.type === 'Identifier' && node.callee.name === 'sample') {
            context.report({ node, messageId: 'noSampleCall' });
          }
        },
      };
    },
  },
};
