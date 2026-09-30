import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { getJobworkChallans } from './jobworkChallans.service.ts';
import { runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';

describe('jobworkChallans.service', () => {
  let orgId: string;

  beforeAll(async () => {
    orgId = await createTestOrganization('jobwork-challans-test');
  });

  afterAll(async () => {
    await deleteTestOrganization(orgId);
  });

  it('calculates pending quantity correctly', async () => {

    await runAsTenant(orgId, async (tx) => {
      const location = await tx.location.create({
        data: { organizationId: orgId, name: 'Processor Loc', type: 'vendor_location' }
      });
      const vendor = await tx.vendor.create({
        data: { organizationId: orgId, companyName: 'Test Processor', contactName: 'Test', contactNumber: '1234567890' }
      });
      const item = await tx.item.create({
        data: { organizationId: orgId, name: 'Raw Material', sku: 'RM-1', stockingUomId: null, unit: 'kg' }
      });
      const process = await tx.process.create({
        data: { organizationId: orgId, name: 'Dyeing' }
      });
      const jobOrder = await tx.jobOrder.create({
        data: {
          organizationId: orgId,
          jobOrderNumber: 'JO-001',
          ownership: 'ours',
          status: 'open',
        }
      });
      const step = await tx.jobOrderStep.create({
        data: {
          organizationId: orgId,
          jobOrderId: jobOrder.id,
          processId: process.id,
          processNameSnapshot: process.name,
          seq: 1,
        }
      });
      
      const issue = await tx.jobIssue.create({
        data: {
          organizationId: orgId,
          challanNumber: 'CH-001',
          processorId: vendor.id,
          processorType: 'vendor',
          processorNameSnapshot: vendor.companyName,
          jobOrderId: jobOrder.id,
          jobOrderStepId: step.id,
          sourceLocationId: location.id,
          destinationLocationId: location.id,
          issueDate: new Date('2026-09-01T10:00:00Z'),
          status: 'posted',
        }
      });

      
      const batch = await tx.batch.create({
        data: {
          organizationId: orgId,
          itemId: item.id,
          batchNumber: 'BATCH-1',
          state: 'open',
        }
      });
      const line = await tx.jobIssueLine.create({
        data: {
          organizationId: orgId,
          jobIssueId: issue.id,
          itemId: item.id,
          batchId: batch.id,
          sourceLocationId: location.id,
          qty: 100,
        }
      });

      // Partially close it with a receipt
      const receipt = await tx.jobReceipt.create({
        data: {
          organizationId: orgId,
          receiptNumber: 'RC-001',
          processorId: vendor.id,
          processorType: 'vendor',
          processorNameSnapshot: vendor.companyName,
          jobOrderId: jobOrder.id,
          jobOrderStepId: step.id,
          locationId: location.id,
          receiptDate: new Date('2026-09-02T10:00:00Z'),
          status: 'posted',
        }
      });
      
      await tx.jobReceiptLine.create({
        data: {
          organizationId: orgId,
          jobReceiptId: receipt.id,
          jobIssueLineId: line.id,
          receivedQty: 40,
          issuedQty: 40,
        }
      });
    });
    
    const res = await getJobworkChallans(orgId, { page: 1, perPage: 100, openOnly: false });
    
    expect(res.results.length).toBe(1);
    
    const challanRow = res.results[0]!;
    expect(challanRow.challanNumber).toBe('CH-001');
    expect(challanRow.issuedQty).toBe(100);
    expect(challanRow.pendingQty).toBe(60); // 100 - 40
    expect(challanRow.processorName).toBe('Test Processor');
    expect(challanRow.process).toBe('Dyeing');
    expect(challanRow.items).toBe('Raw Material (kg)');
  });
});
