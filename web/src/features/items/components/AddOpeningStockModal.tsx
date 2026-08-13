import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { Trash2, Plus, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchLocations } from '../../configuration/locations/locations.api';
import type { ItemOpeningStockLocationRowDto } from '../items.schemas';

export interface OpeningStockBatchRow {
  id: string;
  batchReference: string;
  manufacturerBatch: string;
  manufacturedDate: string;
  expiryDate: string;
  sellingPrice: string;
  mrp: string;
  quantityIn: string;
}

export interface OpeningStockLocationRow {
  id: string;
  locationId: string;
  openingStock: string;
  openingStockValue: string;
  batches: OpeningStockBatchRow[];
}

const createEmptyBatch = (): OpeningStockBatchRow => ({
  id: crypto.randomUUID(),
  batchReference: '',
  manufacturerBatch: '',
  manufacturedDate: '',
  expiryDate: '',
  sellingPrice: '',
  mrp: '',
  quantityIn: '',
});

const createEmptyLocation = (): OpeningStockLocationRow => ({
  id: crypto.randomUUID(),
  locationId: '',
  openingStock: '',
  openingStockValue: '',
  batches: [createEmptyBatch()],
});

const toFormRows = (rows: ItemOpeningStockLocationRowDto[]): OpeningStockLocationRow[] => {
  if (rows.length === 0) return [createEmptyLocation()];

  return rows.map((row) => ({
    id: row.id ?? crypto.randomUUID(),
    locationId: row.locationId,
    openingStock: String(row.openingStock ?? ''),
    openingStockValue: String(row.openingStockValue ?? ''),
    batches:
      row.batches.length > 0
        ? row.batches.map((batch) => ({
            id: batch.id ?? crypto.randomUUID(),
            batchReference: String(batch.batchReference ?? ''),
            manufacturerBatch: String(batch.manufacturerBatch ?? ''),
            manufacturedDate: String(batch.manufacturedDate ?? ''),
            expiryDate: String(batch.expiryDate ?? ''),
            sellingPrice: String(batch.sellingPrice ?? ''),
            mrp: String(batch.mrp ?? ''),
            quantityIn: String(batch.quantityIn ?? ''),
          }))
        : [createEmptyBatch()],
  }));
};

interface AddOpeningStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  initialRows?: ItemOpeningStockLocationRowDto[];
  onSave?: (data: OpeningStockLocationRow[]) => void | Promise<void>;
  isSaving?: boolean;
}

// The parent mounts this only while the dialog is open, so `initialRows` is read
// once on mount — re-syncing it afterwards would wipe whatever the user typed.
export function AddOpeningStockModal({
  isOpen,
  onClose,
  orgId,
  initialRows = [],
  onSave,
  isSaving = false,
}: AddOpeningStockModalProps) {
  const [locationRows, setLocationRows] = useState<OpeningStockLocationRow[]>(() =>
    toFormRows(initialRows),
  );

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId),
    enabled: !!orgId && isOpen,
  });

  const locationOptions = [...locations]
    .sort((a, b) => (a.isPrimary ? -1 : b.isPrimary ? 1 : 0))
    .map((loc) => ({
      value: loc.id,
      label: loc.name,
    }));

  const handleAddLocation = () => {
    setLocationRows([...locationRows, createEmptyLocation()]);
  };

  const handleDeleteLocation = (id: string) => {
    setLocationRows(locationRows.filter((r) => r.id !== id));
  };

  const updateLocation = (
    id: string,
    field: keyof Omit<OpeningStockLocationRow, 'batches' | 'id'>,
    value: string,
  ) => {
    setLocationRows(locationRows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleAddBatch = (locationId: string) => {
    setLocationRows(
      locationRows.map((r) => {
        if (r.id === locationId) {
          return { ...r, batches: [...r.batches, createEmptyBatch()] };
        }
        return r;
      }),
    );
  };

  const handleDeleteBatch = (locationId: string, batchId: string) => {
    setLocationRows(
      locationRows.map((r) => {
        if (r.id === locationId) {
          return { ...r, batches: r.batches.filter((b) => b.id !== batchId) };
        }
        return r;
      }),
    );
  };

  const updateBatch = (
    locationId: string,
    batchId: string,
    field: keyof Omit<OpeningStockBatchRow, 'id'>,
    value: string,
  ) => {
    setLocationRows(
      locationRows.map((r) => {
        if (r.id === locationId) {
          return {
            ...r,
            batches: r.batches.map((b) => (b.id === batchId ? { ...b, [field]: value } : b)),
          };
        }
        return r;
      }),
    );
  };

  const handleSave = async () => {
    try {
      if (onSave) {
        const rowsToSave = locationRows.map((r) => {
          if (!isBatchTracked) {
            const qty = r.openingStock || '0';
            return {
              ...r,
              batches: [
                {
                  id: r.batches[0]?.id || crypto.randomUUID(),
                  batchReference: '',
                  manufacturerBatch: '',
                  manufacturedDate: '',
                  expiryDate: '',
                  sellingPrice: '',
                  mrp: '',
                  quantityIn: qty,
                },
              ],
            };
          }
          return r;
        });
        await onSave(rowsToSave);
      }
      onClose();
    } catch (error) {
      console.error('Failed to save opening stock', error);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    fontSize: '13px',
    border: '1px solid #cbd5e1',
    borderRadius: '4px',
    background: '#fff',
    color: '#1e293b',
    outline: 'none',
    transition: 'border-color 0.2s',
  };

  const rightAlignStyle = { ...inputStyle, textAlign: 'right' as const };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Opening Stock"
      subtitle={
        isBatchTracked
          ? 'Enter location stock and batch details, then save to persist them.'
          : 'Enter location stock details, then save to persist them.'
      }
      width={isBatchTracked ? '1300px' : '750px'}
      position="right"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', width: '100%' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              border: '1px solid #d1d5db',
              background: '#fff',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '14px',
              color: '#374151',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '8px 24px',
              border: 'none',
              background: isSaving ? '#93c5fd' : '#0062ff',
              color: '#fff',
              borderRadius: '4px',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              fontSize: '14px',
              opacity: isSaving ? 0.85 : 1,
            }}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      }
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isBatchTracked ? '1200px' : '100%' }}>
          <thead>
            <tr>
              <th
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #eef0f3',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  textAlign: 'left',
                  minWidth: '160px',
                }}
              >
                Location
              </th>
              <th
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #eef0f3',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  textAlign: 'right',
                  minWidth: '140px',
                }}
              >
                Opening Stock
              </th>
              <th
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #eef0f3',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  textAlign: 'right',
                  minWidth: '160px',
                }}
              >
                Opening Stock Value
                <br />
                per unit
              </th>
              <th
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #eef0f3',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#ef4444',
                  textTransform: 'uppercase',
                  textAlign: 'left',
                  minWidth: '130px',
                }}
              >
                Batch Reference#*
              </th>
              <th
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #eef0f3',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  textAlign: 'left',
                  minWidth: '130px',
                }}
              >
                Manufacturer Batch#
              </th>
              <th
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #eef0f3',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  textAlign: 'left',
                  minWidth: '140px',
                }}
              >
                Manufactured Date
              </th>
              <th
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #eef0f3',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  textAlign: 'left',
                  minWidth: '140px',
                }}
              >
                Expiry Date
              </th>
              <th
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #eef0f3',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#ef4444',
                  textTransform: 'uppercase',
                  textAlign: 'right',
                  minWidth: '100px',
                }}
              >
                Selling Price*
              </th>
              <th
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #eef0f3',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  textAlign: 'right',
                  minWidth: '90px',
                }}
              >
                MRP
              </th>
              <th
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #eef0f3',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#ef4444',
                  textTransform: 'uppercase',
                  textAlign: 'right',
                  minWidth: '100px',
                }}
              >
                Quantity In*
              </th>
              <th style={{ padding: '8px', borderBottom: '1px solid #eef0f3', minWidth: '32px' }} />
              <th style={{ padding: '8px', borderBottom: '1px solid #eef0f3', minWidth: '40px' }} />
            </tr>
          </thead>
          {locationRows.map((loc) => (
            <tbody key={loc.id} style={{ borderBottom: '1px solid #eef0f3' }}>
              {loc.batches.map((batch, batchIndex) => (
                <tr key={batch.id}>
                  {batchIndex === 0 && (
                    <>
                      <td
                        rowSpan={loc.batches.length + 1}
                        style={{
                          padding: '8px',
                          verticalAlign: 'top',
                          borderRight: '1px solid #eef0f3',
                        }}
                      >
                        <Select
                          value={loc.locationId}
                          onChange={(val) => updateLocation(loc.id, 'locationId', val)}
                          options={locationOptions}
                          placeholder="Select Location"
                          minWidth="100%"
                        />
                      </td>
                      <td
                        rowSpan={loc.batches.length + 1}
                        style={{
                          padding: '8px',
                          verticalAlign: 'top',
                          borderRight: '1px solid #eef0f3',
                        }}
                      >
                        <input
                          type="number"
                          value={loc.openingStock}
                          onChange={(e) => updateLocation(loc.id, 'openingStock', e.target.value)}
                          style={rightAlignStyle}
                          onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                          onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                        />
                      </td>
                      <td
                        rowSpan={loc.batches.length + 1}
                        style={{
                          padding: '8px',
                          verticalAlign: 'top',
                          borderRight: '1px solid #eef0f3',
                        }}
                      >
                        <input
                          type="number"
                          value={loc.openingStockValue}
                          onChange={(e) =>
                            updateLocation(loc.id, 'openingStockValue', e.target.value)
                          }
                          style={rightAlignStyle}
                          onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                          onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                        />
                      </td>
                    </>
                  )}
                  <td style={{ padding: '8px' }}>
                    <input
                      type="text"
                      value={batch.batchReference}
                      placeholder="Enter Batch#"
                      onChange={(e) =>
                        updateBatch(loc.id, batch.id, 'batchReference', e.target.value)
                      }
                      style={inputStyle}
                      onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                      onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                    />
                  </td>
                  <td style={{ padding: '8px' }}>
                    <input
                      type="text"
                      value={batch.manufacturerBatch}
                      placeholder="Enter MFR Batch#"
                      onChange={(e) =>
                        updateBatch(loc.id, batch.id, 'manufacturerBatch', e.target.value)
                      }
                      style={inputStyle}
                      onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                      onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                    />
                  </td>
                  <td style={{ padding: '8px' }}>
                    <input
                      type="date"
                      value={batch.manufacturedDate}
                      onChange={(e) =>
                        updateBatch(loc.id, batch.id, 'manufacturedDate', e.target.value)
                      }
                      style={inputStyle}
                      onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                      onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                    />
                  </td>
                  <td style={{ padding: '8px' }}>
                    <input
                      type="date"
                      value={batch.expiryDate}
                      onChange={(e) => updateBatch(loc.id, batch.id, 'expiryDate', e.target.value)}
                      style={inputStyle}
                      onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                      onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                    />
                  </td>
                  <td style={{ padding: '8px' }}>
                    <input
                      type="number"
                      value={batch.sellingPrice}
                      onChange={(e) =>
                        updateBatch(loc.id, batch.id, 'sellingPrice', e.target.value)
                      }
                      style={rightAlignStyle}
                      onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                      onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                    />
                  </td>
                  <td style={{ padding: '8px' }}>
                    <input
                      type="number"
                      value={batch.mrp}
                      onChange={(e) => updateBatch(loc.id, batch.id, 'mrp', e.target.value)}
                      style={rightAlignStyle}
                      onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                      onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                    />
                  </td>
                  <td style={{ padding: '8px' }}>
                    <input
                      type="number"
                      value={batch.quantityIn}
                      onChange={(e) => updateBatch(loc.id, batch.id, 'quantityIn', e.target.value)}
                      style={rightAlignStyle}
                      onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                      onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                    />
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      textAlign: 'center',
                      borderRight: '1px solid #eef0f3',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleDeleteBatch(loc.id, batch.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: loc.batches.length === 1 ? 'not-allowed' : 'pointer',
                        color: loc.batches.length === 1 ? '#cbd5e1' : '#ef4444',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px',
                        transition: 'background-color 0.2s',
                      }}
                      disabled={loc.batches.length === 1}
                    >
                      <X size={16} />
                    </button>
                  </td>
                  {batchIndex === 0 && (
                    <td
                      rowSpan={loc.batches.length + 1}
                      style={{ padding: '8px', textAlign: 'center', verticalAlign: 'top' }}
                    >
                      <button
                        type="button"
                        onClick={() => handleDeleteLocation(loc.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: locationRows.length === 1 ? 'not-allowed' : 'pointer',
                          color: locationRows.length === 1 ? '#cbd5e1' : '#ef4444',
                          padding: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '4px',
                          transition: 'background-color 0.2s',
                        }}
                        disabled={locationRows.length === 1}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              <tr>
                <td colSpan={8} style={{ padding: '8px', borderRight: '1px solid #eef0f3' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleAddBatch(loc.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: '#0062ff',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 500,
                        padding: '4px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      <Plus size={14} />
                      New Batch
                    </button>
                    <div
                      style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#f59e0b' }}
                    >
                      <span>Quantity To Be Added: {loc.openingStock || 0}</span>
                      <span>
                        Added Qty to Location :{' '}
                        {loc.batches.reduce(
                          (acc, b) => acc + (parseFloat(String(b.quantityIn)) || 0),
                          0,
                        )}
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          ))}
        </table>
        <div style={{ padding: '16px 8px' }}>
          <button
            type="button"
            onClick={handleAddLocation}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: '#0062ff',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              padding: '8px 12px',
              borderRadius: '4px',
            }}
          >
            <Plus size={16} />
            New Row
          </button>
        </div>
      </div>
    </Modal>
  );
}
