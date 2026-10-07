import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import { invalidateDefinitions } from '../../settings/customization/custom-fields/customFields.engine.ts';
import { seedTestReasons } from './adjustmentReasons.testing.ts';
import { adjustmentsService } from './adjustments.service.ts';
import type { SaveAdjustmentDto } from './adjustments.schemas.ts';

/**
 * Custom fields on a stock adjustment. Its own file and org: the definitions are
 * cached per org, and a REQUIRED field would fail every other adjustment test.
 * Drafts only — no stock moves, so no ledger fixtures.
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let godownId: string;
let itemId: string;
let reasonId: string;

const payload = (extra: Partial<SaveAdjustmentDto> = {}): SaveAdjustmentDto => ({
  locationId: godownId,
  adjustmentDate: new Date().toISOString(),
  reasonId,
  lines: [{ itemId, quantityAdjusted: 5, costPrice: 10 }],
  saveAs: 'draft',
  ...extra,
});

beforeAll(async () => {
  orgId = await createTestOrganization('stock-adjustment-cf');
  reasonId = (await seedTestReasons(orgId))['Stock count correction'];
  await runAsTenant(orgId, async (tx) => {
    const metre = await tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    godownId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;
    itemId = (
      await tx.item.create({
        data: {
          organizationId: orgId,
          name: `Adj CF ${unique()}`,
          sku: `ADJCF-${unique()}`,
          unit: 'Metre',
          stockingUomId: metre.id,
          itemType: 'goods',
          trackInventory: true,
          inventoryTracking: 'none',
        },
        select: { id: true },
      })
    ).id;
    await tx.customFieldDefinition.create({
      data: {
        organizationId: orgId,
        entityType: 'stock_adjustment',
        key: 'vehicle_no',
        label: 'Vehicle No',
        dataType: 'text',
        isRequired: true,
      },
    });
  });
  invalidateDefinitions(orgId, 'stock_adjustment');
});

afterAll(async () => {
  if (orgId) {
    await runAsTenant(orgId, async (tx) => {
      await tx.stockAdjustmentLine.deleteMany({ where: { organizationId: orgId } });
      await tx.stockAdjustment.deleteMany({ where: { organizationId: orgId } });
      await tx.customFieldDefinition.deleteMany({ where: { organizationId: orgId } });
      await tx.item.deleteMany({ where: { organizationId: orgId } });
      await tx.location.deleteMany({ where: { organizationId: orgId } });
      await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
      await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
    });
    invalidateDefinitions(orgId, 'stock_adjustment');
  }
  await deleteTestOrganization(orgId);
});

describe('stock adjustment custom fields', () => {
  it('refuses a save that leaves a required field empty, naming the field', async () => {
    await expect(adjustmentsService.createAdjustment(orgId, null, payload())).rejects.toMatchObject(
      { status: 400, details: { 'customFields.vehicle_no': expect.any(String) } },
    );
  });

  it('stores the validated object — unknown keys stripped — and keeps it on an edit that omits it', async () => {
    const created = await adjustmentsService.createAdjustment(
      orgId,
      null,
      payload({ customFields: { vehicle_no: 'GJ05AB1234', not_a_field: 'x' } }),
    );
    expect(created.customFields).toEqual({ vehicle_no: 'GJ05AB1234' });

    const edited = await adjustmentsService.updateAdjustment(orgId, created.id, null, payload());
    expect(edited.customFields).toEqual({ vehicle_no: 'GJ05AB1234' });
  });
});
