import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAsTenant } from '../../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../../db/testTenant.ts';
import { deleteUomById } from './uom.service.ts';

let orgId: string;

async function makeUom(unitName: string) {
  return runAsTenant(orgId, (tx) =>
    tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName, symbol: unitName.slice(0, 3) },
      select: { id: true },
    }),
  );
}

async function makeItem(stockingUomId: string, isDeleted = false) {
  return runAsTenant(orgId, (tx) =>
    tx.item.create({
      data: {
        organizationId: orgId,
        name: `Item ${stockingUomId}`,
        unit: '',
        sku: '',
        stockingUomId,
        isDeleted,
      },
    }),
  );
}

beforeAll(async () => {
  orgId = await createTestOrganization('uom-delete');
});

afterAll(async () => {
  if (orgId) {
    await runAsTenant(orgId, (tx) => tx.item.deleteMany({ where: { organizationId: orgId } }));
  }
  await deleteTestOrganization(orgId);
});

describe('deleting a unit of measurement', { timeout: 60_000 }, () => {
  it('deletes a unit nothing uses', async () => {
    const uom = await makeUom('Unused');
    await expect(deleteUomById(orgId, uom.id)).resolves.toBeDefined();
  });

  it('refuses a unit a live item is stocked in, and says what uses it', async () => {
    const uom = await makeUom('Metre');
    await makeItem(uom.id);
    await expect(deleteUomById(orgId, uom.id)).rejects.toMatchObject({
      status: 409,
      message: 'Metre is used by 1 item, so it cannot be deleted.',
    });
  });

  it('ignores a soft-deleted item', async () => {
    const uom = await makeUom('Kilogram');
    await makeItem(uom.id, true);
    await expect(deleteUomById(orgId, uom.id)).resolves.toBeDefined();
  });
});
