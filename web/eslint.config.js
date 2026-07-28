import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // "No unused variable should exist" — ERROR (not warning), so it blocks commits.
      // Exception: names starting with "_" are allowed (a common way to mark
      // an argument you must accept but intentionally don't use, e.g. (_req, res)).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Names are camelCase, with the exceptions React and TypeScript force on us.
      // Later entries win over earlier ones only at equal specificity; individual
      // selectors always beat the `default` catch-all.
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'forbid',
        },
        // Components are PascalCase (`const Input = forwardRef(...)`), module-level
        // constants are UPPER_CASE.
        {
          selector: 'variable',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        // `function Button()` / `function EyeIcon()`.
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        // `import { QueryClientProvider }`, `import styles from './x.module.css'`.
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        // Keys that can't be identifiers are dictated by the wire format, not by us:
        // `{ 'Content-Type': 'application/json' }`.
        { selector: 'objectLiteralProperty', format: null, modifiers: ['requiresQuotes'] },
        { selector: 'typeProperty', format: null, modifiers: ['requiresQuotes'] },
        // Allow React __html property and backend wire format properties like avatar_url/logo_url
        {
          selector: ['objectLiteralProperty', 'typeProperty'],
          filter: {
            regex: '^(?:__html|avatar_url|logo_url)$',
            match: true,
          },
          format: null,
        },
      ],
    },
  },
  // MUST be last: turns OFF ESLint formatting rules that would fight Prettier.
  eslintConfigPrettier,
]);
