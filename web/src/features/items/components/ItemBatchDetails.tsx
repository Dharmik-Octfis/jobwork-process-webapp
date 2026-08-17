import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search,ChevronDown, SlidersHorizontal} from 'lucide-react';
import { format } from 'date-fns';
import { itemsApi } from '../items.api';
import { fetchLocations } from '../../configuration/locations/locations.api';
import '../../users/Users.css'; // For users-tooltip-wrapper classes
import { AddOpeningStockModal } from './AddOpeningStockModal';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { Select, type SelectOption } from '../../../components/ui/Select';
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

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All Batches' },
  { value: 'active', label: 'Active Batches' },
  { value: 'inactive', label: 'Inactive Batches' },
  { value: 'empty', label: 'Empty Batches' },
  { value: 'expired', label: 'Expired Batches' },
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

  const [inactiveBatchIds, setInactiveBatchIds] = useState<Record<string, boolean>>({});
  const [menuCoords, setMenuCoords] = useState<{ top?: number; right?: number; bottom?: number } | null>(null);

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() =>
    ALL_COLUMNS.map((col) => col.key),
  );
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenuBatchId(null);
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

  const locationOptions: SelectOption[] = useMemo(
    () => [
      { value: 'all', label: 'All' },
      ...locations.map((loc) => ({ value: loc.id, label: loc.name })),
    ],
    [locations],
  );

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
          batchReference: b.batchReference ?? undefined,
          manufacturerBatch: b.manufacturerBatch ?? undefined,
          manufacturedDate: b.manufacturedDate ?? undefined,
          expiryDate: b.expiryDate ?? undefined,
          quantityIn: Number(b.quantityIn ?? 0),
          quantityAvailable: Number(b.quantityIn ?? 0),
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
      } else if (statusFilter === 'inactive') {
        if (!b.isInactive) return false;
      } else if (statusFilter === 'empty') {
        if (b.quantityAvailable > 0) return false;
      } else if (statusFilter === 'expired') {
        if (!b.isExpired) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        // 🔴 The tag, not the internal key. `batchNumber` is never rendered, so
        // nobody types it, and matching on it only means a search for "42" hits
        // rows whose visible label has nothing to do with 42 (2026-08-14).
        const refMatch = b.batchReference?.toLowerCase().includes(q);
        const mfrMatch = b.manufacturerBatch?.toLowerCase().includes(q);
        if (!refMatch && !mfrMatch) return false;
      }
      return true;
    });
  }, [allBatches, selectedLocationId, statusFilter, searchQuery]);

  const activeColumns = useMemo(() => {
    return visibleColumns
      .map((key) => ALL_COLUMNS.find((col) => col.key === key))
      .filter((col): col is ColumnDef => Boolean(col));
  }, [visibleColumns]);

  const handleToggleInactive = (batch: BatchItem) => {
    setActiveMenuBatchId(null);
    setInactiveBatchIds((prev) => ({
      ...prev,
      [batch.id]: !prev[batch.id],
    }));
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
          <Select
            value={statusFilter}
            onChange={(val) => setStatusFilter(val as BatchStatusFilter)}
            options={STATUS_OPTIONS}
            fullWidth={false}
            minWidth={130}
            buttonStyle={{ height: 34, borderRadius: 6, borderColor: '#cbd5e1' }}
            ariaLabel="Status Filter"
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Location:</span>
            <Select
              value={selectedLocationId}
              onChange={setSelectedLocationId}
              options={locationOptions}
              fullWidth={false}
              minWidth={120}
              menuWidth={400}
              buttonStyle={{ height: 34, borderRadius: 6, borderColor: '#cbd5e1' }}
              ariaLabel="Location Filter"
            />
          </div>

          <div style={{ position: 'relative', width: '200px' }}>
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
          <button
            type="button"
            onClick={() => setIsColumnPickerOpen(true)}
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
              background: '#ffffff',
              cursor: 'pointer',
              color: '#475569',
              boxSizing: 'border-box',
            }}
          >
            <SlidersHorizontal size={15} />
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
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '13px',
            tableLayout: 'auto',
          }}
        >
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
              <th
                style={{ padding: '11px 8px', width: '44px', minWidth: '44px', maxWidth: '44px' }}
              />
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
                      background:
                        isHovered || isMenuOpen ? '#f8fafc' : b.isInactive ? '#f8fafc' : '#ffffff',
                      opacity: b.isInactive ? 0.75 : 1,
                      transition: 'background 0.15s, opacity 0.15s',
                    }}
                  >
                    {activeColumns.map((col) => {
                      if (col.key === 'batchReference') {
                        return (
                          <td
                            key={col.key}
                            style={{
                              padding: '12px 16px',
                              color: b.isInactive ? '#64748b' : '#0062ff',
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                              textDecoration: b.isInactive ? 'line-through' : 'none',
                            }}
                          >
                            {/* No `batchNumber` fallback (2026-08-14) — it is an
                                internal key, and falling back to it puts the one
                                identifier the user cannot act on into the column
                                they identify batches by. */}
                            {b.batchReference || '-'}
                            {b.isInactive && (
                              <span
                                style={{
                                  marginLeft: '8px',
                                  fontSize: '10px',
                                  background: '#e2e8f0',
                                  color: '#475569',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontWeight: 500,
                                  textDecoration: 'none',
                                  display: 'inline-block',
                                }}
                              >
                                Inactive
                              </span>
                            )}
                          </td>
                        );
                      }
                      if (col.key === 'manufacturerBatch') {
                        return (
                          <td
                            key={col.key}
                            style={{ padding: '12px 16px', color: '#334155', whiteSpace: 'nowrap' }}
                          >
                            {b.manufacturerBatch || '-'}
                          </td>
                        );
                      }
                      if (col.key === 'manufacturedDate') {
                        return (
                          <td
                            key={col.key}
                            style={{ padding: '12px 16px', color: '#334155', whiteSpace: 'nowrap' }}
                          >
                            {b.manufacturedDate ? format(new Date(b.manufacturedDate), 'dd/MM/yyyy') : '-'}
                          </td>
                        );
                      }
                      if (col.key === 'expiryDate') {
                        return (
                          <td
                            key={col.key}
                            style={{
                              padding: '12px 16px',
                              color: b.isExpired ? '#ef4444' : '#334155',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {b.expiryDate ? format(new Date(b.expiryDate), 'dd/MM/yyyy') : '-'}
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
                        );
                      }
                      if (col.key === 'quantityIn') {
                        return (
                          <td
                            key={col.key}
                            style={{
                              padding: '12px 16px',
                              textAlign: 'right',
                              color: '#334155',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {b.quantityIn}
                          </td>
                        );
                      }
                      if (col.key === 'quantityAvailable') {
                        return (
                          <td
                            key={col.key}
                            style={{
                              padding: '12px 16px',
                              textAlign: 'right',
                              color: b.quantityAvailable <= 0 ? '#64748b' : '#0f172a',
                              fontWeight: b.quantityAvailable > 0 ? 500 : 400,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {b.quantityAvailable}
                          </td>
                        );
                      }
                      if (col.key === 'sellingPrice') {
                        return (
                          <td
                            key={col.key}
                            style={{
                              padding: '12px 16px',
                              textAlign: 'right',
                              color: '#334155',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {b.sellingPrice !== null && b.sellingPrice !== undefined
                              ? `₹${Number(b.sellingPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                              : '-'}
                          </td>
                        );
                      }
                      return null;
                    })}

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
                          if (isMenuOpen) {
                            setActiveMenuBatchId(null);
                          } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const isNearBottom = rect.bottom > window.innerHeight - 150;
                            setMenuCoords({
                              right: window.innerWidth - rect.right,
                              ...(isNearBottom
                                ? { bottom: window.innerHeight - rect.top + 4 }
                                : { top: rect.bottom + 4 }),
                            });
                            setActiveMenuBatchId(b.id);
                          }
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
                        <>
                          <div
                            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuBatchId(null);
                            }}
                          />
                          <div
                            ref={menuRef}
                            style={{
                              position: 'fixed',
                              right: menuCoords?.right,
                              top: menuCoords?.top,
                              bottom: menuCoords?.bottom,
                              width: '160px',
                              background: '#ffffff',
                              borderRadius: '8px',
                              boxShadow:
                                '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)',
                              border: '1px solid #cbd5e1',
                              zIndex: 1000,
                              padding: '4px 0',
                              textAlign: 'left',
                              overflow: 'hidden',
                            }}>
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
                              onMouseLeave={(e) =>
                                (e.currentTarget.style.background = 'transparent')
                              }
                            >
                              {b.isInactive ? 'Mark as Active' : 'Mark as Inactive'}
                            </button>
                          </div>
                        </>
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



      <CustomizeColumnsModal
        isOpen={isColumnPickerOpen}
        onClose={() => setIsColumnPickerOpen(false)}
        catalog={ALL_COLUMNS}
        visible={visibleColumns}
        onSave={(cols) => {
          setVisibleColumns(cols);
          setIsColumnPickerOpen(false);
        }}
      />
    </div>
  );
}
