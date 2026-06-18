import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Exclude integration and e2e tests from default test runs (unit tests only)
    exclude: [
      '**/node_modules/**',
      '**/*.integration.test.ts',
      '**/*.e2e.test.ts',
      'src/cli/lib/m*form-runner.test.ts',
      'src/cli/lib/research-mock.test.ts',
      'src/cli/lib/research-tool-factory.test.ts',
      'src/cli/lib/research/form-registry.test.ts',
      'src/lib/__mocks__/**/*.test.ts',
      'tests/research-*.test.ts',
    ],
    globals: false,
    environment: 'node',
    // CLI tests spawn processes which can be slow, especially under parallel load
    testTimeout: 30000, // 30s (default is 5s)
    // Run tests sequentially to avoid resource contention from parallel CLI spawning
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
