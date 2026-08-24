import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // `npm run build` compiles the tests too, so `dist/` holds a second copy of
    // every suite. Without this they run twice — and that copy is whatever the last
    // build produced, so it fails against any newer schema (found 2026-07-25: the
    // stale copy still selected `memberships.role` after that column was dropped,
    // reporting three failures that did not exist in the source).
    exclude: [...configDefaults.exclude, '**/dist/**'],
    /**
     * Vitest defaults to 5s, which is a budget written for pure-function tests.
     * Every suite here talks to a remote dev database, and the tenant-isolation
     * ones have to discover their fixtures through one transaction per
     * organization (`db/rls.fixtures.ts`) — so their cost grows with the dev data
     * rather than with the assertions. At 26 organizations that discovery alone
     * took 7.6s and four suites failed as timeouts, which read as flakiness and
     * taught everyone to ignore the RLS guards.
     *
     * The fixture cost is fixed separately; this is the headroom so that adding
     * organizations to dev never silently turns the isolation tests red again. A
     * genuine hang still fails, just 30s later.
     */
    testTimeout: 30_000,
  },
});
