import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts', '**/*.e2e.test.ts'],
    testTimeout: 10000,
  },
});
