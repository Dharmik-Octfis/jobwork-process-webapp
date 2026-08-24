import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * Mirrors `backend/eslint.config.js` — same rules, same reasoning, so a file reads
 * the same in either service. The one difference is the naming policy, which has to
 * accommodate OIDC wire format: `client_id`, `redirect_uris`, `code_challenge`,
 * `backchannel_logout_uri` and friends are keys the protocol chooses, not us.
 */
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
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

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
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        // Wire-format keys we don't choose: 'Content-Type', 'Retry-After'.
        { selector: 'objectLiteralProperty', format: null, modifiers: ['requiresQuotes'] },
        { selector: 'typeProperty', format: null, modifiers: ['requiresQuotes'] },
        /**
         * Three casings, none of them a style choice — in each case the name belongs
         * to something outside this codebase:
         *
         *   snake_case  the OIDC / OAuth 2.0 wire format. `client_id`,
         *               `redirect_uris`, `grant_types`, `code_challenge`,
         *               `email_verified`, `backchannel_logout_uri`. Renaming any of
         *               them yields a provider no conformant client can talk to.
         *   UPPER_CASE  environment variables (`DATABASE_URL`), and the Zod schema
         *               describing them has to use the same keys.
         *   PascalCase  `oidc-provider`'s own model names, which are the keys of the
         *               `ttl` config and the runtime `Client` property:
         *               AuthorizationCode, IdToken, AccessToken, Interaction,
         *               Session, Grant.
         */
        {
          selector: 'objectLiteralProperty',
          format: ['camelCase', 'UPPER_CASE', 'snake_case', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeProperty',
          format: ['camelCase', 'UPPER_CASE', 'snake_case', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
      ],
    },
  },
  // MUST be last: turns OFF ESLint formatting rules that would fight Prettier.
  eslintConfigPrettier,
]);
