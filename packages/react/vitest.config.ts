import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Rule tests start real oxlint and ESLint processes on the fixtures.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
