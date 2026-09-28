import { useState, useRef } from 'react';
import { X, Upload, Download, CheckCircle, FileSpreadsheet, Loader2 } from 'lucide-react';
import { itemsApi } from '../items.api';
import type { ItemFormData } from '../items.schemas';

interface ImportItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  onSuccess: () => void;
}

interface ParsedItemRow {
  rowNumber: number;
  name: string;
  sku: string;
  itemType: 'goods' | 'service';
  unit: string;
  sellingPrice: number;
  costPrice: number;
  hsnCode?: string;
  salesDescription?: string;
  purchaseDescription?: string;
  errors: string[];
}

export function ImportItemsModal({ isOpen, onClose, orgId, onSuccess }: ImportItemsModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedItemRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    success: number;
    failed: number;
  } | null>(null);
  const [importSummary, setImportSummary] = useState<{ success: number; failed: number } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDownloadSample = () => {
    const csvContent =
      'Item Name,SKU,Type,Unit,Selling Price,Cost Price,HSN/SAC,Sales Description,Purchase Description\n' +
      '"CNC Machined Flange 4-Inch","FLG-4IN-150","goods","pcs",1450.00,850.00,"730721","Standard 4-inch ANSI 150# flange","Raw forging procurement"\n' +
      '"Precision Milling Jobwork","SRV-MILL-01","service","hrs",650.00,350.00,"998898","Hourly milling CNC service",""\n' +
      '"Industrial Fastener Bolt M12","BLT-M12-50","goods","pcs",45.00,22.50,"731815","High tensile grade 8.8 M12 bolt","Grade 8.8 stock"';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_items_import.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const parseCsvText = (text: string) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    // Simple robust CSV line splitter accounting for quotes
    const splitCsvLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

    // Find column indexes
    const nameIdx = header.findIndex((h) => h.includes('itemname') || h === 'name');
    const skuIdx = header.findIndex((h) => h.includes('sku') || h.includes('itemcode'));
    const typeIdx = header.findIndex((h) => h.includes('type'));
    const unitIdx = header.findIndex((h) => h.includes('unit') || h.includes('uom'));
    const sellPriceIdx = header.findIndex(
      (h) => h.includes('selling') || h.includes('salesprice') || h === 'rate',
    );
    const costPriceIdx = header.findIndex((h) => h.includes('cost') || h.includes('purchaserate'));
    const hsnIdx = header.findIndex((h) => h.includes('hsn') || h.includes('sac'));
    const salesDescIdx = header.findIndex((h) => h.includes('salesdesc'));
    const purchDescIdx = header.findIndex((h) => h.includes('purchasedesc'));

    const rows: ParsedItemRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      if (cols.length === 0 || cols.every((c) => !c)) continue;

      const name = nameIdx !== -1 ? cols[nameIdx] || '' : cols[0] || '';
      const sku = skuIdx !== -1 ? cols[skuIdx] || '' : cols[1] || '';
      const rawType = typeIdx !== -1 ? (cols[typeIdx] || '').toLowerCase() : 'goods';
      const itemType: 'goods' | 'service' = rawType.includes('serv') ? 'service' : 'goods';
      const unit = unitIdx !== -1 ? cols[unitIdx] || 'pcs' : 'pcs';
      const sellPrice = Number(sellPriceIdx !== -1 ? cols[sellPriceIdx] : 0) || 0;
      const costPrice = Number(costPriceIdx !== -1 ? cols[costPriceIdx] : 0) || 0;
      const hsnCode = hsnIdx !== -1 ? cols[hsnIdx] : undefined;
      const salesDescription = salesDescIdx !== -1 ? cols[salesDescIdx] : undefined;
      const purchaseDescription = purchDescIdx !== -1 ? cols[purchDescIdx] : undefined;

      const errors: string[] = [];
      if (!name) errors.push('Item name is required');
      if (sellPrice < 0) errors.push('Selling price cannot be negative');

      rows.push({
        rowNumber: i,
        name,
        sku,
        itemType,
        unit,
        sellingPrice: sellPrice,
        costPrice,
        hsnCode,
        salesDescription,
        purchaseDescription,
        errors,
      });
    }

    return rows;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    setImportSummary(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        const rows = parseCsvText(text);
        setParsedRows(rows);
      }
    };
    reader.readAsText(selectedFile);
  };

  const handleStartImport = async () => {
    const validRows = parsedRows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) return;

    setIsProcessing(true);
    let successCount = 0;
    let failedCount = 0;
    setImportProgress({ current: 0, total: validRows.length, success: 0, failed: 0 });

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        const payload: ItemFormData = {
          name: row.name,
          sku: row.sku || `ITEM-${Date.now().toString().slice(-6)}`,
          itemType: row.itemType,
          unit: row.unit || 'pcs',
          itemStructure: 'single',
          sellingPrice: row.sellingPrice,
          costPrice: row.costPrice,
          hsnCode: row.hsnCode || null,
          salesDescription: row.salesDescription || null,
          purchaseDescription: row.purchaseDescription || null,
          isSalesInfo: true,
          isPurchaseInfo: row.costPrice > 0,
          trackInventory: row.itemType === 'goods',
          inventoryTracking: 'none',
          images: [],
        };

        await itemsApi.createItem(orgId, payload);
        successCount++;
      } catch (_err) {
        failedCount++;
      }
      setImportProgress({
        current: i + 1,
        total: validRows.length,
        success: successCount,
        failed: failedCount,
      });
    }

    setIsProcessing(false);
    setImportSummary({ success: successCount, failed: failedCount });
    onSuccess();
  };

  const validCount = parsedRows.filter((r) => r.errors.length === 0).length;
  const invalidCount = parsedRows.length - validCount;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 12,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid #e2e8f0',
          width: '90%',
          maxWidth: 720,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid #f1f5f9',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: '#f0f9ff',
                color: '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                Import Items
              </h2>
              <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                Upload a CSV file containing your products and services list
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: '#94a3b8',
              padding: 4,
              borderRadius: 6,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {/* Sample template banner */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              marginBottom: 20,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                Need a format template?
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Download our formatted sample CSV with columns ready for filling.
              </div>
            </div>
            <button
              type="button"
              onClick={handleDownloadSample}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #0284c7',
                background: '#ffffff',
                color: '#0284c7',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f9ff')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
            >
              <Download size={14} /> Download Sample
            </button>
          </div>

          {/* Upload Area */}
          {!importSummary && (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed #cbd5e1',
                borderRadius: 10,
                padding: '32px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: file ? '#f0f9ff' : '#fafafa',
                borderColor: file ? '#0284c7' : '#cbd5e1',
                transition: 'all 0.15s ease',
                marginBottom: 20,
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <Upload
                size={32}
                color={file ? '#0284c7' : '#94a3b8'}
                style={{ margin: '0 auto 10px' }}
              />
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                {file ? file.name : 'Click to select CSV file or drag and drop'}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Supports UTF-8 CSV files up to 10MB
              </div>
            </div>
          )}

          {/* Import Summary */}
          {importSummary && (
            <div
              style={{
                padding: 16,
                borderRadius: 8,
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                marginBottom: 20,
                textAlign: 'center',
              }}
            >
              <CheckCircle size={32} color="#16a34a" style={{ margin: '0 auto 8px' }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: '#166534' }}>
                Import Completed!
              </div>
              <div style={{ fontSize: 13, color: '#15803d', marginTop: 4 }}>
                Successfully created <strong>{importSummary.success}</strong> items.
                {importSummary.failed > 0 && ` Failed: ${importSummary.failed}`}
              </div>
            </div>
          )}

          {/* Progress */}
          {isProcessing && importProgress && (
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: '#64748b',
                  marginBottom: 6,
                }}
              >
                <span>Importing items...</span>
                <span>
                  {importProgress.current} / {importProgress.total}
                </span>
              </div>
              <div
                style={{ height: 6, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}
              >
                <div
                  style={{
                    height: '100%',
                    background: '#0284c7',
                    width: `${(importProgress.current / importProgress.total) * 100}%`,
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* Parsed Preview Table */}
          {parsedRows.length > 0 && !importSummary && (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                  Parsed Rows ({parsedRows.length})
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                  <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ {validCount} Valid</span>
                  {invalidCount > 0 && (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>
                      ⚠ {invalidCount} Invalid
                    </span>
                  )}
                </div>
              </div>

              <div
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  maxHeight: 220,
                  overflowY: 'auto',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr
                      style={{
                        background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        textAlign: 'left',
                      }}
                    >
                      <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>#</th>
                      <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>
                        Name
                      </th>
                      <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>
                        SKU
                      </th>
                      <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>
                        Type
                      </th>
                      <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>
                        Price
                      </th>
                      <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 50).map((row) => (
                      <tr key={row.rowNumber} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', color: '#64748b' }}>{row.rowNumber}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 500, color: '#0f172a' }}>
                          {row.name}
                        </td>
                        <td
                          style={{ padding: '8px 12px', color: '#475569', fontFamily: 'monospace' }}
                        >
                          {row.sku || '-'}
                        </td>
                        <td
                          style={{
                            padding: '8px 12px',
                            textTransform: 'capitalize',
                            color: '#475569',
                          }}
                        >
                          {row.itemType}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#0f172a' }}>
                          ₹{row.sellingPrice.toFixed(2)}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          {row.errors.length === 0 ? (
                            <span style={{ color: '#16a34a', fontWeight: 600 }}>Valid</span>
                          ) : (
                            <span
                              style={{ color: '#dc2626', fontSize: 11 }}
                              title={row.errors.join(', ')}
                            >
                              {row.errors[0]}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            padding: '14px 24px',
            borderTop: '1px solid #f1f5f9',
            background: '#fafafa',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#fff',
              color: '#475569',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {importSummary ? 'Close' : 'Cancel'}
          </button>

          {!importSummary && (
            <button
              type="button"
              onClick={handleStartImport}
              disabled={validCount === 0 || isProcessing}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 18px',
                borderRadius: 6,
                border: 'none',
                background: validCount > 0 && !isProcessing ? '#0284c7' : '#94a3b8',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: validCount > 0 && !isProcessing ? 'pointer' : 'not-allowed',
                boxShadow: validCount > 0 ? '0 2px 6px rgba(2, 132, 199, 0.25)' : 'none',
              }}
            >
              {isProcessing && <Loader2 size={15} className="animate-spin" />}
              {isProcessing ? 'Importing...' : `Import ${validCount} Items`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
