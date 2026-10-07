import { runAsTenant } from '../../../db/prisma.js';
import {
  DEFAULT_ADJUSTMENT_REASONS,
  seedDefaultAdjustmentReasons,
} from './adjustmentReasons.service.js';

type DefaultReason = (typeof DEFAULT_ADJUSTMENT_REASONS)[number];

/** `createTestOrganization` skips org-creation seeding; this gives a test org the
 * default reasons and returns their ids by name. */
export async function seedTestReasons(orgId: string): Promise<Record<DefaultReason, string>> {
  return runAsTenant(orgId, async (tx) => {
    await seedDefaultAdjustmentReasons(tx, orgId, null);
    const rows = await tx.stockAdjustmentReason.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
    });
    return Object.fromEntries(rows.map((row) => [row.name, row.id])) as Record<
      DefaultReason,
      string
    >;
  });
}
