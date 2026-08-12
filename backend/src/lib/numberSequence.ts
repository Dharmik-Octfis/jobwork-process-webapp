import type { TenantClient } from '../db/prisma.ts';

/**
 * Document numbering — one sequence per organization per entity type.
 *
 * `number_sequences` is already generic (`entityType` + `prefix` + `nextNumber`)
 * and the vendor / purchase-order modules each read it inline. This file exists
 * because jobwork adds four more document types at once, and four inline copies
 * of the same increment is how two of them end up with different padding.
 *
 * 🔴 Allocation is a single atomic `upsert` with `increment: 1`, not a read then
 * a write. Postgres takes a row lock for the duration of the UPDATE, so two
 * concurrent job issues cannot be handed the same challan number. A
 * read-then-write would look identical in a single-user test and hand out
 * duplicates the first busy morning — and the number is already printed on a
 * challan by then.
 *
 * Numbers are allocated on SAVE, never when a form opens (field-sources doc
 * §2.2): a form that is opened and abandoned must not burn a number, because a
 * gap in a statutory document series is a question an auditor asks.
 */

/** Entity types this app numbers, with the prefix and width a new org starts on. */
export const NUMBER_SEQUENCE_DEFAULTS = {
  vendor: { prefix: 'VEN-', width: 5 },
  purchase_order: { prefix: 'PO-', width: 5 },
  /**
   * Claimed before the module exists (phase 2, domain doc §7.3) for the same
   * reason as the jobwork four below. `PR-` is reserved for the receipt, not
   * Purchase Return — the receipt number is the one printed on the gate copy and
   * quoted on the bill, so it gets the short prefix. Purchase Return takes
   * `PRTN-` when it ships.
   */
  purchase_receipt: { prefix: 'PR-', width: 5 },
  customer: { prefix: 'CUS-', width: 5 },
  /**
   * Jobwork, registered in Sprint 1 so the sequences exist before the documents
   * that use them do. `lot` is the only one Sprint 1 can actually allocate — the
   * other three are claimed here so a later sprint cannot pick a colliding
   * `entityType` string by accident.
   *
   * One GLOBAL lot sequence per org, deliberately not bound to the PO
   * (domain doc §5.2.2): ~5 of every 6 lots have no PO at all, merges have no
   * valid answer, and a lot number gets printed on a tag stuck to a roll, so it
   * must never be renumbered. `Lot.supplierLotRef` serves the "show me the
   * vendor's own batch number" need instead.
   */
  lot: { prefix: 'LOT-', width: 5 },
  job_order: { prefix: 'JO-', width: 5 },
  job_issue: { prefix: 'JI-', width: 5 },
  job_receipt: { prefix: 'JR-', width: 5 },
  assembly: { prefix: 'ASM-', width: 5 },
} as const satisfies Record<string, { prefix: string; width: number }>;

export type NumberedEntityType = keyof typeof NUMBER_SEQUENCE_DEFAULTS;

/**
 * Take the next number for `entityType`, advancing the sequence in the same
 * statement.
 *
 * Must run inside the caller's `runAsTenant` transaction: if the document write
 * rolls back, the number rolls back with it and is reused rather than lost.
 */
export async function allocateNumber(
  tx: TenantClient,
  organizationId: string,
  entityType: NumberedEntityType,
): Promise<string> {
  const { prefix, width } = NUMBER_SEQUENCE_DEFAULTS[entityType];

  const seq = await tx.numberSequence.upsert({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    where: { organizationId_entityType: { organizationId, entityType } },
    // No row yet: create it already consumed, so this call gets 1 and the next
    // gets 2. Creating it at 1 and reading it back would hand 1 out twice.
    create: { organizationId, entityType, prefix, nextNumber: 2 },
    update: { nextNumber: { increment: 1 } },
  });

  // `upsert` returns the row AFTER the update, so the number we were handed is
  // one behind the stored cursor.
  const allocated = seq.nextNumber - 1;
  return `${seq.prefix}${String(allocated).padStart(width, '0')}`;
}

/** What the next `allocateNumber` call would hand out, without consuming it. */
export function formatNumber(
  entityType: NumberedEntityType,
  prefix: string,
  value: number,
): string {
  return `${prefix}${String(value).padStart(NUMBER_SEQUENCE_DEFAULTS[entityType].width, '0')}`;
}

/**
 * The org's sequence for `entityType`, created on its defaults if it has never
 * been read. This is what the "configure numbering" dialog opens on.
 */
export async function getNumberPreference(
  tx: TenantClient,
  organizationId: string,
  entityType: NumberedEntityType,
) {
  const existing = await tx.numberSequence.findUnique({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    where: { organizationId_entityType: { organizationId, entityType } },
  });
  if (existing) return existing;

  // `nextNumber: 1` — the row is created UNCONSUMED here, unlike `allocateNumber`'s
  // create branch, because this is a read of what the next save will use.
  return tx.numberSequence.create({
    data: {
      organizationId,
      entityType,
      prefix: NUMBER_SEQUENCE_DEFAULTS[entityType].prefix,
      nextNumber: 1,
    },
  });
}

export async function setNumberPreference(
  tx: TenantClient,
  organizationId: string,
  entityType: NumberedEntityType,
  prefix: string,
  nextNumber: number,
) {
  return tx.numberSequence.upsert({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    where: { organizationId_entityType: { organizationId, entityType } },
    create: { organizationId, entityType, prefix, nextNumber },
    update: { prefix, nextNumber },
  });
}

/**
 * The user typed the number instead of taking the one the form offered.
 *
 * The typed value is used as-is — overriding one document's number is the whole
 * point — but the series still has to move past it, or the next save is handed a
 * number this row already holds and dies on the unique index. Only a value that
 * is recognisably part of THIS series (same prefix, digits after it) moves the
 * cursor, and only ever forwards: someone reusing an old number must not drag the
 * series backwards onto numbers that are already issued.
 */
export async function reserveSuppliedNumber(
  tx: TenantClient,
  organizationId: string,
  entityType: NumberedEntityType,
  supplied: string,
): Promise<string> {
  const number = supplied.trim();
  const seq = await getNumberPreference(tx, organizationId, entityType);

  if (number.startsWith(seq.prefix)) {
    const digits = number.slice(seq.prefix.length);
    const parsed = Number(digits);
    if (/^\d+$/.test(digits) && Number.isSafeInteger(parsed) && parsed >= seq.nextNumber) {
      await tx.numberSequence.update({
        where: { id: seq.id },
        data: { nextNumber: parsed + 1 },
      });
    }
  }

  return number;
}
