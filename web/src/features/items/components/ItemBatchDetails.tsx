import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, useEffect } from 'react';
import {
  Plus,
  Layers,
  ChevronDown,
  HelpCircle,
  Pencil,
  XCircle,
  CheckCircle2,
  Trash2,
  ArrowUpDown,
  SlidersHorizontal,
} from 'lucide-react';
import { fetchLocations } from '../../configuration/locations/locations.api';
import { itemsApi } from '../items.api';
import { AddOpeningStockModal } from './AddOpeningStockModal';
import { Select } from '../../../components/ui/Select';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import type { ColumnDef } from '../../list-views/listViews.api';
import type { ItemOpeningStockLocationRowDto } from '../items.schemas';

interface ItemBatchDetailsProps {
  orgId: string;
  itemId: string;
  unit?: string | null;
}

export interface FlattenedBatchItem {
  id: string;
  locationId: string;
  locationName: string;
  batchReference: string;
  manufacturerBatch: string;
  manufacturedDate: string;
  expiryDate: string;
  sellingPrice: string | number | null;
  mrp: string | number | null;
  quantityIn: number;
}

const BATCH_COLUMNS_CATALOG: ColumnDef[] = [
  { key: 'batchReference', label: 'BATCH REFERENCE#', locked: true },
  { key: 'manufacturerBatch', label: 'MANUFACTURER BATCH #' },
  { key: 'manufacturedDate', label: 'MANUFACTURED DATE' },
  { key: 'expiryDate', label: 'EXPIRY DATE' },
  { key: 'quantityIn', label: 'QUANTITY IN' },
  { key: 'quantityAvailable', label: 'QUANTITY AVAILABLE' },
  { key: 'sellingPrice', label: 'SELLING PRICE' },
  { key: 'mrp', label: 'MRP' },
];

export function ItemBatchDetails({ orgId, itemId, unit: _unit }: ItemBatchDetailsProps) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('all');
  const [showEmptyBatches, setShowEmptyBatches] = useState<boolean>(false);
  const [isOpeningStockModalOpen, setIsOpeningStockModalOpen] = useState(false);
  const [isColumnsModalOpen, setIsColumnsModalOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    BATCH_COLUMNS_CATALOG.map((c) => c.key),
  );
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [inactiveBatchIds, setInactiveBatchIds] = useState<Set<string>>(new Set());

  const { data: locations = [], isLoading: isLocationsLoading } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId),
    enabled: !!orgId,
  });

  const { data: openingStockRows = [], isLoading: isOpeningStockLoading } = useQuery({
    queryKey: ['itemOpeningStock', orgId, itemId],
    queryFn: () => itemsApi.getOpeningStock(orgId, itemId),
    enabled: !!orgId && !!itemId,
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (openDropdownId && !(e.target as HTMLElement).closest('.batch-row-action-menu')) {
        setOpenDropdownId(null);
      }
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [openDropdownId]);

  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of locations) {
      map.set(loc.id, loc.name);
    }
    return map;
  }, [locations]);

  const saveOpeningStockMutation = useMutation({
    mutationFn: (rows: ItemOpeningStockLocationRowDto[]) =>
      itemsApi.saveOpeningStock(orgId, itemId, { locationRows: rows }),
    onSuccess: async (savedRows) => {
      const nextRows = Array.isArray(savedRows) ? savedRows : [];
      queryClient.setQueryData(['itemOpeningStock', orgId, itemId], nextRows);
      await queryClient.invalidateQueries({ queryKey: ['itemOpeningStock', orgId, itemId] });
      await queryClient.invalidateQueries({ queryKey: ['item', orgId, itemId] });
      setIsOpeningStockModalOpen(false);
    },
  });

  const handleToggleInactiveBatch = (batch: FlattenedBatchItem) => {
    setInactiveBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batch.id)) {
        next.delete(batch.id);
      } else {
        next.add(batch.id);
      }
      return next;
    });
  };

  const handleDeleteBatch = async (batch: FlattenedBatchItem) => {
    if (!window.confirm(`Are you sure you want to delete batch "${batch.batchReference}"?`)) {
      return;
    }
    const currentRows = Array.isArray(openingStockRows) ? openingStockRows : [];
    const updatedRows = currentRows.map((row) => {
      if (row.locationId !== batch.locationId) return row;
      const remainingBatches = row.batches.filter((b) => {
        if (b.id && batch.id && b.id === batch.id) return false;
        if (b.batchReference === batch.batchReference) return false;
        return true;
      });
      return {
        ...row,
        batches: remainingBatches,
      };
    });

    await saveOpeningStockMutation.mutateAsync(updatedRows);
  };

  const allBatches = useMemo<FlattenedBatchItem[]>(() => {
    const list: FlattenedBatchItem[] = [];
    const rows = Array.isArray(openingStockRows) ? openingStockRows : [];

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx];
      const locName = locationMap.get(row.locationId) || 'Unknown Location';
      const batches = Array.isArray(row.batches) ? row.batches : [];

      for (let bIdx = 0; bIdx < batches.length; bIdx++) {
        const b = batches[bIdx];
        const qty = Number(b.quantityIn) || 0;
        list.push({
          id: b.id || `${row.locationId}-${b.batchReference || 'nobatch'}-${rIdx}-${bIdx}`,
          locationId: row.locationId,
          locationName: locName,
          batchReference: b.batchReference || '-',
          manufacturerBatch: b.manufacturerBatch || '-',
          manufacturedDate: b.manufacturedDate || '-',
          expiryDate: b.expiryDate || '-',
          sellingPrice: b.sellingPrice ?? null,
          mrp: b.mrp ?? null,
          quantityIn: qty,
        });
      }
    }
    return list;
  }, [openingStockRows, locationMap]);

  const filteredBatches = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];

    return allBatches.filter((b) => {
      const isMarkedInactive = inactiveBatchIds.has(b.id);
      const isExpired = b.expiryDate && b.expiryDate !== '-' && b.expiryDate < todayStr;
      const isInactive = isMarkedInactive || isExpired || b.quantityIn <= 0;

      // 1. Show Empty Batches Filter
      if (!showEmptyBatches && b.quantityIn <= 0) {
        return false;
      }

      // 2. Location Filter
      if (selectedLocationId !== 'all' && b.locationId !== selectedLocationId) {
        return false;
      }

      // 3. Status Filter
      if (statusFilter === 'active') {
        if (isInactive) return false;
      } else if (statusFilter === 'inactive') {
        if (!isInactive) return false;
      }

      return true;
    });
  }, [allBatches, showEmptyBatches, selectedLocationId, statusFilter, inactiveBatchIds]);

  const isLoading = isLocationsLoading || isOpeningStockLoading;

  const isColVisible = (key: string) => visibleColumns.includes(key);

  const statusOptions = [
    { value: 'all', label: 'All Batches' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
  ];

  const locationOptions = useMemo(() => {
    return [
      { value: 'all', label: 'Location: All Locations' },
      ...locations.map((loc) => ({
        value: loc.id,
        label: `Location: ${loc.name}`,
      })),
    ];
  }, [locations]);

  return (
    <div style={{ padding: '0 24px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <Select
            value={statusFilter}
            onChange={(val) => setStatusFilter(val as 'all' | 'active' | 'inactive')}
            options={statusOptions}
            minWidth={140}
            fullWidth={false}
          />
          <Select
            value={selectedLocationId}
            onChange={(val) => setSelectedLocationId(val)}
            options={locationOptions}
            minWidth={180}
            fullWidth={false}
          />
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: '#475569',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={showEmptyBatches}
              onChange={(e) => setShowEmptyBatches(e.target.checked)}
              style={{ accentColor: '#16a34a', width: '14px', height: '14px', cursor: 'pointer' }}
            />
            <span>Show Empty Batches</span>
            <span
              title="Select this option to display batches with zero quantity"
              style={{ display: 'inline-flex', alignItems: 'center' }}
            >
              <HelpCircle size={14} style={{ color: '#94a3b8', cursor: 'help' }} />
            </span>
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={() => setIsColumnsModalOpen(true)}
            title="Customize Columns"
            aria-label="Customize Columns"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              cursor: 'pointer',
              color: '#64748b',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#94a3b8';
              e.currentTarget.style.color = '#334155';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#cbd5e1';
              e.currentTarget.style.color = '#64748b';
            }}
          >
            <SlidersHorizontal size={15} />
          </button>

          <button
            type="button"
            onClick={() => setIsOpeningStockModalOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 16px',
              height: '32px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#fff',
              background: '#15803d',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#166534';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#15803d';
            }}
          >
            <Plus size={16} />
            New
          </button>
        </div>
      </div>

      <div
        style={{
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        {isLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
            Loading batch details...
          </div>
        ) : filteredBatches.length === 0 ? (
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b',
              }}
            >
              <Layers size={24} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 500, color: '#334155' }}>
              No matching batches found
            </div>
            <div style={{ fontSize: '13px', color: '#64748b', maxWidth: '400px' }}>
              Click "+ New" to add batch references, mfg/expiry dates, and quantities per location.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                textAlign: 'left',
                tableLayout: 'auto',
              }}
            >
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  {isColVisible('batchReference') && (
                    <th
                      style={{
                        padding: '12px 16px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        BATCH REFERENCE#
                        <ArrowUpDown size={12} style={{ color: '#94a3b8' }} />
                      </div>
                    </th>
                  )}
                  {isColVisible('manufacturerBatch') && (
                    <th
                      style={{
                        padding: '12px 16px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                      }}
                    >
                      MANUFACTURER BATCH #
                    </th>
                  )}
                  {isColVisible('manufacturedDate') && (
                    <th
                      style={{
                        padding: '12px 16px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                      }}
                    >
                      MANUFACTURED DATE
                    </th>
                  )}
                  {isColVisible('expiryDate') && (
                    <th
                      style={{
                        padding: '12px 16px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                      }}
                    >
                      EXPIRY DATE
                    </th>
                  )}
                  {isColVisible('quantityIn') && (
                    <th
                      style={{
                        padding: '12px 16px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                        textAlign: 'right',
                      }}
                    >
                      QUANTITY IN
                    </th>
                  )}
                  {isColVisible('quantityAvailable') && (
                    <th
                      style={{
                        padding: '12px 16px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                        textAlign: 'right',
                      }}
                    >
                      QUANTITY AVAILABLE
                    </th>
                  )}
                  {isColVisible('sellingPrice') && (
                    <th
                      style={{
                        padding: '12px 16px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                        textAlign: 'right',
                      }}
                    >
                      SELLING PRICE
                    </th>
                  )}
                  {isColVisible('mrp') && (
                    <th
                      style={{
                        padding: '12px 16px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                        textAlign: 'right',
                      }}
                    >
                      MRP
                    </th>
                  )}
                  <th style={{ padding: '12px 16px', width: '40px', minWidth: '40px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.map((batch, index) => {
                  const isHovered = hoveredRowId === batch.id;
                  const isDropdownOpen = openDropdownId === batch.id;
                  const isMarkedInactive = inactiveBatchIds.has(batch.id);

                  return (
                    <tr
                      key={batch.id}
                      onMouseEnter={() => setHoveredRowId(batch.id)}
                      onMouseLeave={() => setHoveredRowId(null)}
                      style={{
                        borderBottom:
                          index === filteredBatches.length - 1 ? 'none' : '1px solid #f1f5f9',
                        background: isHovered || isDropdownOpen ? '#f8fafc' : '#fff',
                        height: '44px',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      {isColVisible('batchReference') && (
                        <td
                          style={{
                            padding: '10px 16px',
                            fontSize: '13px',
                            fontWeight: 500,
                            color: isMarkedInactive ? '#94a3b8' : '#0284c7',
                            maxWidth: '220px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={batch.batchReference}
                        >
                          <span
                            style={{ textDecoration: isMarkedInactive ? 'line-through' : 'none' }}
                          >
                            {batch.batchReference}
                          </span>
                          {isMarkedInactive && (
                            <span
                              style={{
                                marginLeft: '6px',
                                fontSize: '10px',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                background: '#f1f5f9',
                                color: '#64748b',
                                fontWeight: 500,
                              }}
                            >
                              Inactive
                            </span>
                          )}
                        </td>
                      )}
                      {isColVisible('manufacturerBatch') && (
                        <td
                          style={{
                            padding: '10px 16px',
                            fontSize: '13px',
                            color: '#475569',
                            maxWidth: '220px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={batch.manufacturerBatch}
                        >
                          {batch.manufacturerBatch}
                        </td>
                      )}
                      {isColVisible('manufacturedDate') && (
                        <td style={{ padding: '10px 16px', fontSize: '13px', color: '#64748b' }}>
                          {batch.manufacturedDate}
                        </td>
                      )}
                      {isColVisible('expiryDate') && (
                        <td style={{ padding: '10px 16px', fontSize: '13px', color: '#64748b' }}>
                          {batch.expiryDate}
                        </td>
                      )}
                      {isColVisible('quantityIn') && (
                        <td
                          style={{
                            padding: '10px 16px',
                            fontSize: '13px',
                            color: '#334155',
                            textAlign: 'right',
                          }}
                        >
                          {batch.quantityIn.toLocaleString()}
                        </td>
                      )}
                      {isColVisible('quantityAvailable') && (
                        <td
                          style={{
                            padding: '10px 16px',
                            fontSize: '13px',
                            fontWeight: 600,
                            color: '#0f172a',
                            textAlign: 'right',
                          }}
                        >
                          {batch.quantityIn.toLocaleString()}
                        </td>
                      )}
                      {isColVisible('sellingPrice') && (
                        <td
                          style={{
                            padding: '10px 16px',
                            fontSize: '13px',
                            color: '#334155',
                            textAlign: 'right',
                          }}
                        >
                          {batch.sellingPrice !== null && batch.sellingPrice !== ''
                            ? `₹${Number(batch.sellingPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                            : '-'}
                        </td>
                      )}
                      {isColVisible('mrp') && (
                        <td
                          style={{
                            padding: '10px 16px',
                            fontSize: '13px',
                            color: '#334155',
                            textAlign: 'right',
                          }}
                        >
                          {batch.mrp !== null && batch.mrp !== ''
                            ? `₹${Number(batch.mrp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                            : '-'}
                        </td>
                      )}
                      <td
                        style={{
                          padding: '0 12px',
                          width: '40px',
                          minWidth: '40px',
                          textAlign: 'right',
                          verticalAlign: 'middle',
                        }}
                      >
                        <div
                          className="batch-row-action-menu"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                            width: '26px',
                            height: '26px',
                            opacity: isHovered || isDropdownOpen ? 1 : 0,
                            pointerEvents: isHovered || isDropdownOpen ? 'auto' : 'none',
                            transition: 'opacity 0.15s ease',
                          }}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownId(isDropdownOpen ? null : batch.id);
                            }}
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '50%',
                              background: '#2563eb',
                              border: 'none',
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                            }}
                          >
                            <ChevronDown size={14} />
                          </button>

                          {/* Dropdown Menu (Opens to the LEFT side without overlapping the action button) */}
                          {isDropdownOpen && (
                            <div
                              style={{
                                position: 'absolute',
                                right: 'calc(100% + 8px)',
                                top: 0,
                                background: '#fff',
                                border: '1px solid #cbd5e1',
                                borderRadius: '8px',
                                boxShadow:
                                  '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                                zIndex: 100,
                                minWidth: '150px',
                                padding: '4px 0',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenDropdownId(null);
                                  setIsOpeningStockModalOpen(true);
                                }}
                                style={{
                                  width: '100%',
                                  padding: '8px 14px',
                                  fontSize: '13px',
                                  color: '#334155',
                                  background: 'transparent',
                                  border: 'none',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = '#f1f5f9';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = 'transparent';
                                }}
                              >
                                <Pencil size={13} style={{ color: '#64748b' }} />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenDropdownId(null);
                                  handleToggleInactiveBatch(batch);
                                }}
                                style={{
                                  width: '100%',
                                  padding: '8px 14px',
                                  fontSize: '13px',
                                  color: '#334155',
                                  background: 'transparent',
                                  border: 'none',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = '#f1f5f9';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = 'transparent';
                                }}
                              >
                                {isMarkedInactive ? (
                                  <>
                                    <CheckCircle2 size={13} style={{ color: '#16a34a' }} />
                                    Mark as Active
                                  </>
                                ) : (
                                  <>
                                    <XCircle size={13} style={{ color: '#64748b' }} />
                                    Mark as Inactive
                                  </>
                                )}
                              </button>
                              <div
                                style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }}
                              />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenDropdownId(null);
                                  handleDeleteBatch(batch);
                                }}
                                style={{
                                  width: '100%',
                                  padding: '8px 14px',
                                  fontSize: '13px',
                                  color: '#ef4444',
                                  background: 'transparent',
                                  border: 'none',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = '#fef2f2';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = 'transparent';
                                }}
                              >
                                <Trash2 size={13} />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isOpeningStockModalOpen && (
        <AddOpeningStockModal
          isOpen={isOpeningStockModalOpen}
          onClose={() => setIsOpeningStockModalOpen(false)}
          orgId={orgId}
          initialRows={openingStockRows}
          onSave={async (rows) => {
            await saveOpeningStockMutation.mutateAsync(rows);
          }}
          isSaving={saveOpeningStockMutation.isPending}
        />
      )}

      {isColumnsModalOpen && (
        <CustomizeColumnsModal
          isOpen={isColumnsModalOpen}
          onClose={() => setIsColumnsModalOpen(false)}
          catalog={BATCH_COLUMNS_CATALOG}
          visible={visibleColumns}
          onSave={(cols) => {
            setVisibleColumns(cols);
            setIsColumnsModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
