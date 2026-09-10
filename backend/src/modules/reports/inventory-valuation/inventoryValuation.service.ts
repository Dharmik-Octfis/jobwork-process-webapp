import { runAsTenant } from '../../../db/prisma.ts';
import type { InventoryValuationQuery, InventoryValuationRow } from './inventoryValuation.schemas.ts';

export async function getInventoryValuationSummary(
  organizationId: string,
  _query: InventoryValuationQuery
): Promise<InventoryValuationRow[]> {
  return runAsTenant(organizationId, async (tx) => {
    // Determine the date filter. The UI passes dd-MM-yyyy or similar? We should probably just use current date if not provided
    // For now we will fetch all ledger entries up to the provided date. If not provided, fetch all.
    
    // Using a raw query to join items and stock_ledger efficiently and calculate sums
    type RawRow = {
      itemId: string;
      itemName: string;
      categoryName: string | null;
      uomName: string | null;
      stockOnHand: string | number | bigint;
      inventoryAssetValue: string | number | bigint;
    };

    const rows = await tx.$queryRaw<RawRow[]>`
      SELECT 
        i.id AS "itemId",
        i.name AS "itemName",
        i.category AS "categoryName",
        u.unit_name AS "uomName",
        COALESCE(SUM(l.qty_in - l.qty_out), 0) AS "stockOnHand",
        COALESCE(SUM(l.value_in - l.value_out), 0) AS "inventoryAssetValue"
      FROM items i
      LEFT JOIN stock_ledger l ON i.id = l.item_id AND l.organization_id = ${organizationId}::uuid AND l.ownership = 'own'
      LEFT JOIN units_of_measurement u ON i.stocking_uom_id = u.id
      WHERE i.organization_id = ${organizationId}::uuid
      AND i.is_deleted = false
      GROUP BY i.id, i.name, i.category, u.unit_name
      ORDER BY i.name ASC
    `;

    return rows.map(row => ({
      itemId: row.itemId,
      itemName: row.itemName,
      categoryName: row.categoryName,
      uomName: row.uomName,
      stockOnHand: Number(row.stockOnHand),
      inventoryAssetValue: Number(row.inventoryAssetValue),
    }));
  });
}
