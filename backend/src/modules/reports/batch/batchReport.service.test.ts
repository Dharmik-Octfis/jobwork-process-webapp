import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { getBatchReport } from './batchReport.service.ts';
import  {runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import { SOURCE_DOC_TYPES } from '../../jobwork/jobwork.types.ts';

describe('batchReport.service', () => {
  let orgId: string;

  beforeAll(async () => {
    orgId = await createTestOrganization('batch-report-test');
  });

  afterAll(async () => {
    await deleteTestOrganization(orgId);
  });

  it('filters out draft batches and handles unallocated batches properly', async () => {
    await runAsTenant(orgId, async (tx) => {
      const location = await tx.location.create({
        data: { organizationId: orgId, name: 'Test Godown', type: 'godown' }
      });
      const item = await tx.item.create({
        data: { organizationId: orgId, name: 'Test Item', sku: 'TEST-ITEM-1', stockingUomId: null, unit: 'pcs' }
      });

      const unallocatedBatch = await tx.batch.create({
        data: {
          organizationId: orgId,
          itemId: item.id,
          batchNumber: 'UNALLOC',
          state: 'unallocated',
        }
      });

      const normalBatch = await tx.batch.create({
        data: {
          organizationId: orgId,
          itemId: item.id,
          batchNumber: 'BATCH-1',
          supplierBatchRef: 'LOT-1',
          state: 'open',
        }
      });

      const draftBatch = await tx.batch.create({
        data: {
          organizationId: orgId,
          itemId: item.id,
          batchNumber: 'DRAFT-1',
          state: 'draft',
        }
      });

      const postedAt = new Date('2026-09-01T10:00:00Z');
      await tx.stockLedgerEntry.createMany({
        data: [
          {
            organizationId: orgId,
            itemId: item.id,
            locationId: location.id,
            batchId: normalBatch.id,
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
            batchId: unallocatedBatch.id,
            qtyIn: 50,
            valueIn: 200,
            movementType: 'opening',
            sourceDocType: 'item_opening_stock',
            postedAt,
          },
          {
            organizationId: orgId,
            itemId: item.id,
            locationId: location.id,
            batchId: draftBatch.id,
            qtyIn: 10,
            valueIn: 10,
            movementType: 'receipt',
            sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
            postedAt,
          }
        ]
      });
    });

    const res = await getBatchReport(orgId, { page: 1, perPage: 100 });

    expect(res.results.length).toBe(2); // Draft batch is filtered out

    const sortedBatches = res.results.map(r => r.batchNumber).sort();
    expect(sortedBatches).toEqual(['BATCH-1', 'UNALLOC']);

    const unallocRow = res.results.find(r => r.batchNumber === 'UNALLOC');
    expect(unallocRow?.state).toBe('unallocated');
    expect(unallocRow?.qty).toBe(50);

    const normalRow = res.results.find(r => r.batchNumber === 'BATCH-1');
    expect(normalRow?.qty).toBe(100);
    expect(normalRow?.value).toBe(500);
  });
});
