import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import { createBatch, getBalance, postMovement } from '../stock-ledger/stockLedger.service.ts';
import { approvalProcessService } from '../../automation/approval-processes/approvalProcess.service.ts';
import { approvalExecutionService } from '../../automation/approval-processes/approvalExecution.service.ts';
import { ensureApprovalTables } from '../../automation/approval-processes/approvalTables.migration.ts';
import { adjustmentsService, ADJUSTMENT_APPROVAL_MODULE } from './adjustments.service.ts';
import type { SaveAdjustmentDto } from './adjustments.schemas.ts';

/**
 * 🔴 THE APPROVAL GATE (STOCK_ADJUSTMENT_ROUND2_PLAN.md §2, B4–B6).
 *
 * With an approval process configured for stock adjustments, Adjust must move no
 * stock until the last approver approves — and must never post unapproved
 * because the approval engine failed. This organization has such a process; the
 * plain posting rules are tested in adjustments.service.test.ts, in one without.
 *
 * Own organization, users and process, hard-deleted afterwards.
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let requesterId: string;
let approverId: string;
let processAdminId: string;
let metreId: string;
let godownId: string;
const userIds: string[] = [];

async function makeMember(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `adj-appr-${label}-${unique()}@example.test`,
      passwordHash: 'x',
      firstName: label,
      fullName: `${label} Tester`,
    },
    select: { id: true },
  });
  userIds.push(user.id);
  await prisma.membership.create({
    data: {
      userId: user.id,
      organizationId: orgId,
      firstName: label,
      lastName: 'Tester',
      fullName: `${label} Tester`,
    },
  });
  return user.id;
}

async function makeItem() {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name: `Adj appr ${unique()}`,
        sku: `ADJA-${unique()}`,
        unit: 'Metre',
        stockingUomId: metreId,
        itemType: 'goods',
        trackInventory: true,
        inventoryTracking: 'none',
      },
      select: { id: true },
    });
    return item.id;
  });
}

/** Stock put there (or taken away) by something that is not an adjustment. */
async function move(itemId: string, qty: number) {
  return runAsTenant(orgId, async (tx) => {
    if (qty > 0) {
      const batch = await createBatch(tx, { organizationId: orgId, itemId, sourceDocType: 'test' });
      await postMovement(tx, {
        organizationId: orgId,
        batchId: batch.id,
        locationId: godownId,
        movementType: 'receipt',
        qtyIn: qty,
        valueIn: qty * 10,
        sourceDocType: 'test',
      });
      return batch.id;
    }
    const batch = await tx.batch.findFirstOrThrow({
      where: { organizationId: orgId, itemId },
      select: { id: true },
    });
    await postMovement(tx, {
      organizationId: orgId,
      batchId: batch.id,
      locationId: godownId,
      movementType: 'issue',
      qtyOut: -qty,
      sourceDocType: 'test',
    });
    return batch.id;
  });
}

const balance = async (itemId: string) =>
  (
    await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, itemId, locationId: godownId }),
    )
  ).qty.toString();

const payload = (
  itemId: string,
  quantityAdjusted: number,
  saveAs: 'draft' | 'adjust' = 'adjust',
): SaveAdjustmentDto => ({
  locationId: godownId,
  adjustmentDate: new Date().toISOString(),
  reason: 'count_correction',
  lines: [{ itemId, quantityAdjusted, ...(quantityAdjusted > 0 ? { costPrice: 10 } : {}) }],
  saveAs,
});

const requestFor = async (adjustmentId: string) => {
  const rows = await runAsTenant(
    orgId,
    (tx) =>
      tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT "id", "status" FROM "approval_requests"
      WHERE "organization_id" = ${orgId}::uuid AND "record_id" = ${adjustmentId}
      ORDER BY "submitted_at" DESC`,
  );
  return rows;
};

const statusOf = async (id: string) => (await adjustmentsService.getAdjustment(orgId, id)).status;

beforeAll(async () => {
  await ensureApprovalTables();
  orgId = await createTestOrganization('stock-adjustment-approval');
  requesterId = await makeMember('requester');
  approverId = await makeMember('approver');
  processAdminId = await makeMember('admin');

  await runAsTenant(orgId, async (tx) => {
    metreId = (
      await tx.unitOfMeasurement.create({
        data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
        select: { id: true },
      })
    ).id;
    godownId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;
  });

  // One process, no criteria (matches every adjustment), one approver.
  const definition = {
    name: `Stock adjustments ${unique()}`,
    moduleId: ADJUSTMENT_APPROVAL_MODULE,
    triggerType: 'CREATE_OR_EDIT' as const,
  };
  const created = await approvalProcessService.createProcess(orgId, definition, requesterId);
  await approvalProcessService.updateProcess(
    orgId,
    created.id,
    {
      ...definition,
      rules: [
        {
          name: 'Every adjustment',
          ruleOrder: 1,
          criteria: [],
          criteriaPattern: '',
          stages: [
            {
              name: 'Stores head',
              stageOrder: 1,
              approverType: 'USER',
              approverConfig: { userIds: [approverId] },
              approvalMode: 'ANYONE',
              assignTaskForApprovers: false,
            },
          ],
          finalActions: [],
          rejectionActions: [],
        },
      ],
      admins: [{ userId: processAdminId }],
    },
    requesterId,
  );
  await approvalProcessService.activateProcess(orgId, created.id, requesterId);
}, 60_000);

afterAll(async () => {
  if (orgId) {
    await runAsTenant(orgId, async (tx) => {
      await tx.stockAdjustmentBatch.deleteMany({ where: { organizationId: orgId } });
      await tx.stockAdjustmentLine.deleteMany({ where: { organizationId: orgId } });
      await tx.stockAdjustment.deleteMany({ where: { organizationId: orgId } });
      await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
      await tx.batch.deleteMany({ where: { organizationId: orgId } });
      await tx.item.deleteMany({ where: { organizationId: orgId } });
      await tx.location.deleteMany({ where: { organizationId: orgId } });
      await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
      await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
    });
  }
  if (userIds.length) await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  // The approval tables go with the organization (ON DELETE CASCADE).
  await deleteTestOrganization(orgId);
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe('stock adjustment — the approval gate', { timeout: 90_000 }, () => {
  it('Adjust waits for approval and moves no stock; approving posts it', async () => {
    const itemId = await makeItem();
    const adjustment = await adjustmentsService.createAdjustment(
      orgId,
      requesterId,
      payload(itemId, 5),
    );

    expect(adjustment.status).toBe('pending_approval');
    expect(await balance(itemId)).toBe('0');
    const [request] = await requestFor(adjustment.id);
    expect(request?.status).toBe('IN_PROGRESS');

    // Somebody is deciding on exactly this document: it cannot change under them.
    await expect(
      adjustmentsService.updateAdjustment(orgId, adjustment.id, requesterId, payload(itemId, 50)),
    ).rejects.toThrow(/waiting for approval/);
    await expect(
      adjustmentsService.removeAdjustment(orgId, adjustment.id, requesterId),
    ).rejects.toThrow(/waiting for approval/);
    await expect(
      adjustmentsService.adjustAdjustment(orgId, adjustment.id, requesterId),
    ).rejects.toThrow(/waiting for approval/);
    expect(await balance(itemId)).toBe('0');

    await approvalExecutionService.approveStage(orgId, request!.id, approverId, 'ok');

    expect(await statusOf(adjustment.id)).toBe('adjusted');
    expect(await balance(itemId)).toBe('5');
  });

  it('a draft asks for nothing; only Adjust starts the approval', async () => {
    const itemId = await makeItem();
    const draft = await adjustmentsService.createAdjustment(
      orgId,
      requesterId,
      payload(itemId, 5, 'draft'),
    );
    expect(draft.status).toBe('draft');
    expect(await requestFor(draft.id)).toEqual([]);

    const sent = await adjustmentsService.adjustAdjustment(orgId, draft.id, requesterId);
    expect(sent.status).toBe('pending_approval');
    expect(await requestFor(draft.id)).toHaveLength(1);
  });

  it('rejecting posts nothing; an edit makes it a draft that is approved afresh', async () => {
    const itemId = await makeItem();
    const adjustment = await adjustmentsService.createAdjustment(
      orgId,
      requesterId,
      payload(itemId, 5),
    );
    const [first] = await requestFor(adjustment.id);

    await approvalExecutionService.rejectRequest(orgId, first!.id, approverId, 'recount it');
    expect(await statusOf(adjustment.id)).toBe('rejected');
    expect(await balance(itemId)).toBe('0');

    const edited = await adjustmentsService.updateAdjustment(
      orgId,
      adjustment.id,
      requesterId,
      payload(itemId, 3, 'draft'),
    );
    expect(edited.status).toBe('draft');

    const resent = await adjustmentsService.adjustAdjustment(orgId, adjustment.id, requesterId);
    expect(resent.status).toBe('pending_approval');
    const requests = await requestFor(adjustment.id);
    expect(requests).toHaveLength(2);

    await approvalExecutionService.approveStage(orgId, requests[0]!.id, approverId);
    expect(await statusOf(adjustment.id)).toBe('adjusted');
    expect(await balance(itemId)).toBe('3');
  });

  it('approved but the stock is gone: it rests as approved, and posts later without a second approval', async () => {
    const itemId = await makeItem();
    await move(itemId, 10);
    const adjustment = await adjustmentsService.createAdjustment(
      orgId,
      requesterId,
      payload(itemId, -8),
    );
    const [request] = await requestFor(adjustment.id);

    // While it waited, the stock it wanted went somewhere else.
    await move(itemId, -6);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await approvalExecutionService.approveStage(orgId, request!.id, approverId);
    quiet.mockRestore();

    expect(await statusOf(adjustment.id)).toBe('approved');
    expect(await balance(itemId)).toBe('4');
    await expect(
      adjustmentsService.adjustAdjustment(orgId, adjustment.id, requesterId),
    ).rejects.toThrow(/has 4 at this location/);
    expect(await statusOf(adjustment.id)).toBe('approved');

    await move(itemId, 6);
    const posted = await adjustmentsService.adjustAdjustment(orgId, adjustment.id, requesterId);
    expect(posted.status).toBe('adjusted');
    expect(await balance(itemId)).toBe('2');
    expect(await requestFor(adjustment.id)).toHaveLength(1);
  });

  it('fails closed: if the approval engine errors, nothing posts', async () => {
    const itemId = await makeItem();
    const broken = vi
      .spyOn(approvalExecutionService, 'evaluateAndTriggerApproval')
      .mockRejectedValue(new Error('engine down'));
    try {
      await expect(
        adjustmentsService.createAdjustment(orgId, requesterId, payload(itemId, 5)),
      ).rejects.toThrow('engine down');

      const draft = await adjustmentsService.createAdjustment(
        orgId,
        requesterId,
        payload(itemId, 5, 'draft'),
      );
      await expect(
        adjustmentsService.adjustAdjustment(orgId, draft.id, requesterId),
      ).rejects.toThrow('engine down');
      expect(await statusOf(draft.id)).toBe('draft');
    } finally {
      broken.mockRestore();
    }
    expect(await balance(itemId)).toBe('0');
  });

  it("a process admin's own adjustment needs no approval", async () => {
    const itemId = await makeItem();
    const adjustment = await adjustmentsService.createAdjustment(
      orgId,
      processAdminId,
      payload(itemId, 5),
    );

    expect(adjustment.status).toBe('adjusted');
    expect(await balance(itemId)).toBe('5');
    expect(await requestFor(adjustment.id)).toEqual([]);
  });
});
