import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI config (Prisma 7). The datasource URL lives here, not in
 * `schema.prisma`. `schema` points at a *folder* to match `backend/`, though this
 * service has one domain and so one file in it.
 *
 * Same two-role split as the app, for the same reason minus RLS:
 *
 *   DATABASE_URL          the service, as a non-owner role with no DDL rights.
 *                         This database holds password hashes and signing keys —
 *                         the running process has no business being able to DROP
 *                         the table they live in.
 *   MIGRATE_DATABASE_URL  the CLI, as the owner, because `migrate` runs DDL.
 *
 * Falls back to DATABASE_URL when MIGRATE_DATABASE_URL is unset, which is the
 * state before the two roles are split — one role does both jobs.
 *
 * 🔴 This is a DIFFERENT database from the app's. Never point either URL at
 * `jobwork_*`: identity in the app's database is the storage coupling this whole
 * service exists to escape (docs/SSO_AND_IDENTITY.md §7.2).
 */
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['MIGRATE_DATABASE_URL'] ?? process.env['DATABASE_URL'],
  },
});
