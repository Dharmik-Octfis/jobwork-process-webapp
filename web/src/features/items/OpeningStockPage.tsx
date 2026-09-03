import { Fragment, useState } from 'react';
import { toast } from 'react-hot-toast';
import { DateInput } from '../../components/ui/DateInput';
import { Select } from '../../components/ui/Select';
import { Trash2, Plus, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { fetchLocations } from '../configuration/locations/locations.api';
import { itemsApi } from './items.api';
import { useTrackingLabel, useBatchUnitLabel } from '../../hooks/useTrackingLabel';
import { BatchUnitsModal, BatchUnitsTrigger } from '../../components/inventory/BatchUnitsModal';
import { validateBatchUnits } from '../../components/inventory/batchUnits';
import type { ItemOpeningStockLocationRowDto } from './items.schemas';

/** One package inside a declared batch. `id` is the real `batch_units.id` when
 * the row came back from the server — round-tripped so a save can tell "this
 * package, edited" from "a new package", exactly as the batch id does above it. */
export interface OpeningStockUnitRow {
  id: string;
  /** True once this row has a server id, i.e. it is an EDIT and not a creation. */
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
                // and is ADJUSTED rather than re-created.
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

export function OpeningStockPage() {
  const { orgId, id: itemId } = useParams<{ orgId: string; id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { singular, plural } = useTrackingLabel();
  /** 🔴 Visibility is INHERITED, not configured per item: the package level shows
   * exactly where a batch shows, so `isBatchTracked` gates it as well as the org
   * switch. `isBatchTracked` is derived from `item` below. */
  const unitLabel = useBatchUnitLabel();
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
    queryFn: () => itemsApi.getItem(orgId!, itemId!),
    enabled: !!orgId && !!itemId,
  });

  const { data: initialRows } = useQuery({
    queryKey: ['itemOpeningStock', orgId, itemId],
    queryFn: () => itemsApi.getOpeningStock(orgId!, itemId!),
    enabled: !!orgId && !!itemId,
  });

  const saveOpeningStockMutation = useMutation({
    mutationFn: (rows: ItemOpeningStockLocationRowDto[]) =>
      itemsApi.saveOpeningStock(orgId!, itemId!, { locationRows: rows }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['itemOpeningStock', orgId, itemId] });
      await queryClient.invalidateQueries({ queryKey: ['item', orgId, itemId] });
      navigate(`/organizations/${orgId}/items?id=${itemId}`);
    },
  });

  const isSaving = saveOpeningStockMutation.isPending;
  const isBatchTracked = item?.inventoryTracking === 'batch';
  const showUnits = unitLabel.enabled && isBatchTracked;
  const itemName = item?.name;

  const defaultSellingPrice =
    item?.sellingPrice !== undefined && item?.sellingPrice !== null
      ? String(item.sellingPrice)
      : '';

  const defaultMrp =
    item?.mrp !== undefined && item?.mrp !== null && String(item.mrp) !== ''
      ? String(item.mrp)
      : defaultSellingPrice;

  const [locationRows, setLocationRows] = useState<OpeningStockLocationRow[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  if (initialRows && item && !isInitialized) {
    setLocationRows(toFormRows(initialRows, isBatchTracked, defaultSellingPrice, defaultMrp));
    setIsInitialized(true);
  }

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: !!orgId,
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
   * short and the table shears sideways by one cell per open batch.
   */
  const locRowSpan = (loc: OpeningStockLocationRow) =>
    loc.batches.length + 1 + (showUnits ? loc.batches.length : 0);

  const handleSave = async () => {
    try {
      for (const loc of locationRows) {
        if (!loc.locationId) {
          toast.error('Please select a location.');
          return;
        }

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
           * The package rules, stated once in `batchUnits.ts` and enforced again
           * beside the write — this page is not the only way stock is declared.
           *
           * 🔴 NAMING PACKAGES IS OPTIONAL; NAMING SOME OF THEM IS NOT (2026-09-02).
           * A batch with none declares its whole quantity untagged and passes
           * untouched. Name one, and they must add up to the batch.
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

      /** 🔴 A NEW PACKAGE MUST NOT CARRY AN ID — every row here holds a client-side
       * UUID for React's key, and sending one would claim a `batch_units` row that
       * does not exist. `units` is dropped entirely when the level is off. */
      await saveOpeningStockMutation.mutateAsync(
        locationRows.map((loc) => ({
          ...loc,
          batches: loc.batches.map((b) => ({
            ...b,
            units: showUnits
              ? b.units
                  /* 🔴 An existing package is kept whatever its boxes say — its
                     quantity cleared to zero is how the user REMOVES it, and
                     dropping the row here would leave its stock behind instead. A
                     new one is real once it has a quantity; the label stopped
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
    <div
      style={{ background: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #eef0f3',
          padding: '16px 24px',
        }}
      >
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#0f172a', margin: 0 }}>
          {itemName || 'Opening Stock'}
        </h1>
        <button
          type="button"
          onClick={() => {
            const state = location.state as { returnUrl?: string } | null;
            if (state?.returnUrl) {
              navigate(state.returnUrl);
            } else {
              navigate(-1);
            }
          }}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px',
            borderRadius: '50%',
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <X size={20} />
        </button>
      </div>

      <div style={{ overflowX: 'auto', flex: 1, padding: '24px' }}>
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
                      style={{ padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' }}
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
                        <td style={{ padding: '8px' }}>
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
                            value={batch.mrp}
                            disabled={batch.isExisting}
                            onChange={(e) => updateBatch(loc.id, batch.id, 'mrp', e.target.value)}
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
                                    style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 700 }}
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

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 24px',
          borderTop: '1px solid #eef0f3',
          position: 'sticky',
          bottom: 0,
          background: '#fff',
          zIndex: 10,
        }}
      >
        <button
          type="button"
          onClick={() =>
            (location.state as { returnUrl?: string })?.returnUrl
              ? navigate((location.state as { returnUrl?: string }).returnUrl!)
              : navigate(-1)
          }
          style={{
            padding: '8px 16px',
            border: '1px solid #cbd5e1',
            background: '#fff',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '13px',
            color: '#334155',
            transition: 'background-color 0.2s',
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
            borderRadius: '6px',
            cursor: isSaving ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            fontSize: '13px',
            opacity: isSaving ? 0.85 : 1,
            transition: 'background-color 0.2s',
          }}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {unitsFor && unitsBatch && (
        <BatchUnitsModal
          isOpen
          onClose={() => setUnitsFor(null)}
          batchRef={unitsBatch.batchReference ?? null}
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
    </div>
  );
}
