import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { itemsApi } from '../items.api';
import {
  Search,
  X,
  Plus,
  SlidersHorizontal,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { Item } from '../items.schemas';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { AdvancedFilter } from '../../../components/ui/AdvancedFilter/AdvancedFilter';
import type {
  FilterField,
  FilterCondition,
  FilterDataType,
  FilterOperator,
} from '../../../components/ui/AdvancedFilter/filterUtils';
import { evaluateCondition } from '../../../components/ui/AdvancedFilter/filterUtils';
import type { ColumnDef } from '../../list-views/listViews.api';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';

const ITEM_MODAL_CATALOG: ColumnDef[] = [
  { key: 'name', label: 'Product Name', locked: true },
  { key: 'sku', label: 'Product Code' },
  { key: 'type', label: 'Product Type' },
  { key: 'hsn', label: 'HSN/SAC' },
  { key: 'category', label: 'Product Category' },
];

import type { CustomFieldDefinition } from '../../custom-fields/customFields.schemas';

function renderCell(
  item: Item,
  key: string,
  customFieldsDef?: CustomFieldDefinition[],
): React.ReactNode {
  if (key.startsWith('cf_')) {
    const cfKey = key.replace('cf_', '');
    const val = item.customFields?.[cfKey] ?? item.customFields?.[cfKey];
    if (val == null) return '-';

    const def = customFieldsDef?.find((d) => d.key === cfKey);
    if (def) {
      if (def.dataType === 'select' || def.dataType === 'multi_select') {
        const options = def.config?.options || [];
        if (Array.isArray(val)) {
          return val.map((v) => options.find((o) => o.id === v)?.label || v).join(', ');
        }
        return options.find((o) => o.id === val)?.label || String(val);
      }

      if (['date', 'datetime', 'time'].includes(def.dataType)) {
        if (typeof val === 'string' && !isNaN(Date.parse(val))) {
          const d = new Date(val);
          if (def.dataType === 'date') return d.toLocaleDateString();
          if (def.dataType === 'datetime') return d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          if (def.dataType === 'time') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      }
    }

    if (Array.isArray(val)) return val.join(', ');
    return String(val);
  }

  switch (key) {
    case 'name':
      return <span style={{ color: '#2563eb' }}>{item.name}</span>;
    case 'sku':
      return item.sku || '-';
    case 'type':
      return item.itemType || item.itemStructure || '-';
    case 'hsn':
      return item.hsnCode || '-';
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
  const [advancedConditions, setAdvancedConditions] = useState<FilterCondition[]>([]);
  const [advancedMatchType, setAdvancedMatchType] = useState<'any' | 'all'>('all');
  const [step, setStep] = useState<'select' | 'values'>('select');

  const [page, setPage] = useState(1);

  const { data: customFieldsDef } = useActiveCustomFields(orgId, 'item');

  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const handler = setTimeout(() => {
      const parts: string[] = [];
      if (query.length >= 3) parts.push(query);

      Object.entries(columnFilters).forEach(([k, v]) => {
        if (!v) return;
        let isText = true;
        if (k === 'category' || k === 'type') isText = false;
        if (k.startsWith('cf_')) {
          const cfKey = k.replace('cf_', '');
          const def = customFieldsDef?.find((d) => d.key === cfKey);
          if (
            def &&
            (def.dataType === 'select' ||
              def.dataType === 'multi_select' ||
              def.dataType === 'checkbox')
          ) {
            isText = false;
          }
        }

        if (isText) {
          if (v.length >= 3) parts.push(v);
        } else {
          parts.push(v);
        }
      });

      setDebouncedQuery(parts.join(' '));
    }, 300);
    return () => clearTimeout(handler);
  }, [query, columnFilters, customFieldsDef]);

  const { data: itemsPage } = useQuery({
    queryKey: ['items-modal', orgId, debouncedQuery, page, filter],
    queryFn: () =>
      itemsApi.getItems(orgId, {
        ...(debouncedQuery ? { search: debouncedQuery } : {}),
        page,
        perPage: 50,
        filter,
      }),
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
      setStep('select');
      setPage(1);
    }
  }

  const fullCatalog = useMemo(() => {
    const base = [...ITEM_MODAL_CATALOG];
    const customKeys = new Set<string>();

    (itemsPage?.results || []).forEach((item) => {
      const fields = item.customFields || item.customFields;
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

  const customFieldTypes = useMemo(() => {
    const types = new Map<string, FilterDataType>();
    (itemsPage?.results || []).forEach((item) => {
      const fields = item.customFields || item.customFields;
      if (fields) {
        Object.entries(fields).forEach(([k, v]) => {
          if (v !== null && v !== undefined && !types.has(k)) {
            if (typeof v === 'number') types.set(k, 'number');
            else if (typeof v === 'boolean') types.set(k, 'boolean');
            else if (
              typeof v === 'string' &&
              /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/.test(v) &&
              !isNaN(Date.parse(v))
            ) {
              types.set(k, 'date');
            } else {
              types.set(k, 'text');
            }
          }
        });
      }
    });
    return types;
  }, [itemsPage?.results]);

  const productTypes = useMemo(() => {
    const types = new Set<string>();
    (itemsPage?.results || []).forEach((item) => {
      const t = item.itemType || item.itemStructure;
      if (t) types.add(t);
    });
    return Array.from(types).sort();
  }, [itemsPage?.results]);

  const filterFields = useMemo<FilterField[]>(() => {
    return fullCatalog.map((c) => {
      let dataType: FilterDataType = 'string';
      let options: { label: string; value: string | number }[] | undefined = undefined;

      if (c.key.startsWith('cf_')) {
        const cfKey = c.key.replace('cf_', '');
        const def = customFieldsDef?.find((d) => d.key === cfKey);

        if (def) {
          dataType = def.dataType as FilterDataType;
          if (def.dataType === 'select' || def.dataType === 'multi_select') {
            options =
              def.config?.options?.map((opt) => ({ label: opt.label, value: opt.label })) || [];
          }
        } else {
          dataType = customFieldTypes.get(cfKey) || 'text';
        }
      } else if (c.key === 'category') {
        dataType = 'select';
        options = categories.map((cat) => ({ label: cat, value: cat }));
      } else if (c.key === 'type') {
        dataType = 'select';
        options = productTypes.map((t) => ({ label: t, value: t }));
      }

      return {
        key: c.key,
        label: c.label,
        dataType,
        options,
      };
    });
  }, [fullCatalog, customFieldTypes, categories, productTypes, customFieldsDef]);

  const shownItems = useMemo(() => {
    let filtered = itemsPage?.results || [];
    if (isFilterOpen) {
      Object.entries(columnFilters).forEach(([key, value]) => {
        if (!value) return;
        const searchVal = value.toLowerCase().trim();

        let isText = true;
        if (key === 'category' || key === 'type') isText = false;
        if (key.startsWith('cf_')) {
          const cfKey = key.replace('cf_', '');
          const def = customFieldsDef?.find((d) => d.key === cfKey);
          if (def && (def.dataType === 'select' || def.dataType === 'multi_select' || def.dataType === 'checkbox')) {
            isText = false;
          }
        }

        if (isText && searchVal.length < 3) {
          return;
        }

        filtered = filtered.filter((item) => {
          if (key === 'name') return item.name.toLowerCase().includes(searchVal);
          if (key === 'sku') return (item.sku || '').toLowerCase().includes(searchVal);
          if (key === 'hsn')
            return (item.hsnCode || '').toLowerCase().includes(searchVal);
          if (key === 'type')
            return (item.itemType || item.itemStructure || '').toLowerCase() === searchVal;
          if (key === 'category') return (item.category || '').toLowerCase() === searchVal;
          const cfKey = key.replace('cf_', '');
          const rawVal = item.customFields?.[cfKey] ?? item.customFields?.[cfKey];

          let val = rawVal;
          const def = customFieldsDef?.find((d) => d.key === cfKey);
          if (def && (def.dataType === 'select' || def.dataType === 'multi_select')) {
            const options = def.config?.options || [];
            if (Array.isArray(rawVal)) {
              val = rawVal.map((v) => options.find((o) => o.id === v)?.label || v).join(', ');
            } else {
              val = options.find((o) => o.id === rawVal)?.label || rawVal;
            }
          } else if (def && def.dataType === 'checkbox') {
            val = Boolean(rawVal);
          }

          return val != null && String(val).toLowerCase().includes(searchVal);
        });
      });
    }
    if (advancedConditions.length > 0) {
      filtered = filtered.filter((item) => {
        const results = advancedConditions.map((cond) => {
          let itemValue: unknown;
          if (cond.field === 'name') itemValue = item.name;
          else if (cond.field === 'sku') itemValue = item.sku;
          else if (cond.field === 'hsn') itemValue = item.hsnCode;
          else if (cond.field === 'type') itemValue = item.itemType || item.itemStructure;
          else if (cond.field === 'category') itemValue = item.category;
          else if (cond.field.startsWith('cf_')) {
            const cfKey = cond.field.replace('cf_', '');
            const rawVal = item.customFields?.[cfKey] ?? item.customFields?.[cfKey];

            const def = customFieldsDef?.find((d) => d.key === cfKey);
            if (def && (def.dataType === 'select' || def.dataType === 'multi_select')) {
              const options = def.config?.options || [];
              if (Array.isArray(rawVal)) {
                itemValue = rawVal.map((v) => options.find((o) => o.id === v)?.label || v);
              } else {
                itemValue = options.find((o) => o.id === rawVal)?.label || rawVal;
              }
            } else {
              itemValue = rawVal;
            }
          }

          const filterFieldDef = filterFields.find((f) => f.key === cond.field);
          const dataType = filterFieldDef?.dataType || 'text';

          return evaluateCondition(
            itemValue,
            cond.operator as FilterOperator,
            cond.value,
            dataType,
          );
        });

        return advancedMatchType === 'any' ? results.some(Boolean) : results.every(Boolean);
      });
    }

    return filtered;
  }, [itemsPage?.results, isFilterOpen, columnFilters, advancedConditions, advancedMatchType]);

  const paginatedItems = shownItems;

  const handleSelectAll = () => {
    if (
      selectedItemsMap.size >= shownItems.length &&
      shownItems.length > 0 &&
      shownItems.every((i) => selectedItemsMap.has(i.id))
    ) {
      setSelectedItemsMap(new Map());
    } else {
      const next = new Map(selectedItemsMap);
      shownItems.forEach((i) => next.set(i.id, i));
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
    const selected = Array.from(selectedItemsMap.values()).map((i) => {
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

        {step === 'select' ? (
          <>
            {/* Search */}
            <div
              style={{
                padding: '14px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <AdvancedFilter
                  fields={filterFields}
                  conditions={advancedConditions}
                  onChange={(conds: FilterCondition[]) => {
                    setAdvancedConditions(conds);
                    setPage(1);
                  }}
                  matchType={advancedMatchType}
                  onMatchTypeChange={setAdvancedMatchType}
                  align="left"
                  leftOffset={-20}
                />
                <div
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    width: '300px',
                  }}
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
                  title="Filter"
                >
                  <Filter size={16} color={isFilterOpen ? '#fff' : '#64748b'} />
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
                        checked={
                          shownItems.length > 0 &&
                          shownItems.every((i) => selectedItemsMap.has(i.id))
                        }
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
                  </tr>
                  {isFilterOpen && (
                    <tr style={{ background: '#f8fafc' }}>
                      <th
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid #eef0f3',
                          position: 'sticky',
                          left: 0,
                          zIndex: 2,
                          background: '#f8fafc',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
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
                            cursor: 'pointer',
                            color: '#94a3b8',
                            padding: 4,
                            display: 'flex',
                          }}
                          title="Clear filters"
                        >
                          <X size={14} />
                        </button>
                      </th>
                      {activeColumns.map((col) => {
                        const val = columnFilters[col.key] || '';
                        const onChange = (
                          e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
                        ) => {
                          setColumnFilters((prev) => ({ ...prev, [col.key]: e.target.value }));
                          setPage(1);
                        };
                        const onSelectChange = (value: string) => {
                          setColumnFilters((prev) => ({ ...prev, [col.key]: value }));
                          setPage(1);
                        };
                        const inputStyle = {
                          width: '100%',
                          padding: '4px 8px',
                          fontSize: 12,
                          border: '1px solid #cbd5e1',
                          borderRadius: 4,
                          outline: 'none',
                        };

                        let filterInput = (
                          <input
                            type="text"
                            value={val}
                            onChange={onChange}
                            placeholder={`Filter ${col.label}...`}
                            style={inputStyle}
                          />
                        );

                        if (col.key === 'category') {
                          filterInput = (
                            <Select
                              value={val}
                              onChange={onSelectChange}
                              options={[{ label: '- None -', value: '' }, ...categories.map(c => ({ label: c, value: c }))]}
                              placeholder="- None -"
                              containerStyle={{ minWidth: '100px' }}
                              buttonStyle={{ height: 26, padding: '0 8px', fontSize: 12, fontWeight: 400, borderRadius: 4, border: '1px solid #cbd5e1' }}
                            />
                          );
                        } else if (col.key === 'type') {
                          filterInput = (
                            <Select
                              value={val}
                              onChange={onSelectChange}
                              options={[{ label: '- None -', value: '' }, ...productTypes.map(t => ({ label: t, value: t }))]}
                              placeholder="- None -"
                              containerStyle={{ minWidth: '100px' }}
                              buttonStyle={{ height: 26, padding: '0 8px', fontSize: 12, fontWeight: 400, borderRadius: 4, border: '1px solid #cbd5e1' }}
                            />
                          );
                        } else if (col.key.startsWith('cf_')) {
                          const cfKey = col.key.replace('cf_', '');
                          const def = customFieldsDef?.find((d) => d.key === cfKey);

                          if (def) {
                            if (def.dataType === 'select' || def.dataType === 'multi_select') {
                              const options = def.config?.options || [];
                              filterInput = (
                                <Select
                                  value={val}
                                  onChange={onSelectChange}
                                  options={[{ label: '- None -', value: '' }, ...options.map(opt => ({ label: opt.label, value: opt.label }))]}
                                  placeholder="- None -"
                                  containerStyle={{ minWidth: '100px' }}
                                  buttonStyle={{ height: 26, padding: '0 8px', fontSize: 12, fontWeight: 400, borderRadius: 4, border: '1px solid #cbd5e1' }}
                                />
                              );
                            } else if (def.dataType === 'checkbox') {
                              filterInput = (
                                <Select
                                  value={val}
                                  onChange={onSelectChange}
                                  options={[
                                    { label: '- None -', value: '' },
                                    { label: 'Yes', value: 'true' },
                                    { label: 'No', value: 'false' },
                                  ]}
                                  placeholder="- None -"
                                  containerStyle={{ minWidth: '100px' }}
                                  buttonStyle={{ height: 26, padding: '0 8px', fontSize: 12, fontWeight: 400, borderRadius: 4, border: '1px solid #cbd5e1' }}
                                />
                              );
                            }
                          }
                        }

                        return (
                          <th
                            key={`filter-${col.key}`}
                            style={{
                              padding: '8px 20px',
                              borderBottom: '1px solid #eef0f3',
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
                            {filterInput}
                          </th>
                        );
                      })}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {paginatedItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={activeColumns.length + 1}
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
                          background: selectedItemsMap.has(item.id) ? '#eff6ff' : '#ffffff',
                          borderBottom: '1px solid #eef0f3',
                          cursor: 'pointer',
                          transition: 'background 0.2s',
                        }}
                      >
                        <td
                          style={{
                            padding: '8px 12px',
                            position: 'sticky',
                            left: 0,
                            background: selectedItemsMap.has(item.id) ? '#eff6ff' : '#ffffff',
                            zIndex: 1,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedItemsMap.has(item.id)}
                            onChange={() => toggleSelect(item)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        {activeColumns.map((col) => (
                          <td
                            key={col.key}
                            style={{
                              padding: '8px 20px',
                              ...(col.key === 'name'
                                ? {
                                    position: 'sticky',
                                    left: 44,
                                    background: selectedItemsMap.has(item.id)
                                      ? '#eff6ff'
                                      : '#ffffff',
                                    zIndex: 1,
                                    boxShadow: '4px 0 4px -4px rgba(0,0,0,0.1)',
                                  }
                                : {}),
                            }}
                          >
                            {renderCell(item, col.key, customFieldsDef)}
                          </td>
                        ))}
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
              <span style={{ fontSize: 13, color: '#64748b' }}>
                {selectedItemsMap.size} selected
              </span>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#64748b' }}>
                  {shownItems.length > 0 ? (page - 1) * 50 + 1 : 0} -{' '}
                  {Math.min(page * 50, shownItems.length)} of {shownItems.length}
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                    style={{
                      cursor: page === 1 ? 'not-allowed' : 'pointer',
                      opacity: page === 1 ? 0.5 : 1,
                      background: 'none',
                      border: 'none',
                      padding: '2px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    disabled={page * 50 >= shownItems.length}
                    onClick={() => setPage((p) => p + 1)}
                    style={{
                      cursor: page * 50 >= shownItems.length ? 'not-allowed' : 'pointer',
                      opacity: page * 50 >= shownItems.length ? 0.5 : 1,
                      background: 'none',
                      border: 'none',
                      padding: '2px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setStep('values')}
                  disabled={selectedItemsMap.size === 0}
                >
                  Add values for selection
                </Button>
                <Button
                  variant="primary"
                  onClick={handleAssign}
                  disabled={selectedItemsMap.size === 0}
                >
                  Assign
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Values Table */}
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
                        padding: '12px 20px',
                        borderBottom: '1px solid #eef0f3',
                        color: '#475569',
                        fontWeight: 600,
                      }}
                    >
                      Product Name
                    </th>
                    <th
                      style={{
                        padding: '12px 20px',
                        borderBottom: '1px solid #eef0f3',
                        color: '#475569',
                        fontWeight: 600,
                      }}
                    >
                      Product Code
                    </th>
                    <th
                      style={{
                        padding: '12px 20px',
                        borderBottom: '1px solid #eef0f3',
                        color: '#475569',
                        fontWeight: 600,
                      }}
                    >
                      HSN/SAC
                    </th>
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
                </thead>
                <tbody>
                  {Array.from(selectedItemsMap.values()).map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                      <td style={{ padding: '12px 20px' }}>
                        <span style={{ color: '#2563eb' }}>{item.name}</span>
                      </td>
                      <td style={{ padding: '12px 20px' }}>{item.sku || '-'}</td>
                      <td style={{ padding: '12px 20px' }}>
                        {item.hsnCode || '-'}
                      </td>
                      <td style={{ padding: '8px 20px' }}>
                        <input
                          type="number"
                          value={itemInputs[item.id]?.quantity ?? 1}
                          onChange={(e) =>
                            setItemInputs((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...prev[item.id],
                                quantity: e.target.value === '' ? '' : Number(e.target.value),
                              },
                            }))
                          }
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
                              [item.id]: {
                                ...prev[item.id],
                                rate: e.target.value === '' ? '' : Number(e.target.value),
                              },
                            }))
                          }
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
                                [item.id]: {
                                  ...prev[item.id],
                                  discount: e.target.value === '' ? '' : Number(e.target.value),
                                },
                              }))
                            }
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
                    </tr>
                  ))}
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
              <span style={{ fontSize: 13, color: '#64748b' }}>
                {selectedItemsMap.size} selected
              </span>
              <div style={{ display: 'flex', gap: 12 }}>
                <Button variant="secondary" onClick={() => setStep('select')}>
                  Back
                </Button>
                <Button variant="primary" onClick={handleAssign}>
                  Assign
                </Button>
              </div>
            </div>
          </>
        )}
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
