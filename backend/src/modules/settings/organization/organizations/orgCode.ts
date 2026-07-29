import { randomInt } from 'node:crypto';
import { Prisma } from '../../../../../generated/prisma/client.ts';

/**
 * The organization support code: ten digits a customer can read aloud.
 *
 * This exists for one reason — a uuid cannot be spoken. When support asks "which
 * organization?", the customer reads this off the org switcher. It is a *label*,
 * not an identifier: `organizations.id` remains the primary key, the foreign key
 * on every tenant table, and the value `tenantContext` checks. Nothing joins on
 * org_code, no route contains it, and no authorization decision reads it. Keep it
 * that way — the moment it appears in a `where` clause that grants access, it
 * stops being a display string and becomes a credential nobody hardened.
 *
 * Digits only, no letters: this value's whole job is to survive being read down a
 * phone line, and `0/O` and `1/I/l` are how that goes wrong.
 */

const MIN_CODE = 1_000_000_000;
const MAX_CODE_EXCLUSIVE = 10_000_000_000;

/**
 * A uniformly random ten-digit code.
 *
 * `crypto.randomInt` rather than `Math.random`: it draws from the OS CSPRNG and
 * rejection-samples internally, so the result is exactly uniform rather than
 * skewed toward low values by modulo bias. Uniformity is the assumption the
 * collision arithmetic below rests on, so it is not a detail.
 *
 * The range starts at 1_000_000_000 so there is never a leading zero — every code
 * is ten characters, which is what makes it readable back over the phone and what
 * lets the column be VARCHAR(10).
 */
export function generateOrgCode(): string {
  return String(randomInt(MIN_CODE, MAX_CODE_EXCLUSIVE));
}

/**
 * How many times {@link withOrgCodeRetry} will re-roll before giving up.
 *
 * With 9e9 possible codes and `n` organizations, one insert collides with
 * probability n/9e9, so all five attempts failing has probability (n/9e9)^5 —
 * about 1e-35 at a thousand organizations, and still 1e-20 at a million. This
 * loop will not run a second iteration in production.
 *
 * It exists anyway because the unique index *will* reject a duplicate eventually,
 * and the difference between a transparent retry and a 500 on "create
 * organization" costs six lines. If you ever see it exhaust, the cause is not bad
 * luck — it is a broken RNG (mocked in a test, memoized by a well-meaning
 * refactor) or a miscategorised constraint. Treat exhaustion as a bug report.
 */
const MAX_ATTEMPTS = 5;

/**
 * True only for a unique violation on `organizations_org_code_key`.
 *
 * The constraint check is load-bearing. Prisma reports *every* unique violation
 * as P2002, so retrying on the bare code would silently re-run the whole
 * transaction five times for a genuine duplicate on some other key — burning four
 * extra round trips and then throwing the same error anyway, with the real cause
 * now four attempts further from the top of the log.
 */
function isOrgCodeCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;

  const target = error.meta?.['target'];
  const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return fields.includes('org_code') || fields.includes('orgCode');
}

/**
 * Run `create`, re-rolling the code if it collides.
 *
 * 🔴 Pass the **entire transaction**, not a statement inside one. A failed
 * statement poisons the surrounding Postgres transaction — every subsequent
 * statement returns "current transaction is aborted" until it rolls back — so a
 * retry nested inside the same `runAsTenant` callback cannot succeed. The
 * callback must own the whole `runAsTenant(...)` call so a failed attempt rolls
 * back cleanly and the next one starts fresh.
 *
 * ```ts
 * const organization = await withOrgCodeRetry((orgCode) =>
 *   runAsTenant(orgId, async (tx) => tx.organization.create({ data: { orgCode, ... } })),
 * );
 * ```
 */
export async function withOrgCodeRetry<T>(create: (orgCode: string) => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await create(generateOrgCode());
    } catch (error) {
      if (!isOrgCodeCollision(error)) throw error;
      lastError = error;
      console.warn(
        `org_code collision on attempt ${attempt}/${MAX_ATTEMPTS} — re-rolling. ` +
          'If you are reading this more than once in the lifetime of this product, ' +
          'suspect the generator, not chance.',
      );
    }
  }

  throw lastError;
}
