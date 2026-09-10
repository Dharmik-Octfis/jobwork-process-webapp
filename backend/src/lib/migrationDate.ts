import { ApiError } from './apiError.ts';
import type { TenantClient } from '../db/prisma.ts';

/**
 * 🔴 THE DAY AN ORGANIZATION'S BOOKS BEGIN HERE — one definition, one guard.
 *
 * Deliberately NOT spelled out per module, for the same reason `ACTIVE_USER`
 * lives in `authGuards.ts` and `assertOrgAdmin` was deleted: a rule written
 * inline in nine services is a rule checked in eight of them, and the one that
 * forgets fails OPEN and silently. A document lands before the anchor, nothing
 * errors, and from then on every "as on" report for that period is quietly
 * wrong — the same shape as a tenant table with no RLS policy.
 *
 * The enforcement is entirely on the WRITE path. Nothing downstream filters on
 * the migration date, because after this guard there is nothing to filter: the
 * ledger simply never contains a row dated before the anchor. That is what
 * keeps every balance and as-on query naive.
 */

/**
 * The instant that starts a date's UTC calendar day.
 *
 * 🔴 BOTH SIDES GO THROUGH THIS, and both are UTC midnight already — which is
 * the only reason a plain comparison is safe here.
 *
 * `migration_date` is a `date`, so Prisma hands it back at UTC midnight. Every
 * document date arrives as a DATE-ONLY string (`.slice(0, 10)` in `IssueForm`,
 * `.split('T')[0]` in `CreateBill`, and so on), which `z.coerce.date()` parses
 * as UTC midnight per the ISO spec. So the day is carried, never a local
 * instant, and this only has to strip a time component that is not there.
 *
 * 🔴 THAT IS A CONTRACT WITH THE FRONT END, not a property of dates. A form
 * that starts sending an offset-bearing ISO — `2026-04-01T00:00:00+05:30`, what
 * a naive `toISOString()` on a local Date produces in IST — sends an instant six
 * hours into the PREVIOUS UTC day, and this refuses the first day of the books
 * for every Indian user while passing in UTC. There is no per-org timezone in
 * this schema to arbitrate with, so the wire format is what keeps it honest.
 * `migrationDate.test.ts` pins both halves.
 */
function utcDayStart(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/** `20-04-2026` — the form the Zoho screen this mirrors shows, and Indian usage. */
function formatDay(value: Date): string {
  const day = String(value.getUTCDate()).padStart(2, '0');
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${value.getUTCFullYear()}`;
}

/**
 * The organization's anchor, or `null` when it has never been migrated.
 *
 * `organizations` carries no RLS policy on purpose (it is read before a tenant
 * exists), so the `where` is the only thing scoping this — never drop it.
 */
export async function getMigrationDate(
  tx: TenantClient,
  organizationId: string,
): Promise<Date | null> {
  const org = await tx.organization.findFirst({
    where: { id: organizationId, isDeleted: false },
    select: { migrationDate: true },
  });
  return org?.migrationDate ?? null;
}

/**
 * Refuse a document dated before the organization's books began.
 *
 * A hard 400 rather than a warning, which is a departure from this codebase's
 * usual preference and is the standard every accounting system holds to (Zoho
 * Books, Tally, SAP all restrict rather than warn): the opening balance is only
 * a complete statement of everything prior for as long as nothing can be filed
 * behind it.
 *
 * Silent when the org has no anchor — an organization that never migrated has
 * no period to protect, and every organization predating the column reads null.
 *
 * @param field the form field the message should highlight, e.g. `issueDate`
 * @param label how the document reads in a sentence, e.g. `challan`
 */
export async function assertOnOrAfterMigration(
  tx: TenantClient,
  args: { organizationId: string; date: Date; field: string; label: string },
): Promise<void> {
  const anchor = await getMigrationDate(tx, args.organizationId);
  if (!anchor) return;
  if (utcDayStart(args.date) >= utcDayStart(anchor)) return;

  throw ApiError.badRequest(
    `This ${args.label} is dated before your organization's books begin here.`,
    {
      [args.field]:
        `Your books here begin on ${formatDay(anchor)}. ` +
        'Anything earlier is already counted in your opening stock, so pick a date ' +
        'on or after it.',
    },
  );
}
