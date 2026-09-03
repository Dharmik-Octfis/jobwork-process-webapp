import { Fragment, useState } from 'react';
import { toast } from 'react-hot-toast';
import { DateInput } from '../../../components/ui/DateInput';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { Trash2, Plus, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchLocations } from '../../configuration/locations/locations.api';
import { itemsApi } from '../items.api';
import { useTrackingLabel, useBatchUnitLabel } from '../../../hooks/useTrackingLabel';
import { BatchUnitsModal, BatchUnitsTrigger } from '../../../components/inventory/BatchUnitsModal';
import { validateBatchUnits } from '../../../components/inventory/batchUnits';
import type { ItemOpeningStockLocationRowDto } from '../items.schemas';

/**
 * One package inside a declared batch. `id` is the real `batch_units.id` when the
 * row came back from the server — round-tripped so a save can tell "this package,
 * edited" from "a new package", exactly as the batch id does one level up.
 */
export interface OpeningStockUnitRow {
  id: string;
  /** True once this row has a server id, i.e. it is an EDIT and not a creation.
   * The local `id` is a UUID either way, so it cannot be inferred from the value. */
  isExisting: boolean;
  label: string;
  quantityIn: string;
}

export interface OpeningStockBatchRow {
  id: string;
  batchReference: string;
  manufacturerBatch: string;
  manufacturedDate: string;
  expiryDate: string;
  sellingPrice: string;
  mrp: string;
  quantityIn: string;
  isExisting?: boolean;
  units: OpeningStockUnitRow[];
}

export interface OpeningStockLocationRow {
  id: string;
  locationId: string;
  openingStock: string;
  openingStockValue: string;
  batches: OpeningStockBatchRow[];
}

const createEmptyBatch = (defaultSellingPrice = '', defaultMrp = ''): OpeningStockBatchRow => {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return {
    id: crypto.randomUUID(),
    batchReference: '',
    manufacturerBatch: '',
    manufacturedDate: todayStr,
    expiryDate: todayStr,
    sellingPrice: defaultSellingPrice,
    mrp: defaultMrp,
    quantityIn: '',
    isExisting: false,
    units: [],
  };
};

const createEmptyUnit = (): OpeningStockUnitRow => ({
  id: crypto.randomUUID(),
  isExisting: false,
  label: '',
  quantityIn: '',
});

const createEmptyLocation = (): OpeningStockLocationRow => ({
  id: crypto.randomUUID(),
  locationId: '',
  openingStock: '',
  openingStockValue: '',
  batches: [],
});

const toFormRows = (
  rows: ItemOpeningStockLocationRowDto[],
  isBatchTracked: boolean,
  defaultSellingPrice = '',
  defaultMrp = '',
): OpeningStockLocationRow[] => {
  return rows
    .filter((row) => row.openingStock !== null && row.openingStock !== undefined)
    .map((row) => ({
      id: row.id ?? crypto.randomUUID(),
      locationId: row.locationId,
      openingStock:
        row.openingStock !== null && row.openingStock !== undefined ? String(row.openingStock) : '',
      openingStockValue:
        row.openingStockValue !== null && row.openingStockValue !== undefined
          ? String(row.openingStockValue)
          : '',
      batches: isBatchTracked
        ? row.batches.length > 0
          ? row.batches.map((batch) => ({
              id: batch.id ?? crypto.randomUUID(),
              batchReference: String(batch.batchReference ?? ''),
              manufacturerBatch: String(batch.manufacturerBatch ?? ''),
              manufacturedDate: String(batch.manufacturedDate ?? ''),
              expiryDate: String(batch.expiryDate ?? ''),
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
              quantityIn: String(batch.quantityIn ?? ''),
              isExisting: Boolean(batch.batchReference),
              units: (batch.units ?? []).map((unit) => ({
                // 🔴 The SERVER's id where there is one, so the package round-trips
                // and is ADJUSTED rather than re-created. A row without one is not
                // an error — it is a package this grid has not saved yet — so it
                // gets a local key and is marked as new.
                id: unit.id ?? crypto.randomUUID(),
                isExisting: Boolean(unit.id),
                label: String(unit.label ?? ''),
                quantityIn: String(unit.quantityIn ?? ''),
              })),
            }))
          : []
        : [],
    }));
};

interface AddOpeningStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  itemId?: string;
  inventoryTracking?: string | null;
  itemName?: string;
  initialRows?: ItemOpeningStockLocationRowDto[];
  /** The PAYLOAD shape, not the form's — `handleSave` cleans the grid's rows on
   * the way out, and both callers hand what comes through straight to the API. */
  onSave?: (data: ItemOpeningStockLocationRowDto[]) => void | Promise<void>;
  isSaving?: boolean;
}

export function AddOpeningStockModal({
  isOpen,
  onClose,
  orgId,
  itemId,
  inventoryTracking,
  itemName,
  initialRows = [],
  onSave,
  isSaving = false,
}: AddOpeningStockModalProps) {
  const isBatchTracked = inventoryTracking === 'batch';
  const { singular, plural } = useTrackingLabel();
  /**
   * 🔴 Visibility is INHERITED, not configured per item. The package level shows
   * exactly where a batch shows — so `isBatchTracked` as well as the org switch.
   * An item at `inventoryTracking = 'none'` never sees a batch field, so it must
   * never see a package one either.
   */
  const unitLabel = useBatchUnitLabel();
  const showUnits = unitLabel.enabled && isBatchTracked;
  /**
   * Which batch's package DIALOG is open — one at a time, hence a single address
   * rather than a set. It was an expanding sub-grid until 2026-09-03; packages are
   * now entered exactly the way the batches above them are, in a dialog of their
   * own. Keyed by location AND batch because a batch row id is only unique within
   * its location here.
   */
  const [unitsFor, setUnitsFor] = useState<{ locationId: string; batchId: string } | null>(null);

  const { data: item } = useQuery({
    queryKey: ['item', orgId, itemId],
    queryFn: () => itemsApi.getItem(orgId, itemId!),
    enabled: !!orgId && !!itemId && isOpen,
  });

  const defaultSellingPrice =
    item?.sellingPrice !== undefined && item?.sellingPrice !== null
      ? String(item.sellingPrice)
      : '';

  const defaultMrp =
    item?.mrp !== undefined && item?.mrp !== null && String(item.mrp) !== ''
      ? String(item.mrp)
      : defaultSellingPrice;

  const [locationRows, setLocationRows] = useState<OpeningStockLocationRow[]>(() =>
    toFormRows(initialRows, isBatchTracked, defaultSellingPrice, defaultMrp),
  );

  const [prevDefaultSellingPrice, setPrevDefaultSellingPrice] = useState(defaultSellingPrice);
  const [prevDefaultMrp, setPrevDefaultMrp] = useState(defaultMrp);

  if (
    (defaultSellingPrice && defaultSellingPrice !== prevDefaultSellingPrice) ||
    (defaultMrp && defaultMrp !== prevDefaultMrp)
  ) {
    setPrevDefaultSellingPrice(defaultSellingPrice);
    setPrevDefaultMrp(defaultMrp);
    setLocationRows((prevRows) =>
      prevRows.map((loc) => ({
        ...loc,
        batches: loc.batches.map((b) => {
          if (b.isExisting) return b;
          return {
            ...b,
            sellingPrice: b.sellingPrice || defaultSellingPrice,
            mrp: b.mrp || defaultMrp,
          };
        }),
      })),
    );
  }

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
    setLocationRows([
      ...locationRows,
      {
        ...createEmptyLocation(),
        batches: isBatchTracked ? [createEmptyBatch(defaultSellingPrice, defaultMrp)] : [],
      },
    ]);
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

  const handleCopyOpeningStockToAll = () => {
    if (locationRows.length === 0) return;
    const firstVal = locationRows[0].openingStock;
    setLocationRows(locationRows.map((r) => ({ ...r, openingStock: firstVal })));
  };

  const handleCopyOpeningStockValueToAll = () => {
    if (locationRows.length === 0) return;
    const firstVal = locationRows[0].openingStockValue;
    setLocationRows(locationRows.map((r) => ({ ...r, openingStockValue: firstVal })));
  };

  const handleAddBatch = (locationId: string) => {
    setLocationRows(
      locationRows.map((r) => {
        if (r.id === locationId) {
          return {
            ...r,
            batches: [...r.batches, createEmptyBatch(defaultSellingPrice, defaultMrp)],
          };
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
          const nextBatches = r.batches.map((b) =>
            b.id === batchId ? { ...b, [field]: value } : b,
          );
          return {
            ...r,
            batches: nextBatches,
          };
        }
        return r;
      }),
    );
  };

  const handleAddUnit = (locationId: string, batchId: string) => {
    setLocationRows((rows) =>
      rows.map((r) =>
        r.id === locationId
          ? {
              ...r,
              batches: r.batches.map((b) =>
                b.id === batchId ? { ...b, units: [...b.units, createEmptyUnit()] } : b,
              ),
            }
          : r,
      ),
    );
  };

  /** Open one batch's package dialog, giving an empty batch its first row on the
   * way in — a control that reads "Add {plural}" has to add one. */
  const openUnits = (locationId: string, batchId: string) => {
    const batch = locationRows
      .find((r) => r.id === locationId)
      ?.batches.find((b) => b.id === batchId);
    if (!batch?.units.length) handleAddUnit(locationId, batchId);
    setUnitsFor({ locationId, batchId });
  };

  const handleDeleteUnit = (locationId: string, batchId: string, unitId: string) => {
    setLocationRows((rows) =>
      rows.map((r) =>
        r.id === locationId
          ? {
              ...r,
              batches: r.batches.map((b) =>
                b.id === batchId ? { ...b, units: b.units.filter((u) => u.id !== unitId) } : b,
              ),
            }
          : r,
      ),
    );
  };

  const updateUnit = (
    locationId: string,
    batchId: string,
    unitId: string,
    field: 'label' | 'quantityIn',
    value: string,
  ) => {
    setLocationRows((rows) =>
      rows.map((r) =>
        r.id === locationId
          ? {
              ...r,
              batches: r.batches.map((b) =>
                b.id === batchId
                  ? {
                      ...b,
                      units: b.units.map((u) => (u.id === unitId ? { ...u, [field]: value } : u)),
                    }
                  : b,
              ),
            }
          : r,
      ),
    );
  };

  /**
   * 🔴 HOW FAR THE THREE LOCATION CELLS REACH DOWN.
   *
   * They are `rowSpan`ned across every row of their location — one per batch plus
   * the "New {batch}" footer. An open package sub-grid is an EXTRA row underneath
   * its batch, so it has to be counted here too, or the location column ends
   * short and the whole table shears sideways by one cell per open batch. Nothing
   * catches that but looking at it.
   */
  const locRowSpan = (loc: OpeningStockLocationRow) =>
    loc.batches.length + 1 + (showUnits ? loc.batches.length : 0);

  const handleSave = async () => {
    try {
      for (const loc of locationRows) {
        const locObj = locations.find((l) => l.id === loc.locationId);
        const locName = locObj?.name || 'Selected Location';
        const declared = parseFloat(loc.openingStock) || 0;
        const valuePerUnit = parseFloat(loc.openingStockValue) || 0;

        if (isBatchTracked) {
          const batchSum = loc.batches.reduce(
            (acc, b) => acc + (parseFloat(String(b.quantityIn)) || 0),
            0,
          );

          if (batchSum > 0 && declared === 0) {
            toast.error(`Please enter the Opening Stock for "${locName}".`);
            return;
          }

          if (declared > 0 && batchSum > declared) {
            toast.error(
              `Total ${singular.toLowerCase()} quantity (${batchSum}) cannot exceed location opening stock (${declared}) for "${locName}". Please adjust ${plural.toLowerCase()} quantities.`,
            );
            return;
          }
          if (declared > 0 && loc.batches.length === 0) {
            toast.error(
              `Opening stock is declared for "${locName}", but no ${singular.toLowerCase()} details were entered.`,
            );
            return;
          }

          /**
           * The package rules, checked at the row so the user is told here rather
           * than by a 400 after Save. The service enforces the same ones beside
           * the write — this dialog is not the only way stock can be declared.
           *
           * 🔴 NAMING PACKAGES IS OPTIONAL; NAMING SOME OF THEM IS NOT (2026-09-02).
           * A batch with none declares its whole quantity untagged and passes
           * untouched. Name one, and they must add up to the batch — a total below
           * it used to be legal and is not any more.
           */
          if (showUnits) {
            for (const batch of loc.batches) {
              const problem = validateBatchUnits({
                units: batch.units.map((u) => ({
                  id: u.id,
                  label: u.label,
                  quantity: u.quantityIn,
                })),
                batchQty: parseFloat(batch.quantityIn) || 0,
                batchName: batch.batchReference || singular,
                singular: unitLabel.singular,
                plural: unitLabel.plural,
              });
              if (problem) {
                toast.error(problem);
                return;
              }
            }
          }
        }

        if (declared > 0 && valuePerUnit <= 0) {
          toast.error(`Please enter a valid Per Unit Value for "${locName}".`);
          return;
        }
      }

      if (onSave) {
        /**
         * 🔴 A NEW PACKAGE MUST NOT CARRY AN ID. Every row in this grid holds a
         * client-side UUID for React's key, and sending one as `units[].id` would
         * be claiming a `batch_units` row that does not exist. The server reads an
         * unknown id as a new package and does the right thing anyway — but only
         * by accident, and it would stop being an accident the day ids collide.
         *
         * `units` is dropped entirely when the level is off, so a setting that was
         * on and is now off cannot leave stale rows riding along in the payload.
         */
        await onSave(
          locationRows.map((loc) => ({
            ...loc,
            batches: loc.batches.map((b) => ({
              ...b,
              units: showUnits
                ? b.units
                    /* 🔴 An existing package is kept whatever its boxes say — its
                       quantity cleared to zero is how the user REMOVES it, and
                       dropping the row here would leave its stock behind instead.
                       A new one is real once it has a quantity; the label stopped
                       being what makes it real on 2026-09-03. */
                    .filter(
                      (u) => u.isExisting || u.label.trim() !== '' || parseFloat(u.quantityIn) > 0,
                    )
                    .map((u) => ({
                      ...(u.isExisting ? { id: u.id } : {}),
                      label: u.label.trim(),
                      quantityIn: u.quantityIn,
                    }))
                : undefined,
            })),
          })) as ItemOpeningStockLocationRowDto[],
        );
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

  const dateCellStyle = (isExisting: boolean | undefined): React.CSSProperties => ({
    ...inputStyle,
    ...(isExisting ? { background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' } : {}),
  });

  /** The batch whose package dialog is open, re-read from state each render so the
   * dialog shows live rows rather than a snapshot taken when it opened. */
  const unitsBatch = unitsFor
    ? (locationRows
        .find((r) => r.id === unitsFor.locationId)
        ?.batches.find((b) => b.id === unitsFor.batchId) ?? null)
    : null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={itemName || 'Add Opening Stock'}
        subtitle={
          isBatchTracked
            ? `Enter location stock and ${singular.toLowerCase()} details, then save to persist them.`
            : 'Enter location stock details, then save to persist them.'
        }
        width="1300px"
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
        <div style={{ overflowX: 'auto', minHeight: '500px' }}>
          {!isBatchTracked ? (
            <div className="responsive-table-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th
                      style={{
                        padding: '10px 12px',
                        border: '1px solid #eef0f3',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        textAlign: 'left',
                        width: '35%',
                      }}
                    >
                      Location
                    </th>
                    <th
                      style={{
                        padding: '10px 12px',
                        border: '1px solid #eef0f3',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        textAlign: 'right',
                        width: '30%',
                      }}
                    >
                      Opening Stock
                      {locationRows.length > 1 && (
                        <div>
                          <button
                            type="button"
                            onClick={handleCopyOpeningStockToAll}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#0062ff',
                              fontSize: '10px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              textTransform: 'uppercase',
                              marginTop: '2px',
                            }}
                          >
                            COPY TO ALL
                          </button>
                        </div>
                      )}
                    </th>
                    <th
                      style={{
                        padding: '10px 12px',
                        border: '1px solid #eef0f3',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        textAlign: 'right',
                        width: '30%',
                      }}
                    >
                      Opening Stock Value
                      <br />
                      per unit
                      {locationRows.length > 1 && (
                        <div>
                          <button
                            type="button"
                            onClick={handleCopyOpeningStockValueToAll}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#0062ff',
                              fontSize: '10px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              textTransform: 'uppercase',
                              marginTop: '2px',
                            }}
                          >
                            COPY TO ALL
                          </button>
                        </div>
                      )}
                    </th>
                    <th
                      style={{
                        padding: '10px 12px',
                        border: '1px solid #eef0f3',
                        width: '5%',
                        textAlign: 'center',
                      }}
                    />
                  </tr>
                </thead>
                <tbody>
                  {locationRows.map((loc) => (
                    <tr key={loc.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                      <td
                        style={{
                          padding: '8px 12px',
                          verticalAlign: 'middle',
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
                        style={{
                          padding: '8px 12px',
                          verticalAlign: 'middle',
                          borderRight: '1px solid #eef0f3',
                        }}
                      >
                        <input
                          type="number"
                          step="any"
                          value={loc.openingStock}
                          placeholder="0"
                          onChange={(e) => updateLocation(loc.id, 'openingStock', e.target.value)}
                          style={rightAlignStyle}
                          onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                          onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                        />
                      </td>
                      <td
                        style={{
                          padding: '8px 12px',
                          verticalAlign: 'middle',
                          borderRight: '1px solid #eef0f3',
                        }}
                      >
                        <input
                          type="number"
                          step="any"
                          value={loc.openingStockValue}
                          placeholder="0"
                          onChange={(e) =>
                            updateLocation(loc.id, 'openingStockValue', e.target.value)
                          }
                          style={rightAlignStyle}
                          onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                          onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                        />
                      </td>
                      <td
                        style={{
                          padding: '8px 12px',
                          textAlign: 'center',
                          verticalAlign: 'middle',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleDeleteLocation(loc.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#ef4444',
                            padding: '6px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '4px',
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="responsive-table-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1200px' }}>
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
                      {singular} Reference#*
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
                      Manufacturer {singular}#
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
                    <th
                      style={{
                        padding: '8px',
                        borderBottom: '1px solid #eef0f3',
                        minWidth: '40px',
                      }}
                    />
                  </tr>
                </thead>
                {locationRows.map((loc) => (
                  <tbody key={loc.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                    {loc.batches.length === 0 && (
                      <tr>
                        <td
                          rowSpan={2}
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
                          rowSpan={2}
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
                          rowSpan={2}
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
                        <td
                          colSpan={8}
                          style={{
                            padding: '16px',
                            textAlign: 'center',
                            color: '#64748b',
                            fontSize: '13px',
                            borderRight: '1px solid #eef0f3',
                          }}
                        >
                          No {plural.toLowerCase()} added. Click 'New {singular}' to add one.
                        </td>
                        <td
                          rowSpan={2}
                          style={{ padding: '8px', textAlign: 'center', verticalAlign: 'top' }}
                        >
                          <button
                            type="button"
                            onClick={() => handleDeleteLocation(loc.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: '#ef4444',
                              padding: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '4px',
                              transition: 'background-color 0.2s',
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    )}
                    {loc.batches.map((batch, batchIndex) => (
                      <Fragment key={batch.id}>
                        <tr>
                          {batchIndex === 0 && (
                            <>
                              <td
                                rowSpan={locRowSpan(loc)}
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
                                rowSpan={locRowSpan(loc)}
                                style={{
                                  padding: '8px',
                                  verticalAlign: 'top',
                                  borderRight: '1px solid #eef0f3',
                                }}
                              >
                                <input
                                  type="number"
                                  value={loc.openingStock}
                                  onChange={(e) =>
                                    updateLocation(loc.id, 'openingStock', e.target.value)
                                  }
                                  style={rightAlignStyle}
                                  onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                                  onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                                />
                              </td>
                              <td
                                rowSpan={locRowSpan(loc)}
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
                          <td style={{ padding: '8px', position: 'relative' }}>
                            <input
                              type="text"
                              value={batch.batchReference}
                              placeholder={`Enter ${singular}#`}
                              disabled={batch.isExisting}
                              onChange={(e) =>
                                updateBatch(loc.id, batch.id, 'batchReference', e.target.value)
                              }
                              style={{
                                ...inputStyle,
                                ...(batch.isExisting
                                  ? {
                                      background: '#f8fafc',
                                      color: '#64748b',
                                      cursor: 'not-allowed',
                                    }
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
                              type="text"
                              value={batch.manufacturerBatch}
                              placeholder={`Enter MFR ${singular}#`}
                              disabled={batch.isExisting}
                              onChange={(e) =>
                                updateBatch(loc.id, batch.id, 'manufacturerBatch', e.target.value)
                              }
                              style={{
                                ...inputStyle,
                                ...(batch.isExisting
                                  ? {
                                      background: '#f8fafc',
                                      color: '#64748b',
                                      cursor: 'not-allowed',
                                    }
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
                              onChange={(next) =>
                                updateBatch(loc.id, batch.id, 'manufacturedDate', next)
                              }
                              ariaLabel="Manufactured date"
                              style={dateCellStyle(batch.isExisting)}
                              portal
                            />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <DateInput
                              value={batch.expiryDate}
                              disabled={batch.isExisting}
                              onChange={(next) => updateBatch(loc.id, batch.id, 'expiryDate', next)}
                              ariaLabel="Expiry date"
                              style={dateCellStyle(batch.isExisting)}
                              portal
                            />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <input
                              type="number"
                              value={batch.sellingPrice}
                              disabled={batch.isExisting}
                              onChange={(e) =>
                                updateBatch(loc.id, batch.id, 'sellingPrice', e.target.value)
                              }
                              style={{
                                ...rightAlignStyle,
                                ...(batch.isExisting
                                  ? {
                                      background: '#f8fafc',
                                      color: '#64748b',
                                      cursor: 'not-allowed',
                                    }
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
                              value={batch.mrp}
                              disabled={batch.isExisting}
                              onChange={(e) => updateBatch(loc.id, batch.id, 'mrp', e.target.value)}
                              style={{
                                ...rightAlignStyle,
                                ...(batch.isExisting
                                  ? {
                                      background: '#f8fafc',
                                      color: '#64748b',
                                      cursor: 'not-allowed',
                                    }
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
                              value={batch.quantityIn}
                              onChange={(e) =>
                                updateBatch(loc.id, batch.id, 'quantityIn', e.target.value)
                              }
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
                              rowSpan={locRowSpan(loc)}
                              style={{ padding: '8px', textAlign: 'center', verticalAlign: 'top' }}
                            >
                              <button
                                type="button"
                                onClick={() => handleDeleteLocation(loc.id)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: '#ef4444',
                                  padding: '8px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  borderRadius: '4px',
                                  transition: 'background-color 0.2s',
                                }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          )}
                        </tr>

                        {/* ── The level BELOW this batch ────────────────────────────
                      A sub-grid rather than extra columns: a batch's packages are
                      a variable-length list, and flattening them into the row
                      above would make every batch as wide as its longest
                      neighbour.

                      🔴 DOM order IS tab order, so this sits immediately after
                      the batch it belongs to — Tab walks the batch fields, then
                      its packages, then the next batch. */}
                        {showUnits && (
                          <tr>
                            <td colSpan={8} style={{ padding: '0 8px 10px' }}>
                              <BatchUnitsTrigger
                                count={batch.units.length}
                                singular={unitLabel.singular}
                                plural={unitLabel.plural}
                                onOpen={() => openUnits(loc.id, batch.id)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
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
                            New {singular}
                          </button>
                          <div
                            style={{
                              display: 'flex',
                              gap: '16px',
                              fontSize: '12px',
                              color: '#f59e0b',
                            }}
                          >
                            <span>Quantity To Be Added: {loc.openingStock || 0}</span>
                            {(() => {
                              const declared = parseFloat(loc.openingStock || '0') || 0;
                              const batchSum = loc.batches.reduce(
                                (acc, b) => acc + (parseFloat(String(b.quantityIn)) || 0),
                                0,
                              );
                              const isExceeded = declared > 0 && batchSum > declared;
                              return (
                                <span
                                  style={{
                                    color: isExceeded ? '#ef4444' : '#16a34a',
                                    fontWeight: 600,
                                  }}
                                >
                                  Added Qty to Location : {batchSum}
                                  {isExceeded && (
                                    <span
                                      style={{
                                        marginLeft: '6px',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                      }}
                                    >
                                      (Exceeds Opening Stock!)
                                    </span>
                                  )}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                ))}
              </table>
            </div>
          )}
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

      {unitsFor && unitsBatch && (
        <BatchUnitsModal
          isOpen
          onClose={() => setUnitsFor(null)}
          batchName={unitsBatch.batchReference?.trim() || singular}
          batchSingular={singular}
          singular={unitLabel.singular}
          plural={unitLabel.plural}
          batchQty={parseFloat(unitsBatch.quantityIn) || 0}
          units={unitsBatch.units.map((u) => ({
            id: u.id,
            label: u.label,
            quantity: u.quantityIn,
          }))}
          /* No "Existing {unit}" here: opening stock DECLARES what is on hand, so
           every package it names is one this document owns — the top-up case
           belongs to documents that receive goods. */
          onAdd={() => handleAddUnit(unitsFor.locationId, unitsFor.batchId)}
          onChange={(unitId, field, value) =>
            updateUnit(
              unitsFor.locationId,
              unitsFor.batchId,
              unitId,
              field === 'label' ? 'label' : 'quantityIn',
              value,
            )
          }
          onRemove={(unitId) => handleDeleteUnit(unitsFor.locationId, unitsFor.batchId, unitId)}
        />
      )}
    </>
  );
}
