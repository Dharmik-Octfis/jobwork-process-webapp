import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { itemsApi } from '../items.api';
import { Search, X, Plus, SlidersHorizontal, Filter, ChevronLeft, ChevronRight,} from 'lucide-react';
import type { Item } from '../items.schemas';
import { Button } from '../../../components/ui/Button';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import type { ColumnDef } from '../../list-views/listViews.api';

const ITEM_MODAL_CATALOG: ColumnDef[] = [
  { key: 'name', label: 'Product Name', locked: true },
  { key: 'sku', label: 'Product Code' },
  { key: 'type', label: 'Product Type' },
  { key: 'hsn', label: 'HSN/SAC' },
  { key: 'category', label: 'Product Category' },
];

function renderCell(item: Item, key: string): React.ReactNode {
  if (key.startsWith('cf_')) {
    const cfKey = key.replace('cf_', '');
    const val = item.custom_fields?.[cfKey] ?? item.customFields?.[cfKey];
    return val != null ? String(val) : '-';
  }

  switch (key) {
    case 'name':
      return <span style={{ color: '#2563eb' }}>{item.name}</span>;
    case 'sku':
      return item.sku || '-';
    case 'type':
      return item.type || item.item_type || '-';
    case 'hsn':
      return item.hsnCode || item.hsn_or_sac || '-';
    case 'category':
      return item.category || '-';
    default:
      return '-';
  }
}

export interface MultiSelectItem extends Item {
  _quantity?: number;
  _rate?: number;
  _discount?: number;
  _discountType?: 'percentage' | 'fixed';
}

export interface MultiSelectItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  onAssign: (selectedItems: MultiSelectItem[]) => void;
  onAddNewItem?: () => void;
  filter?: string;
}

export function MultiSelectItemModal({
  isOpen,
  onClose,
  orgId,
  onAssign,
  onAddNewItem,
  filter,
}: MultiSelectItemModalProps) {
  const [query, setQuery] = useState('');
  const [selectedItemsMap, setSelectedItemsMap] = useState<Map<string, Item>>(new Map());
  const [itemInputs, setItemInputs] = useState<
    Record<
      string,
      {
        quantity: number | string;
        rate: number | string;
        discount: number | string;
        discountType?: 'percentage' | 'fixed';
      }
    >
  >({});
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['name', 'sku', 'hsn']);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const [page, setPage] = useState(1);

  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query.length >= 3 ? query : '');
    }, 300);
    return () => clearTimeout(handler);
  }, [query]);

  const { data: itemsPage} = useQuery({
    queryKey: ['items-modal', orgId, debouncedQuery, page, filter],
    queryFn: () => itemsApi.getItems(orgId, { ...(debouncedQuery ? { search: debouncedQuery } : {}), page, perPage: 50, filter }),
    enabled: Boolean(orgId) && isOpen,
    refetchOnWindowFocus: false,
  });

  const categories = useMemo(() => {
    const cats = new Set<string>();
    (itemsPage?.results || []).forEach((item) => {
      if (item.category) cats.add(item.category);
    });
    return Array.from(cats).sort();
  }, [itemsPage?.results]);

  const [prevIsOpen, setPrevIsOpen] = React.useState(isOpen);

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setQuery('');
      setSelectedItemsMap(new Map());
      setItemInputs({});
      setColumnFilters({});
      setIsFilterOpen(false);
      setPage(1);
    }
  }


  const fullCatalog = useMemo(() => {
    const base = [...ITEM_MODAL_CATALOG];
    const customKeys = new Set<string>();

    (itemsPage?.results || []).forEach((item) => {
      const fields = item.custom_fields || item.customFields;
      if (fields) {
        Object.keys(fields).forEach((k) => customKeys.add(k));
      }
    });

    customKeys.forEach((k) => {
      base.push({ key: `cf_${k}`, label: k });
    });

    return base;
  }, [itemsPage?.results]);

  const activeColumns = useMemo(() => {
    return visibleColumns
      .map((key) => fullCatalog.find((c) => c.key === key))
      .filter((c): c is ColumnDef => Boolean(c));
  }, [visibleColumns, fullCatalog]);

  const shownItems = useMemo(() => {
    let filtered = itemsPage?.results || [];
    if (isFilterOpen) {
      Object.entries(columnFilters).forEach(([key, value]) => {
        if (!value) return;
        const searchVal = value.toLowerCase();
        filtered = filtered.filter((item) => {
          if (key === 'name') return item.name.toLowerCase().includes(searchVal);
          if (key === 'sku') return (item.sku || '').toLowerCase().includes(searchVal);
          if (key === 'hsn') return (item.hsnCode || item.hsn_or_sac || '').toLowerCase().includes(searchVal);
          if (key === 'type') return (item.type || item.item_type || '').toLowerCase() === searchVal;
          if (key === 'category') return (item.category || '').toLowerCase() === searchVal;
          const cfKey = key.replace('cf_', '');
          const val = item.custom_fields?.[cfKey] ?? item.customFields?.[cfKey];
          return val != null && String(val).toLowerCase().includes(searchVal);
        });
      });
    }
    return filtered;
  }, [itemsPage?.results, isFilterOpen, columnFilters]);

  const paginatedItems = shownItems;

  const handleSelectAll = () => {
    if (selectedItemsMap.size >= shownItems.length && shownItems.length > 0 && shownItems.every(i => selectedItemsMap.has(i.id))) {
      setSelectedItemsMap(new Map());
    } else {
      const next = new Map(selectedItemsMap);
      shownItems.forEach(i => next.set(i.id, i));
      setSelectedItemsMap(next);
      const nextInputs = { ...itemInputs };
      shownItems.forEach((i) => {
        if (!nextInputs[i.id]) {
          nextInputs[i.id] = {
            quantity: 1,
            rate: i.costPrice || i.sellingPrice || 0,
            discount: 0,
            discountType: 'percentage',
          };
        }
      });
      setItemInputs(nextInputs);
    }
  };

  const toggleSelect = (item: Item) => {
    const id = item.id;
    const next = new Map(selectedItemsMap);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.set(id, item);
      if (!itemInputs[id]) {
        if (item) {
          setItemInputs((prev) => ({
            ...prev,
            [id]: {
              quantity: 1,
              rate: item.costPrice || item.sellingPrice || 0,
              discount: 0,
              discountType: 'percentage',
            },
          }));
        }
      }
    }
    setSelectedItemsMap(next);
  };

  const handleAssign = () => {
    const selected = Array.from(selectedItemsMap.values())
      .map((i) => {
        const inputs = itemInputs[i.id];
        if (inputs) {
          return {
            ...i,
            _quantity: Number(inputs.quantity) || 1,
            _rate: Number(inputs.rate) || 0,
            _discount: Number(inputs.discount) || 0,
            _discountType: inputs.discountType || 'percentage',
          };
        }
        return i;
      });
    onAssign(selected);
    setSelectedItemsMap(new Map()); // Reset for next time
    setQuery('');
    setItemInputs({});
    setPage(1);
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 0,
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 1100,
          maxWidth: '95vw',
          background: '#fff',
          borderRadius: '0 0 8px 8px',
          boxShadow: '0 20px 45px rgba(0,0,0,0.22)',
          display: 'flex',
          flexDirection: 'column',
          height: '80vh',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid #eef0f3',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#0f172a' }}>
            Assign Products to Purchase Order
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div
          style={{
            padding: '14px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '300px' }}
          >
            <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: 12 }} />
            <input
              type="text"
              placeholder="Search products..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              style={{
                width: '100%',
                padding: '8px 12px 8px 34px',
                fontSize: 13,
                border: '1px solid #d1d5db',
                borderRadius: 6,
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#2563eb')}
              onBlur={(e) => (e.target.style.borderColor = '#d1d5db')}
            />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button
              variant={isFilterOpen ? 'primary' : 'secondary'}
              onClick={() => {
                setIsFilterOpen(!isFilterOpen);
                setPage(1);
              }}
              style={{
                padding: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Toggle Filters"
            >
              <Filter size={16} color={isFilterOpen ? '#ffffff' : '#64748b'} />
            </Button>
            <Button
              variant="secondary"
              onClick={() => setIsColumnsOpen(true)}
              style={{
                padding: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Manage Columns"
            >
              <SlidersHorizontal size={16} color="#64748b" />
            </Button>
            {onAddNewItem && (
              <Button
                variant="primary"
                onClick={onAddNewItem}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Plus size={16} /> New Product
              </Button>
            )}
          </div>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto', borderTop: '1px solid #eef0f3' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: 13,
              whiteSpace: 'nowrap',
            }}
          >
            <thead style={{ position: 'sticky', top: 0, background: '#ffffff', zIndex: 10 }}>
              <tr>
                <th
                  style={{
                    padding: '12px 12px',
                    borderBottom: '1px solid #eef0f3',
                    width: 44,
                    minWidth: 44,
                    position: 'sticky',
                    left: 0,
                    zIndex: 2,
                    background: '#ffffff',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={shownItems.length > 0 && shownItems.every(i => selectedItemsMap.has(i.id))}
                    onChange={handleSelectAll}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                {activeColumns.map((col) => (
                  <th
                    key={col.key}
                    style={{
                      padding: '12px 20px',
                      borderBottom: '1px solid #eef0f3',
                      color: '#475569',
                      fontWeight: 600,
                      ...(col.key === 'name'
                        ? {
                            position: 'sticky',
                            left: 44,
                            zIndex: 2,
                            background: '#ffffff',
                            boxShadow: '4px 0 4px -4px rgba(0,0,0,0.1)',
                          }
                        : {}),
                    }}
                  >
                    {col.label}
                  </th>
                ))}
                <th
                  style={{
                    padding: '12px 20px',
                    borderBottom: '1px solid #eef0f3',
                    color: '#475569',
                    fontWeight: 600,
                  }}
                >
                  Qty
                </th>
                <th
                  style={{
                    padding: '12px 20px',
                    borderBottom: '1px solid #eef0f3',
                    color: '#475569',
                    fontWeight: 600,
                  }}
                >
                  Rate
                </th>
                <th
                  style={{
                    padding: '12px 20px',
                    borderBottom: '1px solid #eef0f3',
                    color: '#475569',
                    fontWeight: 600,
                  }}
                >
                  Disc
                </th>
              </tr>
              {isFilterOpen && (
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #eef0f3' }}>
                  <th
                    style={{
                      padding: '8px 12px',
                      position: 'sticky',
                      left: 0,
                      zIndex: 2,
                      background: '#f8fafc',
                      textAlign: 'center',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setColumnFilters({});
                        setPage(1);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: 4,
                      }}
                      title="Clear Filters"
                    >
                      <X size={14} />
                    </button>
                  </th>
                  {activeColumns.map((col) => {
                    const val = columnFilters[col.key] || '';
                    const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
                      setColumnFilters((prev) => ({ ...prev, [col.key]: e.target.value }));
                      setPage(1);
                    };
                    const inputStyle = {
                      width: '100%',
                      padding: '6px 8px',
                      fontSize: 12,
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
                      outline: 'none',
                    };

                    return (
                      <th
                        key={`filter-${col.key}`}
                        style={{
                          padding: '8px 20px',
                          fontWeight: 'normal',
                          ...(col.key === 'name'
                            ? {
                                position: 'sticky',
                                left: 44,
                                zIndex: 2,
                                background: '#f8fafc',
                                boxShadow: '4px 0 4px -4px rgba(0,0,0,0.1)',
                              }
                            : {}),
                        }}
                      >
                        {col.key === 'type' ? (
                          <select value={val} onChange={onChange} style={inputStyle}>
                            <option value="">- None -</option>
                            <option value="goods">Goods</option>
                            <option value="service">Service</option>
                          </select>
                        ) : col.key === 'category' ? (
                          <select value={val} onChange={onChange} style={inputStyle}>
                            <option value="">- None -</option>
                            {categories.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            placeholder={col.label}
                            value={val}
                            onChange={onChange}
                            style={inputStyle}
                          />
                        )}
                      </th>
                    );
                  })}
                  <th style={{ padding: '8px 20px', background: '#f8fafc' }}></th>
                  <th style={{ padding: '8px 20px', background: '#f8fafc' }}></th>
                  <th style={{ padding: '8px 20px', background: '#f8fafc' }}></th>
                </tr>
              )}
            </thead>
            <tbody>
              {paginatedItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={activeColumns.length + 2}
                    style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}
                  >
                    No products found.
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => toggleSelect(item)}
                    style={{
                      borderBottom: '1px solid #eef0f3',
                      cursor: 'pointer',
                      background: selectedItemsMap.has(item.id) ? '#f8fafc' : '#ffffff',
                    }}
                  >
                    <td
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        padding: '12px 12px',
                        width: 44,
                        minWidth: 44,
                        position: 'sticky',
                        left: 0,
                        zIndex: 1,
                        background: selectedItemsMap.has(item.id) ? '#f8fafc' : '#ffffff',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedItemsMap.has(item.id)}
                        onChange={() => toggleSelect(item)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    {activeColumns.map((col) => (
                      <td
                        key={col.key}
                        style={{
                          padding: '12px 20px',
                          color: '#334155',
                          ...(col.key === 'name'
                            ? {
                                position: 'sticky',
                                left: 44,
                                zIndex: 1,
                                background: selectedItemsMap.has(item.id) ? '#f8fafc' : '#ffffff',
                                boxShadow: '4px 0 4px -4px rgba(0,0,0,0.1)',
                              }
                            : {}),
                        }}
                      >
                        {renderCell(item, col.key)}
                      </td>
                    ))}
                    {selectedItemsMap.has(item.id) ? (
                      <>
                        <td style={{ padding: '8px 20px' }}>
                          <input
                            type="number"
                            value={itemInputs[item.id]?.quantity ?? 1}
                            onChange={(e) =>
                              setItemInputs((prev) => ({
                                ...prev,
                                [item.id]: { ...prev[item.id], quantity: e.target.value },
                              }))
                            }
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: 60,
                              padding: '6px',
                              border: '1px solid #d1d5db',
                              borderRadius: 4,
                              outline: 'none',
                            }}
                          />
                        </td>
                        <td style={{ padding: '8px 20px' }}>
                          <input
                            type="number"
                            value={itemInputs[item.id]?.rate ?? 0}
                            onChange={(e) =>
                              setItemInputs((prev) => ({
                                ...prev,
                                [item.id]: { ...prev[item.id], rate: e.target.value },
                              }))
                            }
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: 80,
                              padding: '6px',
                              border: '1px solid #d1d5db',
                              borderRadius: 4,
                              outline: 'none',
                            }}
                          />
                        </td>
                        <td style={{ padding: '8px 20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="number"
                              value={itemInputs[item.id]?.discount ?? 0}
                              onChange={(e) =>
                                setItemInputs((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], discount: e.target.value },
                                }))
                              }
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                width: 60,
                                padding: '6px',
                                border: '1px solid #d1d5db',
                                borderRadius: 4,
                                outline: 'none',
                              }}
                            />
                            <select
                              value={itemInputs[item.id]?.discountType ?? 'percentage'}
                              onChange={(e) =>
                                setItemInputs((prev) => ({
                                  ...prev,
                                  [item.id]: {
                                    ...prev[item.id],
                                    discountType: e.target.value as 'percentage' | 'fixed',
                                  },
                                }))
                              }
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                padding: '6px',
                                border: '1px solid #d1d5db',
                                borderRadius: 4,
                                outline: 'none',
                                background: '#fff',
                              }}
                            >
                              <option value="percentage">%</option>
                              <option value="fixed">₹</option>
                            </select>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td />
                        <td />
                        <td />
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderTop: '1px solid #eef0f3',
            background: '#ffffff',
            borderRadius: '0 0 8px 8px',
          }}
        >
          <span style={{ fontSize: 13, color: '#64748b' }}>{selectedItemsMap.size} selected</span>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: '#64748b' }}>
              {shownItems.length > 0 ? ((page - 1) * 50) + 1 : 0} - {Math.min(page * 50, shownItems.length)} of {shownItems.length}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                style={{ cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1, background: 'none', border: 'none', padding: '2px', display: 'flex', alignItems: 'center' }}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                disabled={page * 50 >= shownItems.length}
                onClick={() => setPage(p => p + 1)}
                style={{ cursor: page * 50 >= shownItems.length ? 'not-allowed' : 'pointer', opacity: page * 50 >= shownItems.length ? 0.5 : 1, background: 'none', border: 'none', padding: '2px', display: 'flex', alignItems: 'center' }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAssign} disabled={selectedItemsMap.size === 0}>
              Assign
            </Button>
          </div>
        </div>
      </div>

      <CustomizeColumnsModal
        isOpen={isColumnsOpen}
        onClose={() => setIsColumnsOpen(false)}
        catalog={fullCatalog}
        visible={visibleColumns}
        onSave={(cols) => {
          setVisibleColumns(cols);
          setIsColumnsOpen(false);
        }}
      />
    </div>
  );
}


