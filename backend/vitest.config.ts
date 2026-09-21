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
     * 🔴 NOT AN ARBITRARY BUMP — vitest's 5s default is unusable against THIS
     * database, and leaving it produced fourteen red tests on every single run.
     *
     * The suites talk to a managed Postgres in another cloud. `src/db/prisma.ts`
     * measured what that costs: **~1.9s to open a connection** — TCP handshake,
     * TLS with full certificate-chain validation, and SCRAM-SHA-256 at 4096
     * PBKDF2 iterations — against ~255ms for one round trip. A test that arrives
     * to a cold pool has spent a third of the old budget before its first query
     * is sent.
     *
     * On top of that the pool is deliberately `max: 2` under VITEST, and
     * `runAsTenant` is an INTERACTIVE transaction that holds one of those two for
     * its whole duration. So work that could overlap is serialised on purpose:
     * the same test measures 5.9s alone and 13.7s with the suite running.
     *
     * 30s is ~2x the worst case actually measured, which leaves a genuinely hung
     * test failing rather than hanging CI. `hookTimeout` is separate and larger
     * because `beforeAll` builds fixtures — org, uom, item, location, batch —
     * which is a different cost from a test body.
     *
     * 🔴 IF A TEST STARTS TIMING OUT AT 30s, DO NOT RAISE THIS. That is no longer
     * link latency; it is a query shape or a lock, and CLAUDE.md's rule about not
     * answering a slow query with a bigger budget applies here too. Raising the
     * old 5s was right only because it was measured first — and doing so
     * uncovered a real failure that had been masquerading as a timeout.
     */
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
