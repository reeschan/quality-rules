import preset from './quality-rules/knip.mjs';

export default {
  ...preset,
  project: ['src/**/*.{ts,tsx}', 'test/**/*.ts'],
};
