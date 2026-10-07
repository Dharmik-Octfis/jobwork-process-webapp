import * as XLSX from 'xlsx';
import type { ItemAssembly } from '../assemblies.api';
import { assembliesApi } from '../assemblies.api';
import type { CustomFieldDefinition } from '../../../custom-fields/customFields.schemas';
import { formatCustomFieldValue } from '../../../custom-fields/formatCustomFieldValue';
import { formatDate } from '../../../../lib/formatDate';

export interface ExportAssemblyColumnDef {
  key: string;
  header: string;
  width?: number;
  getValue: (assembly: ItemAssembly, customFieldsDef?: CustomFieldDefinition[]) => string | number | null | undefined;
}

export const STANDARD_ASSEMBLY_EXPORT_COLUMNS: ExportAssemblyColumnDef[] = [
  {
    key: 'assemblyNumber',
    header: 'Assembly Number',
    width: 20,
    getValue: (a) => a.assemblyNumber,
  },
  {
    key: 'assemblyDate',
    header: 'Assembly Date',
    width: 16,
    getValue: (a) => (a.assemblyDate ? formatDate(a.assemblyDate) : ''),
  },
  {
    key: 'compositeItem',
    header: 'Composite Item',
    width: 25,
    getValue: (a) => a.compositeItem?.name || a.compositeItemId,
  },
  {
    key: 'sku',
    header: 'SKU',
    width: 16,
    getValue: (a) => a.compositeItem?.sku || '',
  },
  {
    key: 'qty',
    header: 'Quantity',
    width: 14,
    getValue: (a) => a.qty,
  },
  {
    key: 'totalValue',
    header: 'Total Value (INR)',
    width: 18,
    getValue: (a) => a.totalValue,
  },
  {
    key: 'componentValue',
    header: 'Component Value (INR)',
    width: 22,
    getValue: (a) => a.componentValue,
  },
  {
    key: 'additionalCost',
    header: 'Additional Cost (INR)',
    width: 20,
    getValue: (a) => a.additionalCost,
  },
  {
    key: 'status',
    header: 'Status',
    width: 14,
    getValue: (a) => a.status ? a.status.charAt(0).toUpperCase() + a.status.slice(1) : '',
  },
  {
    key: 'direction',
    header: 'Direction',
    width: 14,
    getValue: (a) => a.direction ? a.direction.charAt(0).toUpperCase() + a.direction.slice(1) : '',
  },
  {
    key: 'createdAt',
    header: 'Created At',
    width: 18,
    getValue: (a) => (a.createdAt ? formatDate(a.createdAt) : ''),
  },
];

export function buildCustomFieldColumns(customFieldsDef?: CustomFieldDefinition[]): ExportAssemblyColumnDef[] {
  if (!customFieldsDef || customFieldsDef.length === 0) return [];
  return customFieldsDef.map((def) => ({
    key: `cf_${def.key}`,
    header: def.label,
    width: Math.max(16, def.label.length + 4),
    getValue: (a) => {
      const val = a.customFields?.[def.key];
      return formatCustomFieldValue(val, def);
    },
  }));
}

export interface ExportAssembliesOptions {
  assemblies: ItemAssembly[];
  filename?: string;
  customFieldsDef?: CustomFieldDefinition[];
  visibleColumnKeys?: string[];
  exportAllFields?: boolean;
  format?: 'xlsx' | 'csv';
}

export function exportAssembliesToExcel({
  assemblies,
  filename,
  customFieldsDef,
  visibleColumnKeys,
  exportAllFields = true,
  format = 'xlsx',
}: ExportAssembliesOptions): void {
  const customCols = buildCustomFieldColumns(customFieldsDef);
  const allColumns = [...STANDARD_ASSEMBLY_EXPORT_COLUMNS, ...customCols];

  let selectedCols: ExportAssemblyColumnDef[];
  if (exportAllFields || !visibleColumnKeys || visibleColumnKeys.length === 0) {
    selectedCols = allColumns;
  } else {
    selectedCols = allColumns.filter((col) => {
      if (visibleColumnKeys.includes(col.key)) return true;
      if (col.key.startsWith('cf_')) {
        const cfKey = col.key.slice(3);
        return visibleColumnKeys.includes(`cf:${cfKey}`) || visibleColumnKeys.includes(`cf_${cfKey}`);
      }
      return false;
    });

    if (selectedCols.length === 0) {
      selectedCols = allColumns;
    }
  }

  const headers = selectedCols.map((c) => c.header);
  const rows = assemblies.map((item) =>
    selectedCols.map((col) => {
      const val = col.getValue(item, customFieldsDef);
      return val === null || val === undefined ? '' : val;
    }),
  );

  const worksheetData = [headers, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

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

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Assemblies');

  const dateStr = new Date().toISOString().split('T')[0];
  const defaultBaseName = `Assemblies_${dateStr}`;
  const finalFilename = filename
    ? filename.endsWith(`.${format}`)
      ? filename
      : `${filename}.${format}`
    : `${defaultBaseName}.${format}`;

  if (format === 'csv') {
    XLSX.writeFile(workbook, finalFilename, { bookType: 'csv' });
  } else {
    XLSX.writeFile(workbook, finalFilename, { bookType: 'xlsx' });
  }
}

export async function fetchAllAssembliesForExport(
  orgId: string,
  params: { search?: string; filter?: string } = {},
  onProgress?: (loaded: number) => void,
): Promise<ItemAssembly[]> {
  const allAssemblies: ItemAssembly[] = [];
  let currentPage = 1;
  const perPage = 500;
  let hasMore = true;

  while (hasMore) {
    const response = await assembliesApi.getAssemblies(orgId, {
      ...params,
      page: currentPage,
      perPage,
    });

    const pageResults = response.results ?? [];
    allAssemblies.push(...pageResults);

    if (onProgress) {
      onProgress(allAssemblies.length);
    }

    if (response.pageContext?.hasMore && pageResults.length > 0) {
      currentPage++;
    } else {
      hasMore = false;
    }
  }

  return allAssemblies;
}
