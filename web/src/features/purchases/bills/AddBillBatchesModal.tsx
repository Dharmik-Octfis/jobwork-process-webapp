import { Fragment, useState, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { DateInput } from '../../../components/ui/DateInput';
import { Modal } from '../../../components/ui/Modal';
import { Trash2, Plus, Warehouse } from 'lucide-react';
import { formatQty } from '../../jobwork/jobwork.schemas';
import { useQuery } from '@tanstack/react-query';
import { fetchAvailableBatches } from '../../jobwork/batches/batches.api';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useTrackingLabel, useBatchUnitLabel } from '../../../hooks/useTrackingLabel';
import { BatchUnitsModal, BatchUnitsTrigger } from '../../../components/inventory/BatchUnitsModal';
import {
  QTY_EPSILON,
  isExistingUnit,
  isSubmittableUnit,
  validateBatchUnits,
  type BatchUnitRow as BillBatchUnitRow,
  type ExistingBatchUnitOption,
} from '../../../components/inventory/batchUnits';

export type { BatchUnitRow as BillBatchUnitRow } from '../../../components/inventory/batchUnits';

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
  units: BillBatchUnitRow[];
}

export interface InitialBillBatchUnit {
  label?: string | null;
  quantity?: number | string | null;
  [key: string]: unknown;
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
  units?: InitialBillBatchUnit[] | null;
  [key: string]: unknown;
}

const createEmptyUnit = (): BillBatchUnitRow => ({
  id: crypto.randomUUID(),
  label: '',
  quantity: '',
});

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
  units: [],
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
    units: (batch.units ?? []).map((unit) => ({
      id: crypto.randomUUID(),
      label: String(unit.label ?? ''),
      quantity: unit.quantity === null || unit.quantity === undefined ? '' : String(unit.quantity),
    })),
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
  /** 🔴 `enabled` gates the whole level. Off, and this modal renders exactly as
   * it did before the feature existed — no column, no sub-row, no button. */
  const unitLabel = useBatchUnitLabel();

  const { data: availableBatches = [] } = useQuery({
    // `withUnits` rides in the key: without it the two variants share a cache
    // entry and turning the level on serves the unit-less answer back.
    queryKey: ['availableBatches', orgId, itemId, locationId, unitLabel.enabled],
    queryFn: () =>
      fetchAvailableBatches(orgId, { itemId: itemId!, locationId, withUnits: unitLabel.enabled }),
    enabled: !!orgId && !!itemId,
  });

  /**
   * The packages an existing batch already holds, so an "Existing {unit}" row can
   * point at one. Keyed by batch id — the picker offers a batch once, but the
   * available-batches query returns a row per (batch, godown), so the same batch
   * can appear twice and its units must not be listed twice with it.
   */
  const unitsByBatchId = useMemo(() => {
    const map = new Map<string, ExistingBatchUnitOption[]>();
    for (const row of availableBatches) {
      if (map.has(row.batchId)) continue;
      map.set(
        row.batchId,
        (row.units ?? []).map((unit) => ({
          batchUnitId: unit.batchUnitId,
          label: unit.label,
        })),
      );
    }
    return map;
  }, [availableBatches]);

  const [batches, setBatches] = useState<BillBatchRow[]>(() =>
    toFormRows(initialBatches, defaultSellingPrice, defaultMrp),
  );
  const [overwrite, setOverwrite] = useState(false);
  /**
   * Which batch rows have their unit sub-grid OPEN — closed by default, and
   * stated this way round so "nothing recorded" means "nothing open".
   *
   * It used to be a `collapsed` set defaulting to open, so a chevron nobody knew
   * to press could not hide the "Add {unit}" control. The labelled trigger carries
   * that discoverability now — it says how many packages are in there — and a
   * delivery of ten batches, each sprawling its own package grid, was a dialog
   * nobody could scroll.
   *
   * 🔴 Since 2026-09-03 it is a DIALOG, not an expanding panel, and only ONE can
   * be open — hence a single id rather than a set. Packages are entered exactly
   * the way the batches above them are.
   */
  const [unitsFor, setUnitsFor] = useState<string | null>(null);

  const allocated = useMemo(
    () => batches.reduce((sum, b) => sum + (parseFloat(b.quantityIn) || 0), 0),
    [batches],
  );
  const remaining = Number((lineQty - allocated).toFixed(4));
  const matches = Math.abs(remaining) < QTY_EPSILON;

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

  const handleAddUnit = (batchRowId: string) => {
    setBatches((prev) =>
      prev.map((b) => (b.id === batchRowId ? { ...b, units: [...b.units, createEmptyUnit()] } : b)),
    );
  };

  /** Open one batch's package dialog, giving an empty batch its first row on the
   * way in — a control that reads "Add {plural}" has to add one. */
  const openUnits = (batchRowId: string) => {
    if (!batches.find((b) => b.id === batchRowId)?.units.length) handleAddUnit(batchRowId);
    setUnitsFor(batchRowId);
  };

  /** The same, for a package the batch already holds. A blank `batchUnitId` is
   * what makes the row render a picker instead of a label box; it is filled in
   * when the user picks, and the row is skipped on save until then. */
  const handleAddExistingUnit = (batchRowId: string) => {
    setBatches((prev) =>
      prev.map((b) =>
        b.id === batchRowId
          ? { ...b, units: [...b.units, { ...createEmptyUnit(), batchUnitId: '' }] }
          : b,
      ),
    );
  };

  const pickExistingUnit = (
    batchRowId: string,
    unitId: string,
    option: ExistingBatchUnitOption,
  ) => {
    setBatches((prev) =>
      prev.map((b) =>
        b.id === batchRowId
          ? {
              ...b,
              units: b.units.map((u) =>
                u.id === unitId
                  ? { ...u, batchUnitId: option.batchUnitId, label: option.label }
                  : u,
              ),
            }
          : b,
      ),
    );
  };

  const handleDeleteUnit = (batchRowId: string, unitId: string) => {
    setBatches((prev) =>
      prev.map((b) =>
        b.id === batchRowId ? { ...b, units: b.units.filter((u) => u.id !== unitId) } : b,
      ),
    );
  };

  const updateUnit = (
    batchRowId: string,
    unitId: string,
    field: 'label' | 'quantity',
    value: string,
  ) => {
    setBatches((prev) =>
      prev.map((b) =>
        b.id === batchRowId
          ? { ...b, units: b.units.map((u) => (u.id === unitId ? { ...u, [field]: value } : u)) }
          : b,
      ),
    );
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
      toast.error(
        `Please enter a valid quantity for at least one ${trackingLabel.singular.toLowerCase()}.`,
      );
      return;
    }

    if (!matches && !overwrite) {
      toast.error(
        `Please allocate exactly ${formatQty(lineQty)} ${uomLabel} or choose to overwrite the line item quantity.`,
      );
      return;
    }

    /**
     * The unit rules, checked here so the user is told at the row rather than by
     * a 400 after Save. The service enforces the same three beside the write —
     * this dialog is not the only way a bill can be posted.
     *
     * 🔴 The sum may be LESS than the batch quantity and that is legal, not a
     * lapse: the rest is the batch's untagged remainder, which is physically real
     * (a partly-tagged delivery) and shows on the row as "unallocated". Only
     * MORE is impossible.
     */
    if (unitLabel.enabled) {
      for (const batch of validBatches) {
        const problem = validateBatchUnits({
          units: batch.units,
          batchQty: parseFloat(batch.quantityIn) || 0,
          batchName: batch.supplierBatchRef || trackingLabel.singular,
          singular: unitLabel.singular,
          plural: unitLabel.plural,
          uomLabel,
        });
        if (problem) {
          toast.error(problem);
          return;
        }
      }
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
      // Dropped entirely when the org does not run the level, so a setting that
      // was on and is now off cannot leave stale rows riding along in the payload.
      units: unitLabel.enabled
        ? b.units
            // An "Existing" row is answered by picking; one nobody picked in is
            // dropped exactly as an untouched new row is.
            .filter(isSubmittableUnit)
            .map((u) =>
              isExistingUnit(u)
                ? { batchUnitId: u.batchUnitId!, quantity: parseFloat(u.quantity) }
                : // Blank is legal — the server names it `#seq`. Sent as `undefined`
                  // rather than `''` so "not stated" reaches the schema as absence.
                  { label: u.label.trim() || undefined, quantity: parseFloat(u.quantity) },
            )
        : undefined,
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

  /** The batch whose package dialog is open, re-read from state each render so the
   * dialog shows live rows rather than a snapshot taken when it opened. */
  const unitsBatch = batches.find((b) => b.id === unitsFor) ?? null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Add ${trackingLabel.plural}`}
        width={1100}
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
          }}
        >
          <Warehouse size={14} color="#64748b" />
          {locationName === null ? (
            <span style={{ color: '#64748b' }}>Location not specified</span>
          ) : (
            <>
              <span style={{ color: '#64748b' }}>Location :</span>
              <span style={{ fontWeight: 500 }}>{locationName}</span>
            </>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 20,
            flexWrap: 'wrap',
            padding: '14px 2px 16px',
            borderBottom: '1px solid #eef0f3',
          }}
        >
          <div>
            <div style={{ fontSize: 15, color: '#111' }}>{itemName}</div>
            {sku && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>SKU: {sku}</div>}
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, color: '#334155' }}>
              <span style={{ color: '#64748b' }}>Total Quantity :</span> {formatQty(lineQty)}{' '}
              {uomLabel}
              <span style={{ color: '#e2e8f0', margin: '0 10px' }}>|</span>
              <span style={{ color: '#64748b' }}>Quantity to be added :</span>{' '}
              <span style={{ color: matches ? '#15803d' : '#b45309', fontWeight: 600 }}>
                {formatQty(remaining)} {uomLabel}
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
          <div className="responsive-table-wrapper">
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
                  <Fragment key={batch.id}>
                    <tr style={{ borderBottom: unitLabel.enabled ? 'none' : '1px solid #eef0f3' }}>
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
                            /* 🔴 This grid is inside a Modal AND inside a horizontally
                         scrolling table, so an absolutely-positioned menu is
                         clipped to the cell and most of it is unreachable. */
                            portal
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
                                  mrp:
                                    b.mrp !== null && b.mrp !== undefined
                                      ? String(b.mrp)
                                      : defaultMrp,
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
                              const b = (opt as unknown as { batch: { availableQty: number } })
                                .batch;
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  <div style={{ fontWeight: 500 }}>{opt.label}</div>
                                  <div
                                    style={{
                                      fontSize: '11.5px',
                                      fontWeight: 500,
                                      color: '#64748b',
                                    }}
                                  >
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
                            onChange={(e) =>
                              updateBatch(batch.id, 'supplierBatchRef', e.target.value)
                            }
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
                          onChange={(e) =>
                            updateBatch(batch.id, 'manufacturerBatch', e.target.value)
                          }
                          style={{
                            ...inputStyle,
                            ...(batch.isExisting
                              ? { background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }
                              : {}),
                          }}
                          onFocus={(e) =>
                            !batch.isExisting && (e.target.style.borderColor = '#0062ff')
                          }
                          onBlur={(e) =>
                            !batch.isExisting && (e.target.style.borderColor = '#cbd5e1')
                          }
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
                          onFocus={(e) =>
                            !batch.isExisting && (e.target.style.borderColor = '#0062ff')
                          }
                          onBlur={(e) =>
                            !batch.isExisting && (e.target.style.borderColor = '#cbd5e1')
                          }
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
                          onFocus={(e) =>
                            !batch.isExisting && (e.target.style.borderColor = '#0062ff')
                          }
                          onBlur={(e) =>
                            !batch.isExisting && (e.target.style.borderColor = '#cbd5e1')
                          }
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

                    {/* ── The level BELOW this batch ──────────────────────────────────
                  A sub-grid, not extra columns: the packages of one batch are a
                  variable-length list, and flattening them into the row above
                  would make every batch as wide as its longest neighbour.

                  🔴 DOM order IS tab order, so this sits immediately after the
                  row it belongs to — Tab walks batch fields, then its packages,
                  then the next batch. */}
                    {unitLabel.enabled && (
                      <tr style={{ borderBottom: '1px solid #eef0f3' }}>
                        <td colSpan={9} style={{ padding: '0 8px 10px' }}>
                          <BatchUnitsTrigger
                            count={batch.units.length}
                            singular={unitLabel.singular}
                            plural={unitLabel.plural}
                            onOpen={() => openUnits(batch.id)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
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

      {unitsBatch && (
        <BatchUnitsModal
          isOpen
          onClose={() => setUnitsFor(null)}
          batchName={unitsBatch.supplierBatchRef?.trim() || trackingLabel.singular}
          batchSingular={trackingLabel.singular}
          singular={unitLabel.singular}
          plural={unitLabel.plural}
          batchQty={parseFloat(unitsBatch.quantityIn) || 0}
          uomLabel={uomLabel}
          units={unitsBatch.units}
          /* Only a batch that already exists has packages to add to, so a
           "New {batch}" row offers none and the link disables itself. */
          existingOptions={unitsBatch.batchId ? (unitsByBatchId.get(unitsBatch.batchId) ?? []) : []}
          onAdd={() => handleAddUnit(unitsBatch.id)}
          onAddExisting={() => handleAddExistingUnit(unitsBatch.id)}
          onChange={(unitId, field, value) => updateUnit(unitsBatch.id, unitId, field, value)}
          onPickExisting={(unitId, option) => pickExistingUnit(unitsBatch.id, unitId, option)}
          onRemove={(unitId) => handleDeleteUnit(unitsBatch.id, unitId)}
        />
      )}
    </>
  );
}
