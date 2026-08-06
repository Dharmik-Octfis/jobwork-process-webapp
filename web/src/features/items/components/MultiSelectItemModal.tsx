import React, { useState, useMemo } from 'react';
import { Search, X, Plus, SlidersHorizontal, Filter } from 'lucide-react';
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
  items: Item[];
  onAssign: (selectedItems: MultiSelectItem[]) => void;
  onAddNewItem?: () => void;
}

export function MultiSelectItemModal({
  isOpen,
  onClose,
  items,
  onAssign,
  onAddNewItem,
}: MultiSelectItemModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((item) => {
      if (item.category) cats.add(item.category);
    });
    return Array.from(cats).sort();
  }, [items]);

  const [prevIsOpen, setPrevIsOpen] = React.useState(isOpen);

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setQuery('');
      setSelectedIds(new Set());
      setItemInputs({});
      setColumnFilters({});
      setIsFilterOpen(false);
    }
  }

  const fullCatalog = useMemo(() => {
    const base = [...ITEM_MODAL_CATALOG];
    const customKeys = new Set<string>();

    items.forEach((item) => {
      const fields = item.custom_fields || item.customFields;
      if (fields) {
        Object.keys(fields).forEach((k) => customKeys.add(k));
      }
    });

    customKeys.forEach((k) => {
      base.push({ key: `cf_${k}`, label: k });
    });

    return base;
  }, [items]);

  const activeColumns = useMemo(() => {
    return visibleColumns
      .map((key) => fullCatalog.find((c) => c.key === key))
      .filter((c): c is ColumnDef => Boolean(c));
  }, [visibleColumns, fullCatalog]);

  const shownItems = useMemo(() => {
    let filtered = items;
    if (query.trim()) {
      const searchStr = query.trim().toLowerCase();
      filtered = filtered.filter((item) => {
        const itemStr = `${item.name} ${item.sku || ''}`.toLowerCase();
        return itemStr.includes(searchStr);
      });
    }

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
  }, [items, query, isFilterOpen, columnFilters]);

  const handleSelectAll = () => {
    if (selectedIds.size === shownItems.length && shownItems.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(shownItems.map((i) => i.id)));
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

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      if (!itemInputs[id]) {
        const item = items.find((i) => i.id === id);
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
    setSelectedIds(next);
  };

  const handleAssign = () => {
    const selected = items
      .filter((i) => selectedIds.has(i.id))
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
    setSelectedIds(new Set()); // Reset for next time
    setQuery('');
    setItemInputs({});
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
              onChange={(e) => setQuery(e.target.value)}
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
              onClick={() => setIsFilterOpen(!isFilterOpen)}
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
                    checked={shownItems.length > 0 && selectedIds.size === shownItems.length}
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
                      onClick={() => setColumnFilters({})}
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
              {shownItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={activeColumns.length + 1}
                    style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8' }}
                  >
                    No products found.
                  </td>
                </tr>
              ) : (
                shownItems.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => toggleSelect(item.id)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: '1px solid #eef0f3',
                      background: selectedIds.has(item.id) ? '#eff6ff' : '#ffffff',
                    }}
                  >
                    <td
                      style={{
                        padding: '12px 12px',
                        width: 44,
                        minWidth: 44,
                        position: 'sticky',
                        left: 0,
                        zIndex: 1,
                        background: 'inherit',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    {activeColumns.map((col) => (
                      <td
                        key={col.key}
                        style={{
                          padding: '12px 20px',
                          color: '#475569',
                          ...(col.key === 'name'
                            ? {
                                position: 'sticky',
                                left: 44,
                                zIndex: 1,
                                background: 'inherit',
                                boxShadow: '4px 0 4px -4px rgba(0,0,0,0.1)',
                              }
                            : {}),
                        }}
                      >
                        {renderCell(item, col.key)}
                      </td>
                    ))}
                    {selectedIds.has(item.id) ? (
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
                            value={
                              itemInputs[item.id]?.rate ??
                              (item.costPrice || item.sellingPrice || 0)
                            }
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
          <span style={{ fontSize: 13, color: '#64748b' }}>{selectedIds.size} selected</span>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAssign} disabled={selectedIds.size === 0}>
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
