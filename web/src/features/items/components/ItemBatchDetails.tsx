import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { itemsApi } from '../items.api';
import { fetchLocations } from '../../configuration/locations/locations.api';
import { AddOpeningStockModal } from './AddOpeningStockModal';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import type { ItemOpeningStockLocationRowDto } from '../items.schemas';

interface ItemBatchDetailsProps {
  orgId: string;
  itemId: string;
  itemName?: string;
  inventoryTracking?: string | null;
}

type BatchStatusFilter = 'all' | 'active' | 'inactive' | 'empty' | 'expired';

interface BatchItem {
  id: string;
  locationId: string;
  locationName: string;
  batchNumber?: string;
  batchReference?: string;
  manufacturerBatch?: string;
  manufacturedDate?: string;
  expiryDate?: string;
  quantityIn: number;
  quantityAvailable: number;
  sellingPrice?: number | null;
  mrp?: number | null;
  isExpired: boolean;
  isInactive?: boolean;
}

interface ColumnDef {
  key: string;
  label: string;
  align: 'left' | 'right';
  width: string;
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'batchReference', label: 'BATCH REFERENCE#', align: 'left', width: '180px' },
  { key: 'manufacturerBatch', label: 'MANUFACTURER BATCH #', align: 'left', width: '180px' },
  { key: 'manufacturedDate', label: 'MANUFACTURED DATE', align: 'left', width: '150px' },
  { key: 'expiryDate', label: 'EXPIRY DATE', align: 'left', width: '150px' },
  { key: 'quantityIn', label: 'QUANTITY IN', align: 'right', width: '130px' },
  { key: 'quantityAvailable', label: 'QUANTITY AVAILABLE', align: 'right', width: '160px' },
  { key: 'sellingPrice', label: 'SELLING PRICE', align: 'right', width: '140px' },
];

export function ItemBatchDetails({
  orgId,
  itemId,
  itemName,
  inventoryTracking,
}: ItemBatchDetailsProps) {
  const queryClient = useQueryClient();
  const [selectedLocationId, setSelectedLocationId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<BatchStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpeningStockModalOpen, setIsOpeningStockModalOpen] = useState(false);
  const [activeMenuBatchId, setActiveMenuBatchId] = useState<string | null>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [batchToDelete, setBatchToDelete] = useState<BatchItem | null>(null);
  const [inactiveBatchIds, setInactiveBatchIds] = useState<Record<string, boolean>>({});

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    ALL_COLUMNS.forEach((col) => (initial[col.key] = true));
    return initial;
  });
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const columnPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenuBatchId(null);
      }
      if (columnPickerRef.current && !columnPickerRef.current.contains(event.target as Node)) {
        setIsColumnPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId),
    enabled: !!orgId,
  });

  const { data: openingStockRows = [], isLoading } = useQuery({
    queryKey: ['itemOpeningStock', orgId, itemId],
    queryFn: () => itemsApi.getOpeningStock(orgId, itemId),
    enabled: !!orgId && !!itemId,
  });

  const saveOpeningStockMutation = useMutation({
    mutationFn: (rows: ItemOpeningStockLocationRowDto[]) =>
      itemsApi.saveOpeningStock(orgId, itemId, { locationRows: rows }),
    onSuccess: async (savedRows) => {
      const nextRows = Array.isArray(savedRows) ? savedRows : [];
      queryClient.setQueryData(['itemOpeningStock', orgId, itemId], nextRows);
      await queryClient.invalidateQueries({ queryKey: ['itemOpeningStock', orgId, itemId] });
      await queryClient.invalidateQueries({ queryKey: ['item', orgId, itemId] });
    },
  });

  const allBatches = useMemo(() => {
    const list: BatchItem[] = [];
    const todayStr = new Date().toISOString().split('T')[0];

    for (const locRow of openingStockRows) {
      const loc = locations.find((l) => l.id === locRow.locationId);
      const locName = loc?.name || 'Primary Location';

      for (const b of locRow.batches || []) {
        const expDate = b.expiryDate ? String(b.expiryDate).split('T')[0] : null;
        const isExpired = !!(expDate && expDate < todayStr);
        const batchId = b.id ?? crypto.randomUUID();
        const isInactive = !!inactiveBatchIds[batchId];

        list.push({
          id: batchId,
          locationId: locRow.locationId,
          locationName: locName,
          batchNumber: b.batchNumber ?? undefined,
          batchReference: b.batchReference ?? undefined,
          manufacturerBatch: b.manufacturerBatch ?? undefined,
          manufacturedDate: b.manufacturedDate ?? undefined,
          expiryDate: b.expiryDate ?? undefined,
          quantityIn: Number(b.quantityIn ?? 0),
          quantityAvailable: isInactive ? 0 : Number(b.quantityIn ?? 0),
          sellingPrice:
            b.sellingPrice !== null && b.sellingPrice !== undefined ? Number(b.sellingPrice) : null,
          mrp: b.mrp !== null && b.mrp !== undefined ? Number(b.mrp) : null,
          isExpired,
          isInactive,
        });
      }
    }
    return list;
  }, [openingStockRows, locations, inactiveBatchIds]);

  const filteredBatches = useMemo(() => {
    return allBatches.filter((b) => {
      if (selectedLocationId !== 'all' && b.locationId !== selectedLocationId) return false;

      if (statusFilter === 'active') {
        if (b.quantityAvailable <= 0 || b.isExpired || b.isInactive) return false;
      } else if (statusFilter === 'inactive' || statusFilter === 'empty') {
        if (b.quantityAvailable > 0 && !b.isInactive) return false;
      } else if (statusFilter === 'expired') {
        if (!b.isExpired) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const refMatch = b.batchReference?.toLowerCase().includes(q);
        const numMatch = b.batchNumber?.toLowerCase().includes(q);
        const mfrMatch = b.manufacturerBatch?.toLowerCase().includes(q);
        if (!refMatch && !numMatch && !mfrMatch) return false;
      }
      return true;
    });
  }, [allBatches, selectedLocationId, statusFilter, searchQuery]);

  const activeColumns = useMemo(() => {
    return ALL_COLUMNS.filter((col) => visibleColumns[col.key]);
  }, [visibleColumns]);

  const handleEditBatch = (_batch: BatchItem) => {
    setActiveMenuBatchId(null);
    setIsOpeningStockModalOpen(true);
  };

  const handleToggleInactive = (batch: BatchItem) => {
    setActiveMenuBatchId(null);
    setInactiveBatchIds((prev) => ({
      ...prev,
      [batch.id]: !prev[batch.id],
    }));
  };

  const handleDeleteBatchConfirm = async () => {
    if (!batchToDelete) return;

    try {
      const updatedRows = openingStockRows.map((locRow) => {
        if (locRow.locationId === batchToDelete.locationId) {
          const remainingBatches = (locRow.batches || []).filter((b) => b.id !== batchToDelete.id);
          const newBatchSum = remainingBatches.reduce(
            (sum, b) => sum + (Number(b.quantityIn) || 0),
            0,
          );
          return {
            ...locRow,
            openingStock: newBatchSum,
            batches: remainingBatches,
          };
        }
        return locRow;
      });

      await saveOpeningStockMutation.mutateAsync(updatedRows);
      setBatchToDelete(null);
      setActiveMenuBatchId(null);
    } catch (error) {
      console.error('Failed to delete batch', error);
    }
  };

  const toggleColumnVisibility = (key: string) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const selectStyle = {
    height: '34px',
    padding: '0 12px',
    fontSize: '13px',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    background: '#fff',
    color: '#0f172a',
    fontWeight: 500,
    cursor: 'pointer',
    outline: 'none',
    boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ padding: '24px' }}>
      {/* Top Filter & Toolbar Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as BatchStatusFilter)}
            style={selectStyle}
          >
            <option value="all">All Batches</option>
            <option value="active">Active Batches</option>
            <option value="inactive">Inactive Batches</option>
            <option value="empty">Empty Batches</option>
            <option value="expired">Expired Batches</option>
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Location:</span>
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              style={selectStyle}
            >
              <option value="all">All</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ position: 'relative', width: '240px' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94a3b8',
              }}
            />
            <input
              type="text"
              placeholder="Find Batch Number"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                height: '34px',
                padding: '0 12px 0 32px',
                fontSize: '13px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                outline: 'none',
                background: '#fff',
                color: '#0f172a',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Column Customizer Toggle Button */}
          <div style={{ position: 'relative' }} ref={columnPickerRef}>
            <button
              type="button"
              onClick={() => setIsColumnPickerOpen(!isColumnPickerOpen)}
              title="Customize Columns"
              aria-label="Customize Columns"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '34px',
                height: '34px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: isColumnPickerOpen ? '#f1f5f9' : '#ffffff',
                cursor: 'pointer',
                color: '#475569',
                boxSizing: 'border-box',
              }}
            >
              <SlidersHorizontal size={15} />
            </button>

            {isColumnPickerOpen && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '40px',
                  width: '210px',
                  background: '#ffffff',
                  borderRadius: '8px',
                  boxShadow: '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)',
                  border: '1px solid #cbd5e1',
                  zIndex: 1000,
                  padding: '12px',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#64748b',
                    textTransform: 'uppercase',
                    marginBottom: '10px',
                    letterSpacing: '0.04em',
                  }}
                >
                  Customize Columns
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {ALL_COLUMNS.map((col) => (
                    <label
                      key={col.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '13px',
                        color: '#334155',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!visibleColumns[col.key]}
                        onChange={() => toggleColumnVisibility(col.key)}
                        style={{ borderRadius: '3px', cursor: 'pointer' }}
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsOpeningStockModalOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: '34px',
              background: '#15803d',
              color: '#fff',
              border: 'none',
              padding: '0 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              boxSizing: 'border-box',
            }}
          >
            <Plus size={16} />
            New
          </button>
        </div>
      </div>

      {/* Table Container with Horizontal Scroll support */}
      <div
        style={{
          border: '1px solid #eef0f3',
          borderRadius: '6px',
          overflowX: 'auto',
          background: '#ffffff',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'auto' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #eef0f3' }}>
              {activeColumns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    padding: '11px 16px',
                    textAlign: col.align,
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#64748b',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    minWidth: col.width,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.label}
                </th>
              ))}
              {/* Reserved Action Header Column - Fixed Width 44px */}
              <th style={{ padding: '11px 8px', width: '44px', minWidth: '44px', maxWidth: '44px' }} />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={activeColumns.length + 1}
                  style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}
                >
                  Loading batch details...
                </td>
              </tr>
            ) : filteredBatches.length === 0 ? (
              <tr>
                <td
                  colSpan={activeColumns.length + 1}
                  style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}
                >
                  No batch details found.
                </td>
              </tr>
            ) : (
              filteredBatches.map((b) => {
                const isHovered = hoveredRowId === b.id;
                const isMenuOpen = activeMenuBatchId === b.id;

                return (
                  <tr
                    key={b.id}
                    onMouseEnter={() => setHoveredRowId(b.id)}
                    onMouseLeave={() => setHoveredRowId(null)}
                    style={{
                      borderBottom: '1px solid #eef0f3',
                      background: isHovered || isMenuOpen ? '#f8fafc' : '#ffffff',
                      transition: 'background 0.15s',
                    }}
                  >
                    {visibleColumns.batchReference && (
                      <td style={{ padding: '12px 16px', color: '#0062ff', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {b.batchReference || b.batchNumber || '-'}
                      </td>
                    )}
                    {visibleColumns.manufacturerBatch && (
                      <td style={{ padding: '12px 16px', color: '#334155', whiteSpace: 'nowrap' }}>
                        {b.manufacturerBatch || '-'}
                      </td>
                    )}
                    {visibleColumns.manufacturedDate && (
                      <td style={{ padding: '12px 16px', color: '#334155', whiteSpace: 'nowrap' }}>
                        {b.manufacturedDate || '-'}
                      </td>
                    )}
                    {visibleColumns.expiryDate && (
                      <td style={{ padding: '12px 16px', color: b.isExpired ? '#ef4444' : '#334155', whiteSpace: 'nowrap' }}>
                        {b.expiryDate || '-'}
                        {b.isExpired && (
                          <span
                            style={{
                              marginLeft: '6px',
                              fontSize: '10px',
                              background: '#fef2f2',
                              color: '#ef4444',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontWeight: 600,
                            }}
                          >
                            Expired
                          </span>
                        )}
                      </td>
                    )}
                    {visibleColumns.quantityIn && (
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#334155', whiteSpace: 'nowrap' }}>
                        {b.quantityIn}
                      </td>
                    )}
                    {visibleColumns.quantityAvailable && (
                      <td
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          color: b.quantityAvailable <= 0 ? '#64748b' : '#0f172a',
                          fontWeight: b.quantityAvailable > 0 ? 500 : 400,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {b.quantityAvailable}
                        {b.isInactive && (
                          <span
                            style={{
                              marginLeft: '6px',
                              fontSize: '10px',
                              background: '#f1f5f9',
                              color: '#64748b',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontWeight: 500,
                            }}
                          >
                            Inactive
                          </span>
                        )}
                      </td>
                    )}
                    {visibleColumns.sellingPrice && (
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#334155', whiteSpace: 'nowrap' }}>
                        {b.sellingPrice !== null
                          ? `₹${b.sellingPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                          : '-'}
                      </td>
                    )}

                    {/* Fixed Action Button Column - Reserved 44px Space */}
                    <td
                      style={{
                        padding: '12px 8px',
                        textAlign: 'center',
                        position: 'relative',
                        width: '44px',
                        minWidth: '44px',
                        maxWidth: '44px',
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuBatchId(isMenuOpen ? null : b.id);
                        }}
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: '#15803d',
                          border: 'none',
                          color: '#ffffff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.12)',
                          visibility: isHovered || isMenuOpen ? 'visible' : 'hidden',
                          transition: 'opacity 0.15s',
                        }}
                      >
                        <ChevronDown size={12} />
                      </button>

                      {isMenuOpen && (
                        <div
                          ref={menuRef}
                          style={{
                            position: 'absolute',
                            right: '8px',
                            top: '38px',
                            width: '160px',
                            background: '#ffffff',
                            borderRadius: '8px',
                            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)',
                            border: '1px solid #cbd5e1',
                            zIndex: 1000,
                            padding: '4px 0',
                            textAlign: 'left',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => handleEditBatch(b)}
                            style={{
                              width: '100%',
                              padding: '8px 16px',
                              border: 'none',
                              background: '#2563eb',
                              color: '#ffffff',
                              fontSize: '13px',
                              fontWeight: 500,
                              textAlign: 'left',
                              cursor: 'pointer',
                              display: 'block',
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleInactive(b)}
                            style={{
                              width: '100%',
                              padding: '8px 16px',
                              border: 'none',
                              background: 'transparent',
                              color: '#334155',
                              fontSize: '13px',
                              fontWeight: 400,
                              textAlign: 'left',
                              cursor: 'pointer',
                              display: 'block',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            {b.isInactive ? 'Mark as Active' : 'Mark as Inactive'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveMenuBatchId(null);
                              setBatchToDelete(b);
                            }}
                            style={{
                              width: '100%',
                              padding: '8px 16px',
                              border: 'none',
                              background: 'transparent',
                              color: '#ef4444',
                              fontSize: '13px',
                              fontWeight: 400,
                              textAlign: 'left',
                              cursor: 'pointer',
                              display: 'block',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#fef2f2')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {isOpeningStockModalOpen && (
        <AddOpeningStockModal
          isOpen
          onClose={() => setIsOpeningStockModalOpen(false)}
          orgId={orgId}
          inventoryTracking={inventoryTracking}
          itemName={itemName}
          initialRows={openingStockRows}
          isSaving={saveOpeningStockMutation.isPending}
          onSave={async (rows) => {
            await saveOpeningStockMutation.mutateAsync(rows);
          }}
        />
      )}

      {batchToDelete && (
        <ConfirmDialog
          isOpen
          title="Delete Batch"
          message={`Are you sure you want to delete batch "${batchToDelete.batchReference || batchToDelete.batchNumber || 'Selected Batch'}"? This action will remove the batch quantity from opening stock.`}
          confirmText={saveOpeningStockMutation.isPending ? 'Deleting...' : 'Delete'}
          onConfirm={handleDeleteBatchConfirm}
          onCancel={() => setBatchToDelete(null)}
        />
      )}
    </div>
  );
}
