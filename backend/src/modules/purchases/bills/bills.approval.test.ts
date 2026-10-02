import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import { getBalance } from '../../inventory/stock-ledger/stockLedger.service.ts';
import { checkLayerInvariant } from '../../inventory/stock-ledger/costLayers.ts';
import { approvalProcessService } from '../../automation/approval-processes/approvalProcess.service.ts';
import { approvalExecutionService } from '../../automation/approval-processes/approvalExecution.service.ts';
import { ensureApprovalTables } from '../../automation/approval-processes/approvalTables.migration.ts';
import { createBill, deleteBill, getBillById, updateBill } from './bills.service.ts';
import type { CreateBillPayload, UpdateBillPayload } from './bills.schemas.ts';

/**
 * 🔴 BILL APPROVAL IS A GATE (docs/BILL_APPROVAL_GATE_PLAN.md §9).
 *
 * One process for bills, CREATE_ONLY, with one rule: total above ₹1,000. So a
 * bill at or under that is one no process applies to, and a bill over it waits
 * for the approver. Own organization, users and process, hard-deleted afterwards.
 */

const unique = () => process.hrtime.bigint().toString(36);
const THRESHOLD = 1000;

let orgId: string;
let requesterId: string;
let approverId: string;
let processAdminId: string;
let metreId: string;
let vendorId: string;
let godownId: string;
let otherGodownId: string;
const userIds: string[] = [];

async function makeMember(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `bill-appr-${label}-${unique()}@example.test`,
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

async function makeItem(inventoryTracking: 'none' | 'batch' = 'none') {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name: `Bill appr ${unique()}`,
        sku: `BILLA-${unique()}`,
        unit: 'Metre',
        stockingUomId: metreId,
        itemType: 'goods',
        trackInventory: true,
        inventoryTracking,
      },
      select: { id: true },
    });
    return item.id;
  });
}

function line(itemId: string, quantity: number, rate: number, batchRef?: string) {
  return {
    itemId,
    quantity,
    rate,
    amount: quantity * rate,
    ...(batchRef ? { batches: [{ supplierBatchRef: batchRef, quantity }] } : {}),
  };
}

function payload(
  lines: ReturnType<typeof line>[],
  status: 'Draft' | 'Open',
  extra: Partial<CreateBillPayload> = {},
): CreateBillPayload {
  const total = lines.reduce((sum, row) => sum + row.amount, 0);
  return {
    vendorId,
    locationId: godownId,
    sourcePoId: null,
    billNumber: `BILL-${unique()}`,
    billDate: new Date(),
    dueDate: null,
    subTotal: total,
    totalAmount: total,
    status,
    lineItems: lines,
    ...extra,
  } as CreateBillPayload;
}

/** The fields an edit form sends back, with the lines as they were read. */
function edit(
  lines: NonNullable<UpdateBillPayload['lineItems']>,
  status: 'Draft' | 'Open',
  extra: Partial<UpdateBillPayload> = {},
): UpdateBillPayload {
  const total = lines.reduce((sum, row) => sum + row.amount, 0);
  return {
    vendorId,
    locationId: godownId,
    subTotal: total,
    totalAmount: total,
    status,
    lineItems: lines,
    ...extra,
  } as UpdateBillPayload;
}

const balance = async (itemId: string, locationId = godownId) =>
  (
    await runAsTenant(orgId, (tx) =>
      getBalance(tx, { organizationId: orgId, itemId, locationId, ownership: 'own' }),
    )
  ).qty.toString();

const ledgerRows = (billId: string) =>
  runAsTenant(orgId, (tx) =>
    tx.stockLedgerEntry.count({
      where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: billId },
    }),
  );

const requestsFor = (billId: string) =>
  runAsTenant(
    orgId,
    (tx) =>
      tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT "id", "status" FROM "approval_requests"
      WHERE "organization_id" = ${orgId}::uuid AND "record_id" = ${billId}
      ORDER BY "submitted_at" DESC`,
  );

const state = async (billId: string) => {
  const bill = await getBillById(orgId, billId);
  return { status: bill?.status, approvalStatus: bill?.approvalStatus ?? null };
};

/** Raise an over-threshold bill to pending and return it with its request. */
async function pendingBill(itemId: string, quantity = 200) {
  const bill = await createBill(orgId, requesterId, payload([line(itemId, quantity, 10)], 'Open'));
  const [request] = await requestsFor(bill.id);
  return { bill, request: request! };
}

/** An over-threshold bill, approved and so Open with its stock posted. */
async function approvedOpenBill(itemId: string, quantity = 200) {
  const { bill, request } = await pendingBill(itemId, quantity);
  await approvalExecutionService.approveStage(orgId, request.id, approverId, 'ok');
  expect(await state(bill.id)).toEqual({ status: 'Open', approvalStatus: 'approved' });
  return bill;
}

beforeAll(async () => {
  await ensureApprovalTables();
  orgId = await createTestOrganization('bill-approval');
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
    vendorId = (
      await tx.vendor.create({
        data: {
          organizationId: orgId,
          contactName: 'Weaving Mills',
          contactNumber: `VC-${unique()}`,
        },
        select: { id: true },
      })
    ).id;
    godownId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;
    otherGodownId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Second Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;
  });

  const definition = {
    name: `Bills ${unique()}`,
    moduleId: 'bills',
    // CREATE_ONLY on purpose: G10 must still hold an Open bill to it (§4).
    triggerType: 'CREATE_ONLY' as const,
  };
  const created = await approvalProcessService.createProcess(orgId, definition, requesterId);
  await approvalProcessService.updateProcess(
    orgId,
    created.id,
    {
      ...definition,
      rules: [
        {
          name: 'Large bills',
          ruleOrder: 1,
          criteria: [{ id: 1, fieldId: 'totalAmount', operator: 'greater_than', value: THRESHOLD }],
          criteriaPattern: '1',
          stages: [
            {
              name: 'Purchase head',
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

afterEach(async () => {
  if (!orgId) return;
  expect(await runAsTenant(orgId, (tx) => checkLayerInvariant(tx, orgId))).toEqual([]);
  // G1: whatever happened, a bill's status is only ever Draft or Open.
  const statuses = await runAsTenant(orgId, (tx) =>
    tx.bill.findMany({
      where: { organizationId: orgId },
      select: { status: true },
      distinct: ['status'],
    }),
  );
  for (const { status } of statuses) expect(['Draft', 'Open']).toContain(status);
});

afterAll(async () => {
  if (orgId) {
    await runAsTenant(orgId, async (tx) => {
      await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
      await tx.billItemBatch.deleteMany({ where: { organizationId: orgId } });
      await tx.batchUnit.deleteMany({ where: { organizationId: orgId } });
      await tx.batch.deleteMany({ where: { organizationId: orgId } });
      await tx.billActivity.deleteMany({ where: { bill: { organizationId: orgId } } });
      await tx.billItem.deleteMany({ where: { bill: { organizationId: orgId } } });
      await tx.bill.deleteMany({ where: { organizationId: orgId } });
      await tx.item.deleteMany({ where: { organizationId: orgId } });
      await tx.vendor.deleteMany({ where: { organizationId: orgId } });
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

describe('bill approval — the gate', { timeout: 90_000 }, () => {
  it('1. no process applies: an Open bill posts on save, as today', async () => {
    const itemId = await makeItem();
    const bill = await createBill(orgId, requesterId, payload([line(itemId, 5, 10)], 'Open'));

    expect(await state(bill.id)).toEqual({ status: 'Open', approvalStatus: null });
    expect(await balance(itemId)).toBe('5');
    expect(await requestsFor(bill.id)).toEqual([]);
  });

  it('2. Save as Open waits as Draft + pending and posts nothing; approving opens it', async () => {
    const itemId = await makeItem();
    const { bill, request } = await pendingBill(itemId);

    expect(await state(bill.id)).toEqual({ status: 'Draft', approvalStatus: 'pending' });
    expect(await ledgerRows(bill.id)).toBe(0);
    expect(request.status).toBe('IN_PROGRESS');

    await approvalExecutionService.approveStage(orgId, request.id, approverId, 'ok');

    expect(await state(bill.id)).toEqual({ status: 'Open', approvalStatus: 'approved' });
    expect(await balance(itemId)).toBe('200');
  });

  it('2b. a batch-tracked bill opened by approval posts the batches it was saved with', async () => {
    const itemId = await makeItem('batch');
    const bill = await createBill(
      orgId,
      requesterId,
      payload([line(itemId, 150, 10, `LOT-${unique()}`)], 'Open'),
    );
    expect(await ledgerRows(bill.id)).toBe(0);
    const [request] = await requestsFor(bill.id);

    await approvalExecutionService.approveStage(orgId, request!.id, approverId);

    expect(await state(bill.id)).toEqual({ status: 'Open', approvalStatus: 'approved' });
    expect(await balance(itemId)).toBe('150');
    const detail = await getBillById(orgId, bill.id);
    expect(detail?.lineItems[0]?.batches).toHaveLength(1);
  });

  it('3. a rejection posts nothing; editing clears it, and opening asks again', async () => {
    const itemId = await makeItem();
    const { bill, request } = await pendingBill(itemId);

    await approvalExecutionService.rejectRequest(orgId, request.id, approverId, 'wrong rate');
    expect(await state(bill.id)).toEqual({ status: 'Draft', approvalStatus: 'rejected' });
    expect(await ledgerRows(bill.id)).toBe(0);

    await updateBill(orgId, bill.id, requesterId, edit([line(itemId, 150, 10)], 'Draft'));
    expect(await state(bill.id)).toEqual({ status: 'Draft', approvalStatus: null });

    await updateBill(orgId, bill.id, requesterId, { status: 'Open' });
    expect(await state(bill.id)).toEqual({ status: 'Draft', approvalStatus: 'pending' });
    expect(await requestsFor(bill.id)).toHaveLength(2);
    expect(await ledgerRows(bill.id)).toBe(0);
  });

  it('4. saving a draft raises no request', async () => {
    const itemId = await makeItem();
    const bill = await createBill(orgId, requesterId, payload([line(itemId, 200, 10)], 'Draft'));
    await updateBill(orgId, bill.id, requesterId, edit([line(itemId, 300, 10)], 'Draft'));

    expect(await state(bill.id)).toEqual({ status: 'Draft', approvalStatus: null });
    expect(await requestsFor(bill.id)).toEqual([]);
  });

  it('5. a pending bill cannot be edited or deleted; a withdrawn request frees it', async () => {
    const itemId = await makeItem();
    const { bill, request } = await pendingBill(itemId);

    await expect(
      updateBill(orgId, bill.id, requesterId, edit([line(itemId, 500, 10)], 'Draft')),
    ).rejects.toThrow(/waiting for approval/);
    await expect(
      updateBill(orgId, bill.id, requesterId, { notes: 'x' } as UpdateBillPayload),
    ).rejects.toThrow(/waiting for approval/);
    await expect(deleteBill(orgId, bill.id, requesterId)).rejects.toThrow(/waiting for approval/);

    await approvalExecutionService.cancelRequest(orgId, request.id, requesterId);

    await updateBill(orgId, bill.id, requesterId, edit([line(itemId, 300, 10)], 'Draft'));
    expect(await state(bill.id)).toEqual({ status: 'Draft', approvalStatus: null });
    await deleteBill(orgId, bill.id, requesterId);
    expect(await getBillById(orgId, bill.id)).toBeNull();
  });

  it('6. fails closed: if the engine errors, nothing posts and no stray draft is left', async () => {
    const itemId = await makeItem();
    const broken = vi
      .spyOn(approvalExecutionService, 'evaluateAndTriggerApproval')
      .mockRejectedValue(new Error('engine down'));
    const billNumber = `BILL-${unique()}`;
    let draftId: string;
    try {
      await expect(
        createBill(orgId, requesterId, payload([line(itemId, 200, 10)], 'Open', { billNumber })),
      ).rejects.toThrow('engine down');

      const draft = await createBill(orgId, requesterId, payload([line(itemId, 200, 10)], 'Draft'));
      draftId = draft.id;
      await expect(updateBill(orgId, draft.id, requesterId, { status: 'Open' })).rejects.toThrow(
        'engine down',
      );
    } finally {
      broken.mockRestore();
    }
    expect(await state(draftId!)).toEqual({ status: 'Draft', approvalStatus: null });
    expect(await balance(itemId)).toBe('0');
    const stray = await runAsTenant(orgId, (tx) =>
      tx.bill.count({ where: { organizationId: orgId, billNumber, isDeleted: false } }),
    );
    expect(stray).toBe(0);
  });

  it("7. a process admin's own bill opens with no request", async () => {
    const itemId = await makeItem();
    const bill = await createBill(orgId, processAdminId, payload([line(itemId, 200, 10)], 'Open'));

    expect((await state(bill.id)).status).toBe('Open');
    expect(await balance(itemId)).toBe('200');
    expect(await requestsFor(bill.id)).toEqual([]);
  });

  it('8. approved but could not post: it rests as Draft + approved, and opens later with no second request', async () => {
    const itemId = await makeItem();
    const { bill, request } = await pendingBill(itemId);

    // While it waited, the bill lost the location it would receive into.
    await runAsTenant(orgId, (tx) =>
      tx.bill.updateMany({ where: { id: bill.id }, data: { locationId: null } }),
    );
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await approvalExecutionService.approveStage(orgId, request.id, approverId);
    quiet.mockRestore();

    expect(await state(bill.id)).toEqual({ status: 'Draft', approvalStatus: 'approved' });
    expect(await ledgerRows(bill.id)).toBe(0);

    await runAsTenant(orgId, (tx) =>
      tx.bill.updateMany({ where: { id: bill.id }, data: { locationId: godownId } }),
    );
    await updateBill(orgId, bill.id, requesterId, { status: 'Open' });

    expect(await state(bill.id)).toEqual({ status: 'Open', approvalStatus: 'approved' });
    expect(await balance(itemId)).toBe('200');
    expect(await requestsFor(bill.id)).toHaveLength(1);
  });

  it('10. an approved, Open bill keeps the existing guards: no going back to Draft, delete un-posts', async () => {
    const itemId = await makeItem();
    const bill = await createBill(orgId, requesterId, payload([line(itemId, 200, 10)], 'Open'));
    // Polled, not read once: before the gate the request was raised fire-and-forget.
    let request: { id: string } | undefined;
    for (let tries = 0; !request && tries < 50; tries++) {
      [request] = await requestsFor(bill.id);
      if (!request) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await approvalExecutionService.approveStage(orgId, request!.id, approverId, 'ok');
    expect(await balance(itemId)).toBe('200');

    // §1 #4 and #5: Save as Draft must be refused, and must not take the stock off.
    await expect(
      updateBill(orgId, bill.id, requesterId, edit([line(itemId, 200, 10)], 'Draft')),
    ).rejects.toThrow(/cannot be moved back to Draft/);
    expect(await state(bill.id)).toEqual({ status: 'Open', approvalStatus: 'approved' });
    expect(await balance(itemId)).toBe('200');

    await deleteBill(orgId, bill.id, processAdminId);
    expect(await balance(itemId)).toBe('0');
  });
});

describe('bill approval — editing an Open bill (G10, option B)', { timeout: 90_000 }, () => {
  it('11. a non-admin cannot change the stock of a covered Open bill; notes still save', async () => {
    const itemId = await makeItem();
    const bill = await approvedOpenBill(itemId);
    const same = [line(itemId, 200, 10)];

    const refusals: UpdateBillPayload[] = [
      edit([line(itemId, 250, 10)], 'Open'),
      edit([line(itemId, 200, 12)], 'Open'),
      edit(same, 'Open', { locationId: otherGodownId }),
      edit(same, 'Open', { billDate: new Date(Date.now() - 86_400_000) }),
    ];
    for (const change of refusals) {
      await expect(updateBill(orgId, bill.id, requesterId, change)).rejects.toThrow(
        /Ask a process admin/,
      );
    }
    expect(await balance(itemId)).toBe('200');
    expect(await balance(itemId, otherGodownId)).toBe('0');

    await updateBill(orgId, bill.id, requesterId, edit(same, 'Open', { paymentTerms: 'Net 45' }));
    const saved = await getBillById(orgId, bill.id);
    expect(saved?.paymentTerms).toBe('Net 45');
    expect(await balance(itemId)).toBe('200');
  });

  it('11b. re-saving a batch-tracked Open bill as it was read moves nothing', async () => {
    const itemId = await makeItem('batch');
    const created = await createBill(
      orgId,
      processAdminId,
      payload([line(itemId, 200, 10, `LOT-${unique()}`)], 'Open'),
    );
    const read = await getBillById(orgId, created.id);
    const lines = read!.lineItems.map((row) => ({
      itemId: row.itemId,
      quantity: Number(row.quantity),
      rate: Number(row.rate),
      amount: Number(row.itemTotal),
      batches: row.batches?.map((b) => ({ batchId: b.batchId, quantity: b.quantity })),
    }));

    await updateBill(
      orgId,
      created.id,
      requesterId,
      edit(lines, 'Open', { paymentTerms: 'Net 30' }),
    );
    expect(await balance(itemId)).toBe('200');
  });

  it('12. a process admin may change it: the edit reconciles and raises no request', async () => {
    const itemId = await makeItem();
    const bill = await approvedOpenBill(itemId);

    await updateBill(orgId, bill.id, processAdminId, edit([line(itemId, 260, 10)], 'Open'));
    expect(await balance(itemId)).toBe('260');
    expect(await requestsFor(bill.id)).toHaveLength(1);
    expect(await state(bill.id)).toEqual({ status: 'Open', approvalStatus: 'approved' });
  });

  it('13/14. G10 follows the criteria: a bill under the threshold edits freely until an edit takes it over', async () => {
    const itemId = await makeItem();
    const bill = await createBill(orgId, requesterId, payload([line(itemId, 50, 10)], 'Open'));
    expect(await balance(itemId)).toBe('50');

    await updateBill(orgId, bill.id, requesterId, edit([line(itemId, 90, 10)], 'Open'));
    expect(await balance(itemId)).toBe('90');

    await expect(
      updateBill(orgId, bill.id, requesterId, edit([line(itemId, 150, 10)], 'Open')),
    ).rejects.toThrow(/Ask a process admin/);
    expect(await balance(itemId)).toBe('90');
  });

  it('15. deleting a covered Open bill needs a process admin', async () => {
    const itemId = await makeItem();
    const bill = await approvedOpenBill(itemId);

    await expect(deleteBill(orgId, bill.id, requesterId)).rejects.toThrow(/Ask a process admin/);
    expect(await balance(itemId)).toBe('200');

    await deleteBill(orgId, bill.id, processAdminId);
    expect(await balance(itemId)).toBe('0');

    // Under the threshold, anybody with the permission may delete it.
    const small = await createBill(orgId, requesterId, payload([line(itemId, 20, 10)], 'Open'));
    await deleteBill(orgId, small.id, requesterId);
    expect(await balance(itemId)).toBe('0');
  });
});
