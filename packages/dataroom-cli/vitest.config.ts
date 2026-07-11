import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    // The vendored suite ships an integration-named test that is filesystem-only
    // and fast; there is no separate integration runner in this package, so it
    // runs in the default suite.
    exclude: ['**/node_modules/**', '**/*.e2e.test.ts'],
    testTimeout: 10000,
  },
});
