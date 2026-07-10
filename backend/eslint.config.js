import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  // `generated/` is Prisma's output — never hand-edited, never linted.
  globalIgnores(['dist', 'generated']),
  {
    files: ['**/*.{ts,js}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Mirrors web/eslint.config.js — see docs/CODE_QUALITY_AND_FORMATTING.md §4.1.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Same naming policy as the frontend (§4.2), minus the React carve-outs.
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'forbid',
        },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE'], leadingUnderscore: 'allow' },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'function', format: ['camelCase'] },
        // `import { PrismaClient }`, `import express from 'express'`.
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        // Wire-format keys we don't choose: 'Content-Type', 'Retry-After'.
        { selector: 'objectLiteralProperty', format: null, modifiers: ['requiresQuotes'] },
        { selector: 'typeProperty', format: null, modifiers: ['requiresQuotes'] },
        // Env vars are UPPER_CASE by convention (`process.env.DATABASE_URL`),
        // and Zod schemas describing them must use the same keys.
        { selector: 'objectLiteralProperty', format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'typeProperty', format: ['camelCase', 'UPPER_CASE'] },
      ],
    },
  },
  // MUST be last: turns OFF ESLint formatting rules that would fight Prettier.
  eslintConfigPrettier,
]);
