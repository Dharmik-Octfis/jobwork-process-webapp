import { useState } from 'react';
import { FileSpreadsheet, Download, Check, FileText } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { notify } from '../../../lib/notify';
import type { Item } from '../items.schemas';
import type { CustomFieldDefinition } from '../../custom-fields/customFields.schemas';
import {
  exportItemsToExcel,
  fetchAllItemsForExport,
} from '../utils/exportItems';

export interface ExportItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  currentItems: Item[];
  totalItemCount?: number;
  selectedIds?: string[];
  currentFilter?: string;
  currentSearch?: string;
  visibleColumnKeys?: string[];
  customFieldsDef?: CustomFieldDefinition[];
}

export function ExportItemsModal({
  isOpen,
  onClose,
  orgId,
  currentItems,
  totalItemCount,
  selectedIds = [],
  currentFilter,
  currentSearch,
  visibleColumnKeys = [],
  customFieldsDef = [],
}: ExportItemsModalProps) {
  const [exportScope, setExportScope] = useState<'all' | 'filtered' | 'selected'>(
    selectedIds.length > 0 ? 'selected' : 'all'
  );
  const [fieldsSelection, setFieldsSelection] = useState<'all' | 'visible'>('all');
  const [fileFormat, setFileFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [isExporting, setIsExporting] = useState(false);
  const [progressCount, setProgressCount] = useState<number | null>(null);

  const selectedCount = selectedIds.length;
  const hasSelected = selectedCount > 0;

  const handleExport = async () => {
    setIsExporting(true);
    setProgressCount(null);

    try {
      let itemsToExport: Item[] = [];

      if (exportScope === 'selected') {
        itemsToExport = currentItems.filter((i) => selectedIds.includes(i.id));
        // If some selected items aren't in current page, we can fetch all or use what we have
        if (itemsToExport.length < selectedCount) {
          const allFetched = await fetchAllItemsForExport(orgId, {}, (loaded) => {
            setProgressCount(loaded);
          });
          itemsToExport = allFetched.filter((i) => selectedIds.includes(i.id));
        }
      } else if (exportScope === 'filtered') {
        itemsToExport = await fetchAllItemsForExport(
          orgId,
          {
            filter: currentFilter,
            search: currentSearch || undefined,
          },
          (loaded) => {
            setProgressCount(loaded);
          }
        );
      } else {
        // All items
        itemsToExport = await fetchAllItemsForExport(
          orgId,
          {},
          (loaded) => {
            setProgressCount(loaded);
          }
        );
      }

      if (itemsToExport.length === 0) {
        notify.error('No items found to export.');
        setIsExporting(false);
        return;
      }

      const dateStr = new Date().toISOString().split('T')[0];
      const scopeSuffix =
        exportScope === 'selected'
          ? '_Selected'
          : exportScope === 'filtered' && currentFilter && currentFilter !== 'all'
          ? `_${currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1)}`
          : '';
      const filename = `Items${scopeSuffix}_${dateStr}`;

      exportItemsToExcel({
        items: itemsToExport,
        filename,
        customFieldsDef,
        visibleColumnKeys,
        exportAllFields: fieldsSelection === 'all',
        format: fileFormat,
      });

      notify.success(
        `Successfully exported ${itemsToExport.length} ${
          itemsToExport.length === 1 ? 'item' : 'items'
        } as ${fileFormat.toUpperCase()}.`
      );
      onClose();
    } catch (err: unknown) {
      console.error('Failed to export items:', err);
      notify.error('Failed to export items. Please try again.');
    } finally {
      setIsExporting(false);
      setProgressCount(null);
    }
  };

  const footer = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
      <button
        type="button"
        onClick={onClose}
        disabled={isExporting}
        style={{
          padding: '8px 16px',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: '6px',
          color: '#475569',
          fontSize: '13px',
          fontWeight: 500,
          cursor: isExporting ? 'not-allowed' : 'pointer',
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleExport}
        disabled={isExporting}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 20px',
          background: '#166534',
          border: 'none',
          borderRadius: '6px',
          color: '#fff',
          fontSize: '13px',
          fontWeight: 600,
          cursor: isExporting ? 'not-allowed' : 'pointer',
          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        }}
      >
        <Download size={15} />
        {isExporting
          ? progressCount !== null
            ? `Fetching Items (${progressCount})...`
            : 'Exporting...'
          : 'Export'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Items"
      subtitle="Export items data from your organization into a spreadsheet file."
      width={560}
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Export Scope */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 600,
              color: '#334155',
              marginBottom: '8px',
            }}
          >
            Export Items
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 14px',
                border: exportScope === 'all' ? '1px solid #166534' : '1px solid #e2e8f0',
                background: exportScope === 'all' ? '#f0fdf4' : '#fff',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <input
                type="radio"
                name="exportScope"
                checked={exportScope === 'all'}
                onChange={() => setExportScope('all')}
                style={{ accentColor: '#166534', cursor: 'pointer' }}
              />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#1e293b' }}>
                  All Items
                </span>
                {totalItemCount !== undefined && (
                  <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '6px' }}>
                    ({totalItemCount} total)
                  </span>
                )}
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 14px',
                border: exportScope === 'filtered' ? '1px solid #166534' : '1px solid #e2e8f0',
                background: exportScope === 'filtered' ? '#f0fdf4' : '#fff',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <input
                type="radio"
                name="exportScope"
                checked={exportScope === 'filtered'}
                onChange={() => setExportScope('filtered')}
                style={{ accentColor: '#166534', cursor: 'pointer' }}
              />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#1e293b' }}>
                  Current View & Filters
                </span>
                {(currentFilter || currentSearch) && (
                  <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '6px' }}>
                    ({currentFilter ? `Filter: ${currentFilter}` : ''}
                    {currentSearch ? ` Search: "${currentSearch}"` : ''})
                  </span>
                )}
              </div>
            </label>

            {hasSelected && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  border: exportScope === 'selected' ? '1px solid #166534' : '1px solid #e2e8f0',
                  background: exportScope === 'selected' ? '#f0fdf4' : '#fff',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <input
                  type="radio"
                  name="exportScope"
                  checked={exportScope === 'selected'}
                  onChange={() => setExportScope('selected')}
                  style={{ accentColor: '#166534', cursor: 'pointer' }}
                />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#1e293b' }}>
                    Selected Items Only
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      background: '#dcfce7',
                      color: '#166534',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      marginLeft: '8px',
                      fontWeight: 600,
                    }}
                  >
                    {selectedCount} selected
                  </span>
                </div>
              </label>
            )}
          </div>
        </div>

        {/* Fields to Export */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 600,
              color: '#334155',
              marginBottom: '8px',
            }}
          >
            Fields to Export
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 12px',
                border: fieldsSelection === 'all' ? '1px solid #166534' : '1px solid #e2e8f0',
                background: fieldsSelection === 'all' ? '#f0fdf4' : '#fff',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="fieldsSelection"
                checked={fieldsSelection === 'all'}
                onChange={() => setFieldsSelection('all')}
                style={{ accentColor: '#166534', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '13px', color: '#1e293b' }}>All Fields</span>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 12px',
                border: fieldsSelection === 'visible' ? '1px solid #166534' : '1px solid #e2e8f0',
                background: fieldsSelection === 'visible' ? '#f0fdf4' : '#fff',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="fieldsSelection"
                checked={fieldsSelection === 'visible'}
                onChange={() => setFieldsSelection('visible')}
                style={{ accentColor: '#166534', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '13px', color: '#1e293b' }}>Current View Columns</span>
            </label>
          </div>
        </div>

        {/* File Format */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 600,
              color: '#334155',
              marginBottom: '8px',
            }}
          >
            Export File Format
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div
              onClick={() => setFileFormat('xlsx')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 14px',
                border: fileFormat === 'xlsx' ? '2px solid #166534' : '1px solid #e2e8f0',
                background: fileFormat === 'xlsx' ? '#f0fdf4' : '#fff',
                borderRadius: '8px',
                cursor: 'pointer',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '6px',
                  background: '#dcfce7',
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FileSpreadsheet size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                  XLSX
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Microsoft Excel</div>
              </div>
              {fileFormat === 'xlsx' && (
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: '#166534',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Check size={12} strokeWidth={3} />
                </div>
              )}
            </div>

            <div
              onClick={() => setFileFormat('csv')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 14px',
                border: fileFormat === 'csv' ? '2px solid #166534' : '1px solid #e2e8f0',
                background: fileFormat === 'csv' ? '#f0fdf4' : '#fff',
                borderRadius: '8px',
                cursor: 'pointer',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '6px',
                  background: '#f1f5f9',
                  color: '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FileText size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                  CSV
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Comma Separated</div>
              </div>
              {fileFormat === 'csv' && (
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: '#166534',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Check size={12} strokeWidth={3} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
