import { useState, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { DateInput } from '../../../components/ui/DateInput';
import { Modal } from '../../../components/ui/Modal';
import { Trash2, Plus, Warehouse } from 'lucide-react';
import { formatQty } from '../../jobwork/jobwork.schemas';
import { useQuery } from '@tanstack/react-query';
import { fetchAvailableBatches } from '../../jobwork/batches/batches.api';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useTrackingLabel } from '../../../hooks/useTrackingLabel';
export interface BillBatchRow {
  id: string;
  batchId: string;
  supplierBatchRef: string;
  manufacturerBatch: string;
  manufacturedDate: string;
  expiryDate: string;
  sellingPrice: string;
  mrp: string;
  quantityIn: string;
  isExisting?: boolean;
}

export interface InitialBillBatch {
  id?: string;
  batchId?: string;
  supplierBatchRef?: string | null;
  manufacturerBatch?: string | null;
  manufacturedDate?: string | Date | null;
  expiryDate?: string | Date | null;
  sellingPrice?: string | number | null;
  mrp?: string | number | null;
  quantity?: number | string | null;
  quantityIn?: number | string | null;
  [key: string]: unknown;
}

const createEmptyBatch = (defaultSellingPrice = '', defaultMrp = ''): BillBatchRow => ({
  id: crypto.randomUUID(),
  batchId: '',
  supplierBatchRef: '',
  manufacturerBatch: '',
  manufacturedDate: '',
  expiryDate: '',
  sellingPrice: defaultSellingPrice,
  mrp: defaultMrp,
  quantityIn: '',
  isExisting: false,
});

const toFormRows = (
  initialBatches: InitialBillBatch[],
  defaultSellingPrice = '',
  defaultMrp = '',
): BillBatchRow[] => {
  if (!initialBatches || initialBatches.length === 0) {
    return [createEmptyBatch(defaultSellingPrice, defaultMrp)];
  }

  return initialBatches.map((batch) => ({
    id: batch.id ?? crypto.randomUUID(),
    batchId: batch.batchId ?? '',
    supplierBatchRef: String(batch.supplierBatchRef ?? ''),
    manufacturerBatch: String(batch.manufacturerBatch ?? ''),
    manufacturedDate: batch.manufacturedDate ? String(batch.manufacturedDate).split('T')[0] : '',
    expiryDate: batch.expiryDate ? String(batch.expiryDate).split('T')[0] : '',
    sellingPrice:
      batch.sellingPrice !== null &&
      batch.sellingPrice !== undefined &&
      String(batch.sellingPrice) !== ''
        ? String(batch.sellingPrice)
        : defaultSellingPrice,
    mrp:
      batch.mrp !== null && batch.mrp !== undefined && String(batch.mrp) !== ''
        ? String(batch.mrp)
        : defaultMrp,
    quantityIn: String(batch.quantity ?? batch.quantityIn ?? ''),
    isExisting: batch.isExisting !== undefined ? Boolean(batch.isExisting) : Boolean(batch.batchId),
  }));
};

interface AddBillBatchesModalProps {
  orgId: string;
  itemId?: string;
  locationId?: string;
  isOpen: boolean;
  onClose: () => void;
  itemName: string;
  sku?: string | null;
  uomLabel?: string;
  locationName: string | null;
  lineQty: number;
  initialBatches?: InitialBillBatch[];
  defaultSellingPrice?: string;
  defaultMrp?: string;
  onSave: (batches: InitialBillBatch[], overwriteQty: number | null) => void;
}

export function AddBillBatchesModal({
  orgId,
  itemId,
  locationId,
  isOpen,
  onClose,
  itemName,
  sku,
  uomLabel = 'pcs',
  locationName,
  lineQty,
  initialBatches = [],
  defaultSellingPrice = '',
  defaultMrp = '',
  onSave,
  }: AddBillBatchesModalProps) {
  const trackingLabel = useTrackingLabel();

  const { data: availableBatches = [] } = useQuery({
    queryKey: ['availableBatches', orgId, itemId, locationId],
    queryFn: () => fetchAvailableBatches(orgId, { itemId: itemId!, locationId }),
    enabled: !!orgId && !!itemId,
  });

  const [batches, setBatches] = useState<BillBatchRow[]>(() =>
    toFormRows(initialBatches, defaultSellingPrice, defaultMrp),
  );
  const [overwrite, setOverwrite] = useState(false);

  const allocated = useMemo(
    () => batches.reduce((sum, b) => sum + (parseFloat(b.quantityIn) || 0), 0),
    [batches],
  );
  const remaining = Number((lineQty - allocated).toFixed(4));
  const matches = Math.abs(remaining) < 0.00005;

  const handleAddBatch = () => {
    setBatches([...batches, createEmptyBatch(defaultSellingPrice, defaultMrp)]);
  };

  const handleAddExistingBatch = () => {
    setBatches([
      ...batches,
      { ...createEmptyBatch(defaultSellingPrice, defaultMrp), isExisting: true },
    ]);
  };

  const handleDeleteBatch = (id: string) => {
    setBatches(batches.filter((b) => b.id !== id));
  };

  const updateBatch = (id: string, field: keyof Omit<BillBatchRow, 'id'>, value: string) => {
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  };

  const updateBatchFields = (id: string, updates: Partial<Omit<BillBatchRow, 'id'>>) => {
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, ...updates } : b)));
  };

  const handleSave = () => {
    const validBatches = batches.filter((b) => parseFloat(b.quantityIn) > 0);

    if (validBatches.length === 0 && batches.length > 0) {
      toast.error(`Please enter a valid quantity for at least one ${trackingLabel.singular.toLowerCase()}.`);
      return;
    }

    if (!matches && !overwrite) {
      toast.error(
        `Please allocate exactly ${formatQty(lineQty)} ${uomLabel} or choose to overwrite the line item quantity.`,
      );
      return;
    }

    const nextBatches = validBatches.map((b) => ({
      ...b,
      supplierBatchRef: b.supplierBatchRef || undefined,
      manufacturerBatch: b.manufacturerBatch || undefined,
      manufacturedDate: b.manufacturedDate ? new Date(b.manufacturedDate).toISOString() : undefined,
      expiryDate: b.expiryDate ? new Date(b.expiryDate).toISOString() : undefined,
      sellingPrice: b.sellingPrice ? parseFloat(b.sellingPrice) : undefined,
      mrp: b.mrp ? parseFloat(b.mrp) : undefined,
      quantity: parseFloat(b.quantityIn),
    }));

    onSave(nextBatches, overwrite ? allocated : null);
    onClose();
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

  const dateCellStyle = (isExisting: boolean | undefined): React.CSSProperties => ({
    ...inputStyle,
    ...(isExisting ? { background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' } : {}),
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Add ${trackingLabel.plural}`}
      position="fullScreen"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '12px', width: '100%' }}>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '8px 24px',
              border: 'none',
              background: '#0062ff',
              color: '#fff',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '14px',
            }}
          >
            Save
          </button>
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
        </div>
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: '#f8fafc',
          border: '1px solid #eef0f3',
          borderRadius: 4,
          fontSize: 13,
          color: '#334155',
          marginBottom: 16,
        }}
      >
        <Warehouse size={16} color="#64748b" />
        <span style={{ color: '#94a3b8' }}>Location :</span>
        <span style={{ fontWeight: 500 }}>{locationName || 'N/A'}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: '0 0 4px 0', fontSize: 14, color: '#0f172a' }}>{itemName}</h3>
          {sku && <div style={{ fontSize: 12, color: '#94a3b8' }}>SKU: {sku}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12.5, color: '#64748b' }}>
            Total Quantity : <span style={{ fontWeight: 600, color: '#334155' }}>{formatQty(allocated)} {uomLabel}</span>
            <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
            Quantity to be added :{' '}
            <span
              style={{ fontWeight: 600, color: matches ? '#16a34a' : '#ea580c' }}
            >
              {formatQty(lineQty)} {uomLabel}
            </span>
          </div>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
              fontSize: 12.5,
              color: matches ? '#94a3b8' : '#334155',
              cursor: matches ? 'not-allowed' : 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={overwrite}
              disabled={matches}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Overwrite the line item with {formatQty(allocated)} quantities
          </label>
        </div>
      </div>

      <div style={{ overflowX: 'auto', marginTop: '14px', minHeight: '350px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
          <thead>
            <tr>
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
                {trackingLabel.singular} Reference#*
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
                Manufacturer {trackingLabel.singular}#
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
              <th
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #eef0f3',
                  minWidth: '32px',
                }}
              />
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr key={batch.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                <td style={{ padding: '8px' }}>
                  {batch.isExisting ? (
                    <SearchableSelect
                      options={[
                        {
                          label:
                            'Selling Price: ₹' +
                            Number(defaultSellingPrice || 0).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                            }) +
                            ' | MRP: ₹' +
                            Number(defaultMrp || 0).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                            }),
                          value: 'header',
                          disabled: true,
                        },
                        ...availableBatches.map((b) => ({
                          value: b.batchId,
                          label: b.supplierBatchRef || b.manufacturerBatch || 'Stock',
                          batch: b,
                        })),
                      ]}
                      value={batch.batchId}
                      dropdownWidth={300}
                      onChange={(val) => {
                        if (val === 'header') return;
                        const b = availableBatches.find((x) => x.batchId === val);
                        if (b) {
                          updateBatchFields(batch.id, {
                            batchId: b.batchId,
                            supplierBatchRef: b.supplierBatchRef || '',
                            manufacturerBatch: b.manufacturerBatch || '',
                            manufacturedDate: b.manufacturedDate
                              ? b.manufacturedDate.split('T')[0]
                              : '',
                            expiryDate: b.expiryDate ? b.expiryDate.split('T')[0] : '',
                            sellingPrice:
                              b.sellingPrice !== null && b.sellingPrice !== undefined
                                ? String(b.sellingPrice)
                                : defaultSellingPrice,
                            mrp: b.mrp !== null && b.mrp !== undefined ? String(b.mrp) : defaultMrp,
                          });
                        }
                      }}
                      placeholder="Search"
                      renderOption={(opt) => {
                        if (opt.value === 'header') {
                          return (
                            <div
                              style={{
                                fontSize: '12px',
                                fontWeight: 600,
                                color: '#334155',
                                padding: '4px 0',
                              }}
                            >
                              {opt.label}
                            </div>
                          );
                        }
                        const b = (opt as unknown as { batch: { availableQty: number } }).batch;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{ fontWeight: 500 }}>{opt.label}</div>
                            <div style={{ fontSize: '11.5px', fontWeight: 500, color: '#64748b' }}>
                              Balance in batch: {formatQty(b.availableQty)} {uomLabel}
                            </div>
                          </div>
                        );
                      }}
                    />
                  ) : (
                    <input
                      type="text"
                      value={batch.supplierBatchRef}
                      placeholder={`Enter ${trackingLabel.singular}#`}
                      onChange={(e) => updateBatch(batch.id, 'supplierBatchRef', e.target.value)}
                      style={inputStyle}
                      onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                      onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                    />
                  )}
                </td>
                <td style={{ padding: '8px' }}>
                  <input
                    type="text"
                    value={batch.manufacturerBatch}
                    placeholder={`Enter MFR ${trackingLabel.singular}#`}
                    disabled={batch.isExisting}
                    onChange={(e) => updateBatch(batch.id, 'manufacturerBatch', e.target.value)}
                    style={{
                      ...inputStyle,
                      ...(batch.isExisting
                        ? { background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }
                        : {}),
                    }}
                    onFocus={(e) => !batch.isExisting && (e.target.style.borderColor = '#0062ff')}
                    onBlur={(e) => !batch.isExisting && (e.target.style.borderColor = '#cbd5e1')}
                  />
                </td>
                {/* `portal` — this grid is inside a Modal, which clips an
                    absolutely-positioned calendar to the row. */}
                <td style={{ padding: '8px' }}>
                  <DateInput
                    value={batch.manufacturedDate}
                    disabled={batch.isExisting}
                    onChange={(next) => updateBatch(batch.id, 'manufacturedDate', next)}
                    ariaLabel="Manufactured date"
                    style={dateCellStyle(batch.isExisting)}
                    portal
                  />
                </td>
                <td style={{ padding: '8px' }}>
                  <DateInput
                    value={batch.expiryDate}
                    disabled={batch.isExisting}
                    onChange={(next) => updateBatch(batch.id, 'expiryDate', next)}
                    ariaLabel="Expiry date"
                    style={dateCellStyle(batch.isExisting)}
                    portal
                  />
                </td>
                <td style={{ padding: '8px' }}>
                  <input
                    type="number"
                    step="any"
                    value={batch.sellingPrice}
                    placeholder="0"
                    disabled={batch.isExisting}
                    onChange={(e) => updateBatch(batch.id, 'sellingPrice', e.target.value)}
                    style={{
                      ...rightAlignStyle,
                      ...(batch.isExisting
                        ? { background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }
                        : {}),
                    }}
                    onFocus={(e) => !batch.isExisting && (e.target.style.borderColor = '#0062ff')}
                    onBlur={(e) => !batch.isExisting && (e.target.style.borderColor = '#cbd5e1')}
                  />
                </td>
                <td style={{ padding: '8px' }}>
                  <input
                    type="number"
                    step="any"
                    value={batch.mrp}
                    placeholder="0"
                    disabled={batch.isExisting}
                    onChange={(e) => updateBatch(batch.id, 'mrp', e.target.value)}
                    style={{
                      ...rightAlignStyle,
                      ...(batch.isExisting
                        ? { background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }
                        : {}),
                    }}
                    onFocus={(e) => !batch.isExisting && (e.target.style.borderColor = '#0062ff')}
                    onBlur={(e) => !batch.isExisting && (e.target.style.borderColor = '#cbd5e1')}
                  />
                </td>
                <td style={{ padding: '8px' }}>
                  <input
                    type="number"
                    step="any"
                    value={batch.quantityIn}
                    placeholder="0"
                    onChange={(e) => updateBatch(batch.id, 'quantityIn', e.target.value)}
                    style={rightAlignStyle}
                    onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                    onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                  />
                </td>
                <td style={{ padding: '8px', textAlign: 'center', verticalAlign: 'middle' }}>
                  <button
                    type="button"
                    onClick={() => handleDeleteBatch(batch.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: batches.length === 1 ? 'not-allowed' : 'pointer',
                      color: batches.length === 1 ? '#cbd5e1' : '#ef4444',
                      padding: '6px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '4px',
                    }}
                    disabled={batches.length === 1}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={handleAddBatch}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              color: '#0062ff',
              background: 'none',
              border: 'none',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <Plus size={16} /> New {trackingLabel.singular}
          </button>
          <span style={{ color: '#cbd5e1' }}>|</span>
          <button
            type="button"
            onClick={handleAddExistingBatch}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              color: '#0062ff',
              background: 'none',
              border: 'none',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <Plus size={16} /> Existing {trackingLabel.singular}
          </button>
        </div>
        <div style={{ fontSize: '13px', color: '#64748b' }}>
          {trackingLabel.plural} added: {batches.length} / 100
        </div>
      </div>
    </Modal>
  );
}
