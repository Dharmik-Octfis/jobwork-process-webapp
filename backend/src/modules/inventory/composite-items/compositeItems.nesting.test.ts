import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import { compositeItemsService } from './compositeItems.service.ts';

/**
 * 🔴 Composites may contain composites (landed-cost plan §6.1, D4) — Shirt is made
 * from Red Cotton, which is made from Cotton — but a recipe may never contain
 * itself, at any depth. Before this, any composite component was refused.
 *
 * Every row is created by this file and hard-deleted afterwards (CLAUDE.md).
 */

const unique = () => process.hrtime.bigint().toString(36);

let orgId: string;
let metreId: string;

async function makeItem(name: string, structure: 'single' | 'composite') {
  return runAsTenant(orgId, async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        name,
        sku: `NEST-${name}-${unique()}`,
        unit: 'Metre',
        stockingUomId: metreId,
        itemStructure: structure,
        itemType: 'goods',
      },
      select: { id: true },
    });
    return item.id;
  });
}

const setRecipe = (compositeId: string, components: [string, number][]) =>
  compositeItemsService.updateItem(compositeId, orgId, {
    components: components.map(([componentItemId, qtyPerUnit]) => ({
      componentItemId,
      qtyPerUnit,
    })),
  });

const recipeOf = async (compositeId: string) =>
  (await compositeItemsService.findMany(compositeId, orgId)).map((row) => row.component_item_id);

beforeAll(async () => {
  orgId = await createTestOrganization('composite-nesting');
  await runAsTenant(orgId, async (tx) => {
    metreId = (
      await tx.unitOfMeasurement.create({
        data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
        select: { id: true },
      })
    ).id;
  });
});

afterAll(async () => {
  if (!orgId) return deleteTestOrganization(orgId);
  await runAsTenant(orgId, async (tx) => {
    await tx.itemActivity.deleteMany({ where: { item: { organizationId: orgId } } });
    await tx.compositeItemComponent.deleteMany({ where: { organizationId: orgId } });
    await tx.item.deleteMany({ where: { organizationId: orgId } });
    await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgId } });
  });
  await deleteTestOrganization(orgId);
});

describe('composite recipes — nesting', { timeout: 60_000 }, () => {
  it('lets a composite contain a composite', async () => {
    const cotton = await makeItem('Cotton', 'single');
    const redCotton = await makeItem('Red Cotton', 'composite');
    const shirt = await makeItem('Shirt', 'composite');

    await setRecipe(redCotton, [[cotton, 1]]);
    await setRecipe(shirt, [[redCotton, 1.5]]);

    expect(await recipeOf(shirt)).toEqual([redCotton]);
  });

  it('refuses a recipe that contains itself directly, and writes nothing', async () => {
    const cotton = await makeItem('Cotton', 'single');
    const redCotton = await makeItem('Red Cotton', 'composite');
    const shirt = await makeItem('Shirt', 'composite');
    await setRecipe(redCotton, [[cotton, 1]]);
    await setRecipe(shirt, [[redCotton, 1.5]]);

    // Red Cotton → Shirt → Red Cotton
    await expect(setRecipe(redCotton, [[shirt, 1]])).rejects.toThrow(/already contains/i);
    expect(await recipeOf(redCotton)).toEqual([cotton]);
  });

  it('refuses a cycle two levels down', async () => {
    const cotton = await makeItem('Cotton', 'single');
    const redCotton = await makeItem('Red Cotton', 'composite');
    const shirt = await makeItem('Shirt', 'composite');
    const jacket = await makeItem('Jacket', 'composite');
    await setRecipe(redCotton, [[cotton, 1]]);
    await setRecipe(shirt, [[redCotton, 1.5]]);
    await setRecipe(jacket, [[shirt, 1]]);

    // Red Cotton → Jacket → Shirt → Red Cotton
    await expect(
      setRecipe(redCotton, [
        [cotton, 1],
        [jacket, 1],
      ]),
    ).rejects.toThrow(/already contains/i);
  });

  it('refuses the cycle through the single-component update endpoint too', async () => {
    const cotton = await makeItem('Cotton', 'single');
    const redCotton = await makeItem('Red Cotton', 'composite');
    const shirt = await makeItem('Shirt', 'composite');
    await setRecipe(redCotton, [[cotton, 1]]);
    await setRecipe(shirt, [[redCotton, 1.5]]);

    const row = await runAsTenant(orgId, (tx) =>
      tx.compositeItemComponent.findFirstOrThrow({
        where: { organizationId: orgId, compositeItemId: redCotton, isDeleted: false },
        select: { id: true },
      }),
    );
    await expect(
      compositeItemsService.update(row.id, redCotton, orgId, { componentItemId: shirt }),
    ).rejects.toThrow(/already contains/i);
  });

  it('adds a single component to a composite, and refuses a cycle through that endpoint', async () => {
    const cotton = await makeItem('Cotton', 'single');
    const redCotton = await makeItem('Red Cotton', 'composite');
    const shirt = await makeItem('Shirt', 'composite');
    await setRecipe(shirt, [[redCotton, 1.5]]);

    // The Components tab's add — it 404'd for every composite until the parent check read itemStructure.
    await compositeItemsService.create(redCotton, orgId, {
      componentItemId: cotton,
      qtyPerUnit: 1,
    });
    expect(await recipeOf(redCotton)).toEqual([cotton]);

    await expect(
      compositeItemsService.create(redCotton, orgId, { componentItemId: shirt, qtyPerUnit: 1 }),
    ).rejects.toThrow(/already contains/i);
  });
});
