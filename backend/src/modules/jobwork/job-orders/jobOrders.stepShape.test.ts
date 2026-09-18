import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { deleteTestOrganization, uniqueOrgCode } from '../../../db/testTenant.ts';
import { createBatch, postMovement } from '../../inventory/stock-ledger/stockLedger.service.ts';
import { SOURCE_DOC_TYPES, runAsDocument } from '../jobwork.types.ts';
import { createNewProcess } from '../processes/processes.service.ts';
import { createNewJobIssue } from '../issues/jobIssues.service.ts';
import { createNewJobOrder, updateJobOrderById } from './jobOrders.service.ts';

/**
 * 🔴 What a job order step may look like, and what it freezes (landed-cost plan
 * §3 V1, V2, V5 and R1b, §5.2, §6.3; §8 tests 10, 11, 16).
 *
 * Every row is created by this file and hard-deleted afterwards (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let metreId: string;
let pieceId: string;
let godownId: string;
let dyerId: string;
let processId: string;

async function makeItem(
  name: string,
  opts: { composite?: boolean; pieces?: boolean; noUnit?: boolean } = {},
) {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name,
        sku: `SHAPE-${name}-${unique()}`,
        unit: opts.pieces ? 'Piece' : 'Metre',
        stockingUomId: opts.noUnit ? null : opts.pieces ? pieceId : metreId,
        itemStructure: opts.composite ? 'composite' : 'single',
        inventoryTracking: 'batch',
        trackInventory: true,
      },
      select: { id: true },
    });
    return item.id;
  });
}

const recipe = (compositeId: string, components: [string, number][]) =>
  runAsTenant(orgId, (tx) =>
    tx.compositeItemComponent.createMany({
      data: components.map(([componentItemId, qtyPerUnit], seq) => ({
        organizationId: orgId,
        compositeItemId: compositeId,
        componentItemId,
        qtyPerUnit,
        seq,
      })),
    }),
  );

async function seedStock(itemId: string, qty: number) {
  return runAsDocument(orgId, async (tx) => {
    const batch = await createBatch(tx, {
      organizationId: orgId,
      itemId,
      ownership: 'own',
      supplierBatchRef: `SEED-${unique()}`,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
    });
    await postMovement(tx, {
      organizationId: orgId,
      batchId: batch.id,
      locationId: godownId,
      movementType: 'receipt',
      qtyIn: qty,
      valueIn: qty * 10,
      sourceDocType: SOURCE_DOC_TYPES.jobOrderMaterialIn,
      sourceDocId: batch.id,
    });
    return batch;
  });
}

type Row = {
  itemId: string;
  plannedQty?: number;
  expectedQty?: number;
  rate?: number;
  sharePct?: number;
};

const step = (inputs: Row[], outputs: Row[]) => ({
  processId,
  processorType: 'vendor' as const,
  processorId: dyerId,
  inputs,
  outputs,
});

const order = (...steps: ReturnType<typeof step>[]) => createNewJobOrder(orgId, { steps });

const outputsOf = (stepId: string) =>
  runAsTenant(orgId, (tx) =>
    tx.jobOrderStepOutput.findMany({
      where: { organizationId: orgId, jobOrderStepId: stepId, isDeleted: false },
      orderBy: { seq: 'asc' },
      select: {
        itemId: true,
        rate: true,
        sharePct: true,
        expectedQty: true,
        components: {
          where: { isDeleted: false },
          orderBy: { seq: 'asc' },
          select: { componentItemId: true, qtyPerUnit: true },
        },
      },
    }),
  );

const refusedAt = (key: string) => ({ status: 400, details: { [key]: expect.any(String) } });

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `step-shape-${unique()}`, orgCode: uniqueOrgCode() },
    select: { id: true },
  });
  orgId = org.id;

  await runAsTenant(orgId, async (tx) => {
    metreId = (
      await tx.unitOfMeasurement.create({
        data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
        select: { id: true },
      })
    ).id;
    pieceId = (
      await tx.unitOfMeasurement.create({
        data: { organizationId: orgId, unitName: 'Piece', symbol: 'PCS' },
        select: { id: true },
      })
    ).id;
    godownId = (
      await tx.location.create({
        data: { organizationId: orgId, name: 'Main Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;
    dyerId = (
      await tx.vendor.create({
        data: {
          organizationId: orgId,
          contactName: 'Sunrise Dyers',
          contactNumber: `VEN-${unique()}`,
          vendorTypes: ['job_worker'],
        },
        select: { id: true },
      })
    ).id;
  });

  processId = (await createNewProcess(orgId, { name: `Dyeing ${unique()}` })).id;
});

afterAll(async () => {
  if (!orgId) return deleteTestOrganization(orgId);
  await runAsTenant(orgId, async (tx) => {
    await tx.jobIssueLine.deleteMany({ where: { organizationId: orgId } });
    await tx.jobIssue.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStepOutputComponent.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStepInput.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStepOutput.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrderStep.deleteMany({ where: { organizationId: orgId } });
    await tx.jobOrder.deleteMany({ where: { organizationId: orgId } });
    await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgId } });
    await tx.batchUnit.deleteMany({ where: { organizationId: orgId } });
    await tx.batch.deleteMany({ where: { organizationId: orgId } });
    await tx.compositeItemComponent.deleteMany({ where: { organizationId: orgId } });
    await tx.process.deleteMany({ where: { organizationId: orgId } });
    await tx.item.deleteMany({ where: { organizationId: orgId } });
    await tx.location.deleteMany({ where: { organizationId: orgId } });
    await tx.vendor.deleteMany({ where: { organizationId: orgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
    await tx.numberSequence.deleteMany({ where: { organizationId: orgId } });
  });
  await deleteTestOrganization(orgId);
});

describe('job order step — rate and recipe snapshot', { timeout: 60_000 }, () => {
  it('stores the agreed rate on each output row', async () => {
    const cotton = await makeItem('Cotton');
    const dyed = await makeItem('Dyed');

    const jo = await order(
      step([{ itemId: cotton, plannedQty: 100 }], [{ itemId: dyed, rate: 12 }]),
    );

    const [out] = await outputsOf(jo.steps[0]!.id);
    expect(out!.rate?.toString()).toBe('12');
  });

  it('freezes a composite output’s recipe against later edits to it', async () => {
    const cotton = await makeItem('Cotton');
    const silk = await makeItem('Silk');
    const mix = await makeItem('Mix', { composite: true });
    await recipe(mix, [
      [cotton, 1],
      [silk, 0.5],
    ]);

    const jo = await order(
      step(
        [
          { itemId: cotton, plannedQty: 100 },
          { itemId: silk, plannedQty: 50 },
        ],
        [{ itemId: mix }],
      ),
    );
    const snapshot = async () =>
      (await outputsOf(jo.steps[0]!.id))[0]!.components.map((c) => [
        c.componentItemId,
        c.qtyPerUnit.toString(),
      ]);

    expect(await snapshot()).toEqual([
      [cotton, '1'],
      [silk, '0.5'],
    ]);

    await runAsTenant(orgId, (tx) =>
      tx.compositeItemComponent.updateMany({
        where: { organizationId: orgId, compositeItemId: mix, componentItemId: cotton },
        data: { qtyPerUnit: 3 },
      }),
    );
    expect(await snapshot()).toEqual([
      [cotton, '1'],
      [silk, '0.5'],
    ]);
  });
});

describe('job order step — shape rules', { timeout: 60_000 }, () => {
  it('V1: refuses a plain output on a step with several input items', async () => {
    const cotton = await makeItem('Cotton');
    const silk = await makeItem('Silk');
    const dyed = await makeItem('Dyed');

    await expect(
      order(step([{ itemId: cotton }, { itemId: silk }], [{ itemId: dyed }])),
    ).rejects.toMatchObject(refusedAt('steps.0.outputs.0.itemId'));
  });

  it('V2: refuses a composite made from an item the step does not consume, or with no recipe', async () => {
    const cotton = await makeItem('Cotton');
    const silk = await makeItem('Silk');
    const shirt = await makeItem('Shirt', { composite: true });
    await recipe(shirt, [
      [cotton, 1],
      [silk, 1],
    ]);
    const empty = await makeItem('Empty', { composite: true });

    await expect(order(step([{ itemId: cotton }], [{ itemId: shirt }]))).rejects.toMatchObject(
      refusedAt('steps.0.outputs.0.itemId'),
    );
    await expect(order(step([{ itemId: cotton }], [{ itemId: empty }]))).rejects.toMatchObject(
      refusedAt('steps.0.outputs.0.itemId'),
    );
  });

  it('R1b: saves one input with outputs in different units, and keeps their shares', async () => {
    const fabric = await makeItem('Fabric');
    const panels = await makeItem('Panels', { pieces: true });
    const offcuts = await makeItem('Offcuts');

    // V3 used to refuse this; a share never adds pieces to metres.
    const jo = await order(
      step(
        [{ itemId: fabric }],
        [
          { itemId: panels, sharePct: 95 },
          { itemId: offcuts, sharePct: 5 },
        ],
      ),
    );
    expect((await outputsOf(jo.steps[0]!.id)).map((o) => o.sharePct?.toString())).toEqual([
      '95',
      '5',
    ]);

    // An item with no stocking unit is no longer a problem either.
    const loose = await makeItem('Loose', { noUnit: true });
    const unitless = await order(
      step(
        [{ itemId: loose }],
        [
          { itemId: panels, sharePct: 95 },
          { itemId: offcuts, sharePct: 5 },
        ],
      ),
    );
    expect(unitless.steps).toHaveLength(1);
  });

  it('R1b: refuses a blank share, and shares that do not make 100%, at save', async () => {
    const fabric = await makeItem('Fabric');
    const roll = await makeItem('Roll');
    const thick = await makeItem('Thick');

    // Blank is not "the first takes it all" — it is a question nobody answered.
    await expect(
      order(step([{ itemId: fabric }], [{ itemId: roll, sharePct: 91 }, { itemId: thick }])),
    ).rejects.toMatchObject(refusedAt('steps.0.outputs.1.sharePct'));

    await expect(
      order(
        step(
          [{ itemId: fabric }],
          [
            { itemId: roll, sharePct: 91 },
            { itemId: thick, sharePct: 5 },
          ],
        ),
      ),
    ).rejects.toMatchObject(refusedAt('steps.0.outputs.0.sharePct'));
  });

  it('R1b: clears a share where the step is not split by share', async () => {
    const fabric = await makeItem('Fabric');
    const dyed = await makeItem('Dyed');

    // One product and the leftover — the leftover comes back 1:1 (R1a), nothing to split.
    const jo = await order(
      step(
        [{ itemId: fabric }],
        [
          { itemId: dyed, sharePct: 60 },
          { itemId: fabric, sharePct: 40 },
        ],
      ),
    );
    expect((await outputsOf(jo.steps[0]!.id)).map((o) => o.sharePct)).toEqual([null, null]);
  });

  it('exempts an output that is itself one of the inputs', async () => {
    const fabric = await makeItem('Fabric');
    const thread = await makeItem('Thread');
    const shirt = await makeItem('Shirt', { composite: true, pieces: true });
    await recipe(shirt, [
      [fabric, 1.5],
      [thread, 0.1],
    ]);

    // Leftover fabric comes back beside the shirts — no recipe, and not a composite.
    const jo = await order(
      step([{ itemId: fabric }, { itemId: thread }], [{ itemId: shirt }, { itemId: fabric }]),
    );
    expect(jo.steps).toHaveLength(1);
  });

  it('R1a: saves any rate on leftover returned beside what is made from it', async () => {
    const fabric = await makeItem('Fabric');
    const thread = await makeItem('Thread');
    const shirt = await makeItem('Shirt', { composite: true, pieces: true });
    await recipe(shirt, [
      [fabric, 1.5],
      [thread, 0.1],
    ]);

    // The rate is the user's call, not a rule — a blank is charged as ₹0.
    const jo = await order(
      step(
        [{ itemId: fabric }, { itemId: thread }],
        [
          { itemId: shirt, rate: 20 },
          { itemId: fabric, rate: 2 },
        ],
      ),
    );
    const [, leftover] = await outputsOf(jo.steps[0]!.id);
    expect(leftover!.rate?.toString()).toBe('2');
  });

  it('V5: refuses an input that nothing the step produces is made from', async () => {
    const fabric = await makeItem('Fabric');
    const thread = await makeItem('Thread');
    const lace = await makeItem('Lace');
    const detergent = await makeItem('Detergent');
    const shirt = await makeItem('Shirt', { composite: true, pieces: true });
    await recipe(shirt, [
      [fabric, 1.5],
      [thread, 0.1],
    ]);

    await expect(
      order(step([{ itemId: fabric }, { itemId: thread }, { itemId: lace }], [{ itemId: shirt }])),
    ).rejects.toMatchObject(refusedAt('steps.0.inputs.2.itemId'));

    // A pass-through draws only itself, so the detergent beside it is drawn by nothing.
    await expect(
      order(step([{ itemId: fabric }, { itemId: detergent }], [{ itemId: fabric }])),
    ).rejects.toMatchObject(refusedAt('steps.0.inputs.1.itemId'));

    // No outputs yet is a draft, not a V5 failure.
    const draft = await order(step([{ itemId: fabric }, { itemId: lace }], []));
    expect(draft.steps).toHaveLength(1);
  });
});

describe('job order step — Expected default', { timeout: 60_000 }, () => {
  it('fills a blank Expected on a single-output step, and not on a step with two', async () => {
    const fabric = await makeItem('Fabric');
    const dyed = await makeItem('Dyed');
    const dyedTwo = await makeItem('Dyed Two');

    const one = await order(step([{ itemId: fabric, plannedQty: 100 }], [{ itemId: dyed }]));
    expect(
      (await outputsOf(one.steps[0]!.id)).map((o) => o.expectedQty?.toString() ?? null),
    ).toEqual(['100']);

    const two = await order(
      step(
        [{ itemId: fabric, plannedQty: 100 }],
        [
          { itemId: dyed, sharePct: 50 },
          { itemId: dyedTwo, sharePct: 50 },
        ],
      ),
    );
    expect(
      (await outputsOf(two.steps[0]!.id)).map((o) => o.expectedQty?.toString() ?? null),
    ).toEqual([null, null]);
  });
});

describe(
  'job order update — the rules apply to the editable tail only',
  { timeout: 60_000 },
  () => {
    it('does not re-check a locked step, and names the tail row by its place in the grid', async () => {
      const fabric = await makeItem('Fabric');
      const thread = await makeItem('Thread');
      const bag = await makeItem('Bag', { composite: true });
      await recipe(bag, [
        [fabric, 1],
        [thread, 1],
      ]);
      const loose = await makeItem('Loose');
      const batch = await seedStock(fabric, 100);

      const jo = await order(
        step(
          [
            { itemId: fabric, plannedQty: 100 },
            { itemId: thread, plannedQty: 10 },
          ],
          [{ itemId: bag }],
        ),
      );
      const first = jo.steps[0]!;
      await createNewJobIssue(orgId, {
        jobOrderStepId: first.id,
        sourceLocationId: godownId,
        lines: [{ itemId: fabric, batchId: batch.id, qty: 50 }],
      });

      // Break the locked step after the fact: its composite loses its recipe, so V2
      // would refuse it if it were checked again.
      await runAsTenant(orgId, (tx) =>
        tx.compositeItemComponent.updateMany({
          where: { organizationId: orgId, compositeItemId: bag },
          data: { isDeleted: true },
        }),
      );
      const locked = {
        id: first.id,
        ...step([{ itemId: fabric }, { itemId: thread }], [{ itemId: bag }]),
      };

      await expect(
        updateJobOrderById(orgId, jo.id, {
          steps: [locked, step([{ itemId: fabric }, { itemId: thread }], [{ itemId: loose }])],
        }),
      ).rejects.toMatchObject(refusedAt('steps.1.outputs.0.itemId'));

      const updated = await updateJobOrderById(orgId, jo.id, {
        steps: [locked, step([{ itemId: fabric }], [{ itemId: loose }])],
      });
      expect(updated.steps).toHaveLength(2);
    });
  },
);
