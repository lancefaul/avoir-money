// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Base recommended rules
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/prisma/migrations/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/vite.config.*',
      '**/vitest.config.*',
    ],
  },

  // All TypeScript/JavaScript files
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // Enforce: no unused variables (prefix _ to intentionally ignore)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Enforce: no explicit any
      '@typescript-eslint/no-explicit-any': 'error',
      // Enforce: consistent type imports
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      // Off: base rule superseded by TS version
      'no-unused-vars': 'off',
      // Off: too noisy for this codebase
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // React packages — add react-hooks rules
  {
    files: [
      'apps/web/**/*.tsx',
      'apps/web/**/*.ts',
      'apps/showcase/**/*.tsx',
      'packages/ui/**/*.tsx',
    ],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Test files — relax some rules
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.property.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // Prettier must be last — disables all formatting rules ESLint would conflict with
  prettier,
);
