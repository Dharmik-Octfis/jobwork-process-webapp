import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import { createPurchaseOrder, updatePurchaseOrder } from './purchase-orders.service.ts';
import type { CreatePurchaseOrderPayload } from './purchase-orders.schemas.ts';

// 🔴 Own fixtures, hard-deleted afterwards — suites run against the dev database
// IN PARALLEL.
const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let userId: string;
let itemId: string;
let vendorId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `po-cf-${unique()}`, orgCode: uniqueOrgCode() },
    select: { id: true },
  });
  orgId = org.id;

  const user = await prisma.user.create({
    data: {
      email: `po-cf-${unique()}@example.test`,
      passwordHash: 'x',
      firstName: 'PO',
      fullName: 'PO Tester',
    },
    select: { id: true },
  });
  userId = user.id;

  await runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: { organizationId: orgId, name: 'Grey Fabric', unit: 'Metre', sku: `PO-CF-${unique()}` },
      select: { id: true },
    });
    itemId = item.id;

    const vendor = await tx.vendor.create({
      data: {
        organizationId: orgId,
        contactName: 'Weaving Mills',
        contactNumber: `VC-${unique()}`,
      },
      select: { id: true },
    });
    vendorId = vendor.id;
  });
});

afterAll(async () => {
  await runAsTenant(orgId, async (tx) => {
    await tx.purchaseOrderActivity.deleteMany({
      where: { purchaseOrder: { organizationId: orgId } },
    });
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { organizationId: orgId } } });
    await tx.purchaseOrder.deleteMany({ where: { organizationId: orgId } });
    await tx.item.deleteMany({ where: { organizationId: orgId } });
    await tx.vendor.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await deleteTestOrganization(orgId);
  await prisma.user.deleteMany({ where: { id: userId } });
});

const customFieldsOf = (id: string) =>
  runAsTenant(orgId, async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id, organizationId: orgId },
      select: { customFields: true },
    });
    return po!.customFields;
  });

describe('purchase order — custom fields on update', () => {
  async function poWithCustomFields() {
    return createPurchaseOrder(orgId, userId, {
      vendorId,
      deliveryType: 'Location',
      poNumber: `PO-${unique()}`,
      date: new Date(),
      subTotal: 10,
      totalAmount: 10,
      status: 'Draft',
      customFields: { projectCode: 'P-7' },
      lineItems: [{ itemId, quantity: 1, rate: 10, itemTotal: 10 }],
    } as CreatePurchaseOrderPayload);
  }

  /** `?? {}` on the write used to wipe them on any PATCH that did not carry them. */
  it('keeps them when the payload does not send any', async () => {
    const po = await poWithCustomFields();

    await updatePurchaseOrder(orgId, po.id, userId, { notes: 'Call before delivery' } as never);

    expect(await customFieldsOf(po.id)).toEqual({ projectCode: 'P-7' });
  });

  it('still replaces them when the payload does send them', async () => {
    const po = await poWithCustomFields();

    await updatePurchaseOrder(orgId, po.id, userId, {
      customFields: { projectCode: 'P-9' },
    } as never);

    expect(await customFieldsOf(po.id)).toEqual({ projectCode: 'P-9' });
  });
});
