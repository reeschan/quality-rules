import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The sample projects hold files named like tests, which are data and not tests to run.
    exclude: [...configDefaults.exclude, 'test/fixtures/**'],
    // Rule tests start real oxlint and ESLint processes on the fixtures.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
