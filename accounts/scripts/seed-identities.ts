import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { prisma } from '../src/db/prisma.ts';
import { env } from '../src/config/env.ts';

/**
 * Seed identities from an app's `users` table — docs/SSO_AND_IDENTITY.md §13 step 2.
 *
 *   SOURCE_DATABASE_URL=postgres://… npm run seed:identities            # dry run
 *   SOURCE_DATABASE_URL=postgres://… npm run seed:identities -- --apply
 *
 * 🔴 THE POINT OF THIS SCRIPT IS THAT NOBODY RE-REGISTERS. Without it, every
 * existing user of every app is unknown to the identity provider and would have to
 * create an account they already have. Seeded correctly, they sign in with the
 * password they already use and §9.2's email branch links them to their existing
 * local row on first sign-in.
 *
 * 🔴 The password hash is copied VERBATIM and never re-hashed. Both services use the
 * `argon2` package, and `verify()` reads the cost parameters out of the hash string
 * itself, so a hash made with the app's settings verifies unchanged here — proven
 * before this script was written, against a real hash from `lib/password.ts`. There
 * is no moment at which a plaintext password exists in this process, which is why
 * this can run at all: we are moving a verifier, not a secret.
 *
 * Reads the source with plain `pg` rather than a second Prisma client: the app's
 * schema is a FOREIGN schema here, and this script will eventually read a second
 * app's table that this repo has no types for at all. One narrow SELECT is the
 * whole dependency.
 */

interface SourceUser {
  email: string;
  password_hash: string | null;
  first_name: string;
  last_name: string;
}

interface Summary {
  scanned: number;
  wouldCreate: SourceUser[];
  skippedNoPassword: SourceUser[];
  skippedExisting: string[];
  duplicateEmails: string[];
}

/**
 * 🔴 Strip `sslmode` before the URL reaches `pg` — the same trap documented in
 * `src/db/prisma.ts`, and it bites here for the same reason. `pg` parses `sslmode`
 * out of the connection string into its own SSL config, which then REPLACES the
 * `ssl` object below and silently drops the CA, so RDS fails with "self-signed
 * certificate in certificate chain". Hit while writing this script, which is why it
 * is worth a comment rather than a shrug.
 *
 * The fix is to supply the CA, never `rejectUnauthorized: false`. Turning
 * verification off leaves the connection encrypted but unauthenticated — and this
 * one carries every password hash in the app.
 */
function sourceClient(url: string): Client {
  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');

  return new Client({
    connectionString: parsed.toString(),
    ssl: env.databaseSslCaPath
      ? {
          ca: readFileSync(resolve(process.cwd(), env.databaseSslCaPath), 'utf8'),
          rejectUnauthorized: true,
        }
      : undefined,
  });
}

async function collect(url: string): Promise<Summary> {
  const source = sourceClient(url);
  await source.connect();

  /**
   * 🔴 Active users only, and only those who can actually sign in today.
   *
   * `is_active AND NOT is_deleted` is the app's own ACTIVE_USER predicate — seeding
   * a disabled account would hand it a working central login, which is the exact
   * opposite of what disabling it meant.
   *
   * A null `password_hash` means an invited user who never set one. They have no
   * credential to carry across, so there is nothing to seed; they arrive through the
   * invitation flow instead (§9.3).
   */
  const { rows } = await source.query<SourceUser>(
    `SELECT email::text AS email, password_hash, first_name, last_name
       FROM users
      WHERE is_active = true AND is_deleted = false
      ORDER BY created_at ASC`,
  );
  await source.end();

  const summary: Summary = {
    scanned: rows.length,
    wouldCreate: [],
    skippedNoPassword: [],
    skippedExisting: [],
    duplicateEmails: [],
  };

  // `email` is citext in both databases, so dedupe case-insensitively or two rows
  // differing only in case would collide on the unique index mid-run.
  const seen = new Set<string>();

  for (const row of rows) {
    const key = row.email.toLowerCase();

    if (seen.has(key)) {
      summary.duplicateEmails.push(row.email);
      continue;
    }
    seen.add(key);

    if (!row.password_hash) {
      summary.skippedNoPassword.push(row);
      continue;
    }

    const existing = await prisma.user.findUnique({ where: { email: row.email } });
    if (existing) {
      /**
       * 🔴 Never overwrite an existing identity's password. §13: "Where one email
       * has different password hashes in two apps, keep the most recently used and
       * tell those users at cutover. Do not guess silently." With one source app
       * there is no conflict to resolve, so the safe move is to leave what is there
       * and report it — silently replacing a credential is how people get locked out.
       */
      summary.skippedExisting.push(row.email);
      continue;
    }

    summary.wouldCreate.push(row);
  }

  return summary;
}

async function main(): Promise<void> {
  const url = process.env['SOURCE_DATABASE_URL'];
  if (!url) {
    console.error('SOURCE_DATABASE_URL is required — the app database to read users from.');
    process.exit(1);
  }
  if (new URL(url).pathname === new URL(env.databaseUrl).pathname) {
    console.error('SOURCE_DATABASE_URL points at the accounts database itself. Aborting.');
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  const summary = await collect(url);

  console.log(`\n  source           : ${new URL(url).pathname.slice(1)}`);
  console.log(`  active users     : ${summary.scanned}`);
  console.log(`  would create     : ${summary.wouldCreate.length}`);
  console.log(`  skipped, no password : ${summary.skippedNoPassword.length}`);
  console.log(`  skipped, identity exists : ${summary.skippedExisting.length}`);
  if (summary.duplicateEmails.length) {
    console.log(`  ⚠ duplicate emails   : ${summary.duplicateEmails.join(', ')}`);
  }

  for (const u of summary.wouldCreate) console.log(`      + ${u.email}`);
  for (const u of summary.skippedNoPassword) console.log(`      - ${u.email} (no password set)`);
  for (const e of summary.skippedExisting) console.log(`      = ${e} (already an identity)`);

  if (!apply) {
    console.log('\n  DRY RUN — nothing written. Re-run with --apply to create these.\n');
    await prisma.$disconnect();
    return;
  }

  /**
   * 🔴 `emailVerified: true` on every seeded identity, by explicit decision
   * (2026-08-24). These addresses already receive mail from the app — invitations,
   * password resets — so treating them as proven is a defensible reading of
   * evidence we already have, and the alternative would force every existing user
   * to verify an inbox before their first sign-in.
   *
   * Be clear about what it costs: this flag is what §9.2's email-link branch trusts
   * to bind an identity to an existing local user. Marking these verified is safe
   * only because WE are asserting it from the app's own records — it must never be
   * set this way for an address a user merely typed.
   */
  const created = await prisma.$transaction(
    summary.wouldCreate.map((u) =>
      prisma.user.create({
        data: {
          email: u.email,
          passwordHash: u.password_hash,
          firstName: u.first_name,
          lastName: u.last_name,
          emailVerified: true,
        },
        select: { id: true },
      }),
    ),
  );

  console.log(
    `\n  ✅ created ${created.length} identities. Existing passwords carry over unchanged.\n`,
  );
  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error('seed-identities failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
