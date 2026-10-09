import * as XLSX from 'xlsx';
import type { Item } from '../items.schemas';
import type { CustomFieldDefinition } from '../../custom-fields/customFields.schemas';
import { formatCustomFieldValue } from '../../custom-fields/formatCustomFieldValue';
import { formatDate } from '../../../lib/formatDate';
import { itemsApi } from '../items.api';

export interface ExportColumnDef {
  key: string;
  header: string;
  width?: number;
  getValue: (item: Item, customFieldsDef?: CustomFieldDefinition[]) => string | number | null | undefined;
}

/**
 * Standard Item Export Columns
 */
export const STANDARD_ITEM_EXPORT_COLUMNS: ExportColumnDef[] = [
  {
    key: 'name',
    header: 'Item Name',
    width: 30,
    getValue: (item) => item.name,
  },
  {
    key: 'sku',
    header: 'SKU',
    width: 18,
    getValue: (item) => item.sku || '',
  },
  {
    key: 'itemType',
    header: 'Item Type',
    width: 14,
    getValue: (item) => (item.itemType ? item.itemType.charAt(0).toUpperCase() + item.itemType.slice(1) : 'Goods'),
  },
  {
    key: 'itemStructure',
    header: 'Structure',
    width: 14,
    getValue: (item) =>
      item.itemStructure === 'composite'
        ? 'Composite'
        : item.itemStructure === 'variants'
        ? 'Variants'
        : 'Single',
  },
  {
    key: 'category',
    header: 'Category',
    width: 20,
    getValue: (item) => item.category || '',
  },
  {
    key: 'unit',
    header: 'Usage Unit',
    width: 14,
    getValue: (item) => item.unit || '',
  },
  {
    key: 'hsnCode',
    header: 'HSN/SAC Code',
    width: 16,
    getValue: (item) => item.hsnCode || '',
  },
  {
    key: 'sellingPrice',
    header: 'Selling Price',
    width: 16,
    getValue: (item) => (item.sellingPrice !== null && item.sellingPrice !== undefined ? Number(item.sellingPrice) : null),
  },
  {
    key: 'salesDescription',
    header: 'Sales Description',
    width: 30,
    getValue: (item) => item.salesDescription || '',
  },
  {
    key: 'costPrice',
    header: 'Cost Price',
    width: 16,
    getValue: (item) => (item.costPrice !== null && item.costPrice !== undefined ? Number(item.costPrice) : null),
  },
  {
    key: 'purchaseDescription',
    header: 'Purchase Description',
    width: 30,
    getValue: (item) => item.purchaseDescription || '',
  },
  {
    key: 'packaging',
    header: 'Packaging',
    width: 16,
    getValue: (item) => item.packaging || '',
  },
  {
    key: 'trackInventory',
    header: 'Track Inventory',
    width: 16,
    getValue: (item) => (item.trackInventory ? 'Yes' : 'No'),
  },
  {
    key: 'inventoryTracking',
    header: 'Inventory Tracking',
    width: 18,
    getValue: (item) => (item.inventoryTracking === 'batch' ? 'Track Batches' : 'None'),
  },
  {
    key: 'openingStock',
    header: 'Opening Stock',
    width: 16,
    getValue: (item) => (item.openingStock !== null && item.openingStock !== undefined ? Number(item.openingStock) : null),
  },
  {
    key: 'openingStockValuePerUnit',
    header: 'Opening Stock Value/Unit',
    width: 22,
    getValue: (item) =>
      item.openingStockValuePerUnit !== null && item.openingStockValuePerUnit !== undefined
        ? Number(item.openingStockValuePerUnit)
        : null,
  },
  {
    key: 'status',
    header: 'Status',
    width: 12,
    getValue: (item) => (item.isActive === false ? 'Inactive' : 'Active'),
  },
  {
    key: 'createdAt',
    header: 'Created At',
    width: 18,
    getValue: (item) => (item.createdAt ? formatDate(item.createdAt) : ''),
  },
  {
    key: 'updatedAt',
    header: 'Updated At',
    width: 18,
    getValue: (item) => (item.updatedAt ? formatDate(item.updatedAt) : ''),
  },
];

/**
 * Build dynamic columns from custom fields
 */
export function buildCustomFieldColumns(customFieldsDef?: CustomFieldDefinition[]): ExportColumnDef[] {
  if (!customFieldsDef || customFieldsDef.length === 0) return [];
  return customFieldsDef.map((def) => ({
    key: `cf_${def.key}`,
    header: def.label,
    width: Math.max(16, def.label.length + 4),
    getValue: (item) => {
      const val = item.customFields?.[def.key];
      return formatCustomFieldValue(val, def);
    },
  }));
}

export interface ExportItemsOptions {
  items: Item[];
  filename?: string;
  customFieldsDef?: CustomFieldDefinition[];
  visibleColumnKeys?: string[];
  exportAllFields?: boolean;
  format?: 'xlsx' | 'csv';
}

/**
 * Generates and downloads an XLSX (or CSV) file with the given items data.
 */
export function exportItemsToExcel({
  items,
  filename,
  customFieldsDef,
  visibleColumnKeys,
  exportAllFields = true,
  format = 'xlsx',
}: ExportItemsOptions): void {
  const customCols = buildCustomFieldColumns(customFieldsDef);
  const allColumns = [...STANDARD_ITEM_EXPORT_COLUMNS, ...customCols];

  // Determine active columns
  let selectedCols: ExportColumnDef[];
  if (exportAllFields || !visibleColumnKeys || visibleColumnKeys.length === 0) {
    selectedCols = allColumns;
  } else {
    // Match by column key
    selectedCols = allColumns.filter((col) => {
      if (visibleColumnKeys.includes(col.key)) return true;
      if (col.key.startsWith('cf_')) {
        const cfKey = col.key.slice(3);
        return visibleColumnKeys.includes(`cf:${cfKey}`) || visibleColumnKeys.includes(`cf_${cfKey}`);
      }
      if (col.key === 'itemType' && visibleColumnKeys.includes('type')) return true;
      return false;
    });

    if (selectedCols.length === 0) {
      selectedCols = allColumns;
    }
  }

  // Header row
  const headers = selectedCols.map((c) => c.header);

  // Data rows
  const rows = items.map((item) =>
    selectedCols.map((col) => {
      const val = col.getValue(item, customFieldsDef);
      return val === null || val === undefined ? '' : val;
    }),
  );

  // Build Sheet
  const worksheetData = [headers, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  // Auto column widths
  const colWidths = selectedCols.map((col, idx) => {
    let maxLen = col.header.length;
    for (const row of rows) {
      const cellVal = row[idx];
      if (cellVal !== undefined && cellVal !== null) {
        const strLen = String(cellVal).length;
        if (strLen > maxLen) maxLen = strLen;
      }
    }
    return { wch: Math.min(Math.max(maxLen + 3, col.width || 12), 60) };
  });
  worksheet['!cols'] = colWidths;

  // Build Workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Items');

  // Generate Filename
  const dateStr = new Date().toISOString().split('T')[0];
  const defaultBaseName = `Items_${dateStr}`;
  const finalFilename = filename ? (filename.endsWith(`.${format}`) ? filename : `${filename}.${format}`) : `${defaultBaseName}.${format}`;

  if (format === 'csv') {
    XLSX.writeFile(workbook, finalFilename, { bookType: 'csv' });
  } else {
    XLSX.writeFile(workbook, finalFilename, { bookType: 'xlsx' });
  }
}

/**
 * Fetch all items across multiple pages if necessary
 */
export async function fetchAllItemsForExport(
  orgId: string,
  params: { search?: string; filter?: string; fieldFilters?: string } = {},
  onProgress?: (loaded: number) => void,
): Promise<Item[]> {
  const allItems: Item[] = [];
  let currentPage = 1;
  const perPage = 500;
  let hasMore = true;

  while (hasMore) {
    const response = await itemsApi.getItems(orgId, {
      ...params,
      page: currentPage,
      perPage,
    });

    const pageResults = response.results ?? [];
    allItems.push(...pageResults);

    if (onProgress) {
      onProgress(allItems.length);
    }

    if (response.pageContext?.hasMore && pageResults.length > 0) {
      currentPage++;
    } else {
      hasMore = false;
    }
  }

  return allItems;
}
