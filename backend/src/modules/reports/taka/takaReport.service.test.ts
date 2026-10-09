import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { getTakaReport } from './takaReport.service.ts';
import { runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import { SOURCE_DOC_TYPES } from '../../jobwork/jobwork.types.ts';

describe('takaReport.service', () => {
  let orgId: string;

  beforeAll(async () => {
    orgId = await createTestOrganization('taka-report-test');
  });

  afterAll(async () => {
    await deleteTestOrganization(orgId);
  });

  it('handles partly-tagged batch correctly (tagged + untagged rows)', async () => {
    let locationId = '';
    let batchUnitId = '';
    let batchId = '';

    await runAsTenant(orgId, async (tx) => {
      const location = await tx.location.create({
        data: { organizationId: orgId, name: 'Test Godown', type: 'godown' },
      });
      locationId = location.id;

      const item = await tx.item.create({
        data: {
          organizationId: orgId,
          name: 'Test Item',
          sku: 'TEST-ITEM-2',
          stockingUomId: null,
          unit: 'pcs',
        },
      });

      const batch = await tx.batch.create({
        data: {
          organizationId: orgId,
          itemId: item.id,
          batchNumber: 'BATCH-2',
          supplierBatchRef: 'LOT-2',
          state: 'open',
        },
      });
      batchId = batch.id;

      const batchUnit = await tx.batchUnit.create({
        data: {
          organizationId: orgId,
          batchId: batch.id,
          label: 'TAKA-1',
          seq: 1,
        },
      });
      batchUnitId = batchUnit.id;

      const postedAt = new Date('2026-09-02T10:00:00Z');
      await tx.stockLedgerEntry.createMany({
        data: [
          {
            organizationId: orgId,
            itemId: item.id,
            locationId: location.id,
            batchId: batch.id,
            batchUnitId: batchUnit.id,
            qtyIn: 100,
            valueIn: 500,
            movementType: 'receipt',
            sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
            postedAt,
          },
          {
            organizationId: orgId,
            itemId: item.id,
            locationId: location.id,
            batchId: batch.id,
            batchUnitId: null, // Untagged
            qtyIn: 50,
            valueIn: 200,
            movementType: 'receipt',
            sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
            postedAt,
          },
        ],
      });
    });
    const res = await getTakaReport(orgId, { page: 1, perPage: 100, onlyAtJobWorkers: false });

    expect(res.results.length).toBe(2);

    const untaggedRow = res.results.find((r) => r.label === '(untagged)');
    expect(untaggedRow).toBeDefined();
    expect(untaggedRow?.qty).toBe(50);
    expect(untaggedRow?.id).toBe(batchId + ':untagged:' + locationId);

    const taggedRow = res.results.find((r) => r.label === 'TAKA-1');
    expect(taggedRow).toBeDefined();
    expect(taggedRow?.qty).toBe(100);
    expect(taggedRow?.id).toBe(batchUnitId + ':' + locationId);

    // Verify fromDate / toDate filtering works without query error
    const filteredRes = await getTakaReport(orgId, {
      page: 1,
      perPage: 100,
      onlyAtJobWorkers: false,
      fromDate: '2026-09-01T00:00:00Z',
      toDate: '2026-09-03T00:00:00Z',
    });
    expect(filteredRes.results.length).toBe(2);
  });
});
