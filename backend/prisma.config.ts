import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI config (Prisma 7). The datasource URL lives here, not in
 * `schema.prisma`. `schema` points at a *folder* so models can be split by
 * domain — architecture §3.4.
 *
 * The CLI and the running app deliberately connect as *different roles* once RLS
 * is on (docs/PRISMA.md §8 "Turning RLS on"):
 *
 *   DATABASE_URL          the app, as `jobwork_app` — a non-owner, so row-level
 *                         security policies actually apply to it, and it cannot
 *                         DROP POLICY or turn RLS off.
 *   MIGRATE_DATABASE_URL  the CLI, as `postgres` — the table owner, because
 *                         `migrate` has to run DDL, which `jobwork_app` cannot.
 *
 * Falls back to DATABASE_URL when MIGRATE_DATABASE_URL is unset, which is the
 * state before the cutover — one role does both jobs.
 */
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['MIGRATE_DATABASE_URL'] ?? process.env['DATABASE_URL'],
  },
});
