import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { DateInput } from '../../components/ui/DateInput';
import { Select } from '../../components/ui/Select';
import { Trash2, Plus, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchLocations } from '../configuration/locations/locations.api';
import { itemsApi } from './items.api';
import { useTrackingLabel } from '../../hooks/useTrackingLabel';
import type { ItemOpeningStockLocationRowDto } from './items.schemas';

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
}

export interface OpeningStockLocationRow {
  id: string;
  locationId: string;
  openingStock: string;
  openingStockValue: string;
  batches: OpeningStockBatchRow[];
}

const createEmptyBatch = (defaultSellingPrice = '', defaultMrp = ''): OpeningStockBatchRow => ({
  id: crypto.randomUUID(),
  batchReference: '',
  manufacturerBatch: '',
  manufacturedDate: '',
  expiryDate: '',
  sellingPrice: defaultSellingPrice,
  mrp: defaultMrp,
  quantityIn: '',
  isExisting: false,
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
          }))
        : []
      : [],
  }));
};

export function OpeningStockPage() {
  const { orgId, id: itemId } = useParams<{ orgId: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { singular, plural } = useTrackingLabel();

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
    mutationFn: (rows: OpeningStockLocationRow[]) => itemsApi.saveOpeningStock(orgId!, itemId!, { locationRows: rows as unknown as ItemOpeningStockLocationRowDto[] }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['itemOpeningStock', orgId, itemId] });
      await queryClient.invalidateQueries({ queryKey: ['item', orgId, itemId] });
      toast.success('Opening stock saved');
      navigate(`/organizations/${orgId}/items?id=${itemId}`);
    },
    onError: () => toast.error('Failed to save opening stock'),
  });

  const isSaving = saveOpeningStockMutation.isPending;
  const isBatchTracked = item?.inventoryTracking === 'batch';
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
      createEmptyLocation(),
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
        }

        if (declared > 0 && valuePerUnit <= 0) {
          toast.error(`Please enter a valid Per Unit Value for "${locName}".`);
          return;
        }
      }

      await saveOpeningStockMutation.mutateAsync(locationRows);
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

  return (
    <div style={{ background: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eef0f3', padding: '16px 24px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#0f172a', margin: 0 }}>{itemName || 'Opening Stock'}</h1>
        <button
          type="button"
          onClick={() => navigate(-1)}
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
                      onChange={(e) => updateLocation(loc.id, 'openingStockValue', e.target.value)}
                      style={rightAlignStyle}
                      onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                      onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                    />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
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
        ) : (
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
                        onChange={(next) => updateBatch(loc.id, batch.id, 'manufacturedDate', next)}
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
                        rowSpan={loc.batches.length + 1}
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
                        style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#f59e0b' }}
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

      <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '12px', padding: '8px 24px', borderTop: '1px solid #eef0f3', position: 'sticky', bottom: 0, background: '#fff', zIndex: 10 }}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            padding: '8px 16px',
            border: '1px solid #cbd5e1',
            background: '#fff',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '13px',
            color: '#334155',
            transition: 'background-color 0.2s'
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
            transition: 'background-color 0.2s'
          }}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
