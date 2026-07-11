/**
 * ESLint flat config with type-aware rules.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Apply type-checked configs only to TypeScript files
const typedRecommended = tseslint.configs.recommendedTypeChecked.map((cfg) => ({
  ...cfg,
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: {
    ...(cfg.languageOptions ?? {}),
    parserOptions: {
      ...(cfg.languageOptions?.parserOptions ?? {}),
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
}));

const typedStylistic = tseslint.configs.stylisticTypeChecked.map((cfg) => ({
  ...cfg,
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: {
    ...(cfg.languageOptions ?? {}),
    parserOptions: {
      ...(cfg.languageOptions?.parserOptions ?? {}),
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
}));

export default [
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.pnpm-store/**',
      '**/coverage/**',
      'eslint.config.*',
      '**/vitest.config*.ts', // Config files don't need linting
      // Vendored byte-identical from the private upstream, which owns lint
      // and formatting for these trees (docs/VENDORING.md). Do not edit here.
      'packages/dataroom/src/**',
      'packages/dataroom-cli/src/**',
      'packages/finterm-cli/src/cli/commands/cache.ts',
      'packages/finterm-cli/src/cli/commands/dev.ts',
      'packages/finterm-cli/src/cli/commands/form.ts',
      'packages/finterm-cli/src/cli/commands/report*.ts',
      'packages/finterm-cli/src/cli/commands/research.ts',
      'packages/finterm-cli/src/cli/lib/cost-display.ts',
      'packages/finterm-cli/src/cli/lib/form-*.ts',
      'packages/finterm-cli/src/cli/lib/m*form-runner.ts',
      'packages/finterm-cli/src/cli/lib/m*form-runner.test.ts',
      'packages/finterm-cli/src/cli/lib/model-*.ts',
      'packages/finterm-cli/src/cli/lib/research/**',
      'packages/finterm-cli/src/cli/lib/research-mock.ts',
      'packages/finterm-cli/src/cli/lib/research-mock.test.ts',
      'packages/finterm-cli/src/cli/lib/research-tool-factory.ts',
      'packages/finterm-cli/src/cli/lib/research-tool-factory.test.ts',
      'packages/finterm-cli/src/lib/__mocks__/**',
      'packages/finterm-cli/tests/research-*.test.ts',
    ],
  },

  // Base JS rules
  js.configs.recommended,

  // Type-aware TypeScript rules
  ...typedRecommended,
  ...typedStylistic,

  // TypeScript-specific rules
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Enforce curly braces for all control statements
      curly: ['error', 'all'],
      'brace-style': ['error', '1tbs', { allowSingleLine: false }],

      // Catch silent catch blocks - require comment or error handling
      'no-empty': ['error', { allowEmptyCatch: false }],

      // Allow underscore prefix for intentionally unused vars/args
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Promise Safety
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',

      // Forbid optional booleans (foo?: boolean) — undefined vs false is a common bug source
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSPropertySignature[optional=true] > TSTypeAnnotation > TSBooleanKeyword',
          message:
            'Avoid optional booleans (`foo?: boolean`). Use `foo: boolean` (required) or `foo: boolean | null` (explicit tri-state).',
        },
        {
          selector: 'Identifier[optional=true] > TSTypeAnnotation > TSBooleanKeyword',
          message:
            'Avoid optional boolean parameters. Use `foo: boolean | null` for explicit tri-state.',
        },
      ],

      // Type Import Consistency
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          disallowTypeAnnotations: true,
        },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },

  // Semantic color wall: all terminal color goes through the OutputManager's
  // createColors() roles (success/error/id/path/heading/stat/...). Raw picocolors
  // bypasses --color/NO_COLOR handling and reintroduces arbitrary color names.
  {
    files: ['packages/finterm-cli/src/**/*.ts'],
    ignores: ['packages/finterm-cli/src/cli/lib/output.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'picocolors',
              message:
                'Import semantic color roles via OutputManager.getColors() / createColors() from cli/lib/output.ts instead of raw picocolors.',
            },
            {
              name: 'chalk',
              message: 'Use the semantic color roles in cli/lib/output.ts (picocolors-based).',
            },
          ],
        },
      ],
    },
  },

  // Relax rules for test files
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Node.js scripts (.mjs files)
  {
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Relax rules for scripts
  {
    files: ['**/scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Relax rules for mock files
  {
    files: ['**/__mocks__/**/*.ts', '**/public-mock-api-client.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/prefer-for-of': 'off',
    },
  },

  // The dataroom packages expose public metadata types whose optional booleans and
  // mapped-array shapes are part of their serialized API surface.
  {
    files: ['packages/dataroom/**/*.ts', 'packages/dataroom-cli/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/dot-notation': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
    },
  },

  // Relax rules for core lib files
  {
    files: ['**/src/lib/**/*.ts'],
    rules: {
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
    },
  },

  // Relax rules for CLI commands
  {
    files: ['**/cli/commands/**/*.ts', '**/cli/lib/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_|^options$|^id$|^query$' },
      ],
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      // Allow || for env vars and argv where empty string should be falsy
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      // API responses are typed as unknown, allow template literals
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/prefer-for-of': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Relax no-base-to-string for the cli-io presentation layer. These formatters already
  // branch on `typeof === 'object'` and JSON.stringify objects before the String()/template
  // fallback, so the rule's conservative [object Object] warning is a false positive here.
  {
    files: ['**/cli-io/**/*.ts'],
    rules: {
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },

  // Prettier config must be LAST
  prettier,
];
