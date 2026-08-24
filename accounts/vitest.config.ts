import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // `npm run build` compiles the tests too, so `dist/` holds a second copy of
    // every suite. Without this they run twice — and that copy is whatever the last
    // build produced, so it fails against any newer schema. Same reasoning as
    // backend/vitest.config.ts, where it was found the hard way on 2026-07-25.
    exclude: [...configDefaults.exclude, '**/dist/**'],
    /**
     * Same 30s as the app. Vitest defaults to 5s, which is a budget written for
     * pure-function tests; anything here that touches the database is talking to a
     * remote Postgres, and a timeout that tight reads as flakiness rather than as a
     * real failure.
     */
    testTimeout: 30_000,
  },
});
