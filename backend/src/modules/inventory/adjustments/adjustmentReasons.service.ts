import { runAsTenant, type TenantClient } from '../../../db/prisma.js';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.js';

/** What every organization starts with — the list the code used to fix. */
export const DEFAULT_ADJUSTMENT_REASONS = [
  'Damaged goods',
  'Lost or stolen',
  'Stock found',
  'Stock count correction',
  'Write-down to realisable value',
  'Cost correction',
  'Other',
] as const;

export async function seedDefaultAdjustmentReasons(
  tx: TenantClient,
  organizationId: string,
  userId: string | null,
) {
  if (!tx.stockAdjustmentReason?.createMany) {
    return;
  }
  await tx.stockAdjustmentReason.createMany({
    data: DEFAULT_ADJUSTMENT_REASONS.map((name) => ({
      organizationId,
      name,
      createdBy: userId,
      updatedBy: userId,
    })),
    skipDuplicates: true,
  });
}

/**
 * The reason an adjustment may be saved with. An inactive one is refused, except
 * on a document that already carries it — editing an old draft must not force a
 * new reason on it.
 */
export async function assertUsableReason(
  tx: TenantClient,
  organizationId: string,
  reasonId: string,
  existingAdjustmentId?: string,
) {
  const reason = await tx.stockAdjustmentReason.findFirst({
    where: { id: reasonId, organizationId, isDeleted: false },
    select: { id: true, isActive: true },
  });
  if (!reason) throw ApiError.badRequest('Select a reason.', { reasonId: 'Select a reason.' });
  if (reason.isActive) return;
  const keeps = existingAdjustmentId
    ? await tx.stockAdjustment.count({
        where: { id: existingAdjustmentId, organizationId, reasonId },
      })
    : 0;
  if (!keeps) {
    throw ApiError.badRequest('That reason is inactive.', { reasonId: 'Select an active reason.' });
  }
}

async function loadReason(tx: TenantClient, organizationId: string, id: string) {
  const reason = await tx.stockAdjustmentReason.findFirst({
    where: { id, organizationId, isDeleted: false },
    select: { id: true, name: true },
  });
  if (!reason) throw ApiError.notFound('Reason not found.');
  return reason;
}

const REASON_SELECT = { id: true, name: true, isActive: true } as const;

export const adjustmentReasonsService = {
  /** Every reason, active or not, and whether an adjustment uses it. */
  list: (organizationId: string) =>
    runAsTenant(organizationId, async (tx) => {
      const reasons = await tx.stockAdjustmentReason.findMany({
        where: { organizationId, isDeleted: false },
        orderBy: { createdAt: 'asc' },
        select: REASON_SELECT,
      });
      // Deleted drafts count too: their row still points at the reason.
      const usage = await tx.stockAdjustment.groupBy({
        by: ['reasonId'],
        where: { organizationId },
      });
      const used = new Set(usage.map((row) => row.reasonId));
      return reasons.map((reason) => ({ ...reason, inUse: used.has(reason.id) }));
    }),

  /** Reasons are unique per org; a name that was deleted is brought back instead. */
  create: (organizationId: string, userId: string, name: string) =>
    runAsTenant(organizationId, async (tx) => {
      const existing = await tx.stockAdjustmentReason.findFirst({
        where: { organizationId, name },
        select: { id: true, isDeleted: true },
      });
      if (existing && !existing.isDeleted) {
        throw ApiError.conflict(`"${name}" already exists.`);
      }
      if (existing) {
        await tx.stockAdjustmentReason.updateMany({
          where: { id: existing.id, organizationId },
          data: { name, isDeleted: false, isActive: true, updatedBy: userId },
        });
        return {
          ...(await loadReason(tx, organizationId, existing.id)),
          isActive: true,
          inUse: false,
        };
      }
      const created = await withUniqueViolation(`"${name}" already exists.`, () =>
        tx.stockAdjustmentReason.create({
          data: { organizationId, name, createdBy: userId, updatedBy: userId },
          select: REASON_SELECT,
        }),
      );
      return { ...created, inUse: false };
    }),

  setActive: (organizationId: string, userId: string, id: string, isActive: boolean) =>
    runAsTenant(organizationId, async (tx) => {
      const reason = await loadReason(tx, organizationId, id);
      await tx.stockAdjustmentReason.updateMany({
        where: { id, organizationId },
        data: { isActive, updatedBy: userId },
      });
      return { ...reason, isActive };
    }),

  /** Only a reason no adjustment has ever used. */
  remove: (organizationId: string, userId: string, id: string) =>
    runAsTenant(organizationId, async (tx) => {
      const reason = await loadReason(tx, organizationId, id);
      const uses = await tx.stockAdjustment.count({ where: { organizationId, reasonId: id } });
      if (uses) {
        throw ApiError.conflict(
          `"${reason.name}" is used on ${uses} adjustment${uses === 1 ? '' : 's'}. Mark it inactive instead.`,
        );
      }
      await tx.stockAdjustmentReason.updateMany({
        where: { id, organizationId },
        data: { isDeleted: true, updatedBy: userId },
      });
      return reason.name;
    }),
};
