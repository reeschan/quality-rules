// The generated rules come in through "extends"; the rule below is this project's own.
module.exports = {
  extends: './quality-rules/dependency-cruiser.json',
  forbidden: [
    {
      name: 'only-main-mounts-react-dom',
      comment: 'Only src/app/main.tsx talks to react-dom; other code renders through react.',
      severity: 'error',
      from: { pathNot: '^src/app/main[.]tsx$' },
      to: { path: '(?:^|/)node_modules/react-dom(?:/|$)' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
