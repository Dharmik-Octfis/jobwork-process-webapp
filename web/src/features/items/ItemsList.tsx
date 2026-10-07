import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notify } from '../../lib/notify';
import { toApiErrorMessage } from '../../api/client';
import { itemsApi } from './items.api.ts';
import {
  Plus,
  Package,
  SlidersHorizontal,
  ShoppingBag,
  Image as ImageIcon,
  List,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  ArrowUpDown,
  Upload,
  Download,
  Settings,
  RefreshCw,
  RotateCcw,
  AlignLeft,
  Search,
  Check,
  CheckCircle2,
  History,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useState, useRef, useEffect, useMemo } from 'react';
import { ItemDetail } from './ItemDetail';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Pagination } from '../../components/ui/Pagination';
import { useListSearch } from '../../hooks/useListSearch';
import { patchListRow, releaseListRow, useListRowRetention } from '../../hooks/useListRowRetention';
import { useListCount } from '../../hooks/useListCount';
import { useListColumns } from '../../hooks/useListColumns';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../components/ui/ListFilterDropdown';
import { CUSTOM_FIELD_PREFIX, type ColumnDef } from '../list-views/listViews.api';
import type { Item } from './items.schemas.ts';
import { useActiveCustomFields } from '../custom-fields/customFields.api';
import { formatDate } from '../../lib/formatDate';
import type { CustomFieldDefinition } from '../custom-fields/customFields.schemas';
import { BulkActionBar } from '../../components/ui/BulkActionBar';

/** Default columns matching Zoho Books Item List */
const DEFAULT_ZOHO_ITEM_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', locked: true },
  { key: 'sku', label: 'SKU', defaultVisible: true },
  { key: 'purchaseDescription', label: 'Purchase Description', defaultVisible: true },
  { key: 'costPrice', label: 'Purchase Rate', defaultVisible: true },
  { key: 'salesDescription', label: 'Description', defaultVisible: true },
  { key: 'sellingPrice', label: 'Rate', defaultVisible: true },
  { key: 'openingStock', label: 'Stock On Hand', defaultVisible: true },
  { key: 'hsnCode', label: 'HSN/SAC', defaultVisible: true },
  { key: 'unit', label: 'Usage Unit', defaultVisible: true },
];

type SortField =
  | 'name'
  | 'stockOnHand'
  | 'reorderLevel'
  | 'costPrice'
  | 'sellingPrice'
  | 'sku'
  | 'updatedAt'
  | 'createdAt';

function ItemThumbnailImage({
  orgId,
  itemId,
  imageKey,
}: {
  orgId: string;
  itemId: string;
  imageKey: string;
}) {
  const { data: url } = useQuery({
    queryKey: ['signedUrl', orgId, itemId, imageKey],
    queryFn: () => itemsApi.getSignedUrl(orgId, itemId, imageKey),
    staleTime: 10 * 60 * 1000,
  });

  if (!url) {
    return <ImageIcon size={15} color="#94a3b8" />;
  }

  return (
    <img
      src={url}
      alt="Thumbnail"
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  );
}

/**
 * How each selectable column renders. Keys match the backend catalog
 * (listViews.catalog.ts); anything prefixed `cf:` is a per-org custom field read
 * out of the row's `customFields` blob.
 */
function renderItemCell(
  item: Item,
  key: string,
  orgId: string,
  isTextClipped: boolean,
  customFieldsDef?: CustomFieldDefinition[],
): React.ReactNode {
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    const cfKey = key.slice(CUSTOM_FIELD_PREFIX.length);
    const value = item.customFields?.[cfKey];
    if (value === null || value === undefined || value === '') return '-';

    const def = customFieldsDef?.find((d) => d.key === cfKey);
    if (def) {
      if (def.dataType === 'select' || def.dataType === 'multi_select') {
        const options = def.config?.options || [];
        if (Array.isArray(value)) {
          return value.map((v) => options.find((o) => o.id === v)?.label || v).join(', ');
        }
        return options.find((o) => o.id === value)?.label || String(value);
      }

      if (['date', 'datetime', 'time'].includes(def.dataType)) {
        if (typeof value === 'string' && !isNaN(Date.parse(value))) {
          const d = new Date(value);
          if (def.dataType === 'date') return formatDate(value);
          if (def.dataType === 'datetime')
            return `${formatDate(value)}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          if (def.dataType === 'time')
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      }
    }

    return Array.isArray(value) ? value.join(', ') : String(value);
  }

  if (key === 'name') {
    const imageKey =
      item.frontImage && typeof item.frontImage === 'object' && 'key' in item.frontImage
        ? item.frontImage.key
        : typeof item.frontImage === 'string'
          ? item.frontImage
          : null;

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 4,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          {imageKey ? (
            <ItemThumbnailImage orgId={orgId} itemId={item.id} imageKey={imageKey} />
          ) : (
            <ImageIcon size={15} color="#94a3b8" />
          )}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            minWidth: 0,
            ...(isTextClipped
              ? {
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '260px',
                }
              : {}),
          }}
        >
          {item.itemStructure === 'composite' && <ShoppingBag size={14} color="#64748b" />}
          <span style={{ color: '#0284c7', fontWeight: 600, cursor: 'pointer' }}>{item.name}</span>
        </div>
      </div>
    );
  }

  if (key === 'sku') {
    return item.sku || '-';
  }

  if (key === 'purchaseDescription') {
    return (
      <span
        style={
          isTextClipped
            ? {
                display: 'inline-block',
                maxWidth: '180px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }
            : undefined
        }
      >
        {item.purchaseDescription || '-'}
      </span>
    );
  }

  if (key === 'costPrice') {
    return item.costPrice !== null && item.costPrice !== undefined
      ? `₹${Number(item.costPrice).toFixed(2)}`
      : '-';
  }

  if (key === 'salesDescription') {
    return (
      <span
        style={
          isTextClipped
            ? {
                display: 'inline-block',
                maxWidth: '180px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }
            : undefined
        }
      >
        {item.salesDescription || '-'}
      </span>
    );
  }

  if (key === 'sellingPrice') {
    return item.sellingPrice !== null && item.sellingPrice !== undefined
      ? `₹${Number(item.sellingPrice).toFixed(2)}`
      : '₹0.00';
  }

  if (key === 'openingStock') {
    return Number(item.openingStock ?? 0).toFixed(2);
  }

  if (key === 'hsnCode') {
    return item.hsnCode || '-';
  }

  if (key === 'unit') {
    return item.unit || '-';
  }

  if (key === 'type') {
    const isGoods = item.itemType === 'goods';
    return (
      <span
        style={{
          padding: '2.5px 9px',
          background: isGoods ? '#f0f7fd' : '#ecfdf5',
          color: isGoods ? '#0284c7' : '#047857',
          border: `1px solid ${isGoods ? 'rgba(2, 132, 199, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`,
          borderRadius: 12,
          fontSize: 11.5,
          fontWeight: 600,
          letterSpacing: '0.02em',
          textTransform: 'capitalize',
          display: 'inline-block',
        }}
      >
        {item.itemType}
      </span>
    );
  }

  const value = (item as unknown as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'createdAt' || key === 'updatedAt') return formatDate(String(value));
  return String(value);
}

export function ItemsList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedItemId = searchParams.get('id');

  // Search term (from the global top-bar box, via `?search=`) + page cursor.
  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch();

  const structuralSharing = useListRowRetention(
    ['items', orgId],
    `${search}|${filter}|${page}|${perPage}`,
  );
  const { data, isLoading } = useQuery({
    queryKey: ['items', orgId, search, filter, page, perPage],
    queryFn: () =>
      itemsApi.getItems(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
    structuralSharing,
  });

  const items = useMemo(() => data?.results ?? [], [data?.results]);
  const pageContext = data?.pageContext;

  // Total row count — fetched only when the user clicks "view".
  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['items-count', orgId, search, filter], () =>
    itemsApi.getItemCount(orgId!, { search: search || undefined, filter }),
  );

  // Column layout ("Customize Columns") — per user, per org, per module.
  const {
    catalog,
    visible,
    filters,
    columns: apiColumns,
    save: saveColumns,
  } = useListColumns(orgId, 'item');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);

  // Resolve active columns: use user's saved/selected columns, or fall back to defaults if not yet loaded
  const activeColumns = useMemo(() => {
    if (apiColumns.length > 0) {
      return apiColumns;
    }
    return DEFAULT_ZOHO_ITEM_COLUMNS;
  }, [apiColumns]);

  // View state & menus (matching Zoho Books items list)
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const [isViewModeMenuOpen, setIsViewModeMenuOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<'sort' | 'import' | 'export' | null>(null);

  const [viewDensity, setViewDensity] = useState<'expanded' | 'collapsed'>('expanded');
  const [layoutMode, setLayoutMode] = useState<'table' | 'grid'>('table');
  const [isTextClipped, setIsTextClipped] = useState(true);

  // Detailed sorting matching Zoho Books
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  const columnMenuRef = useRef<HTMLDivElement>(null);
  const viewModeMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Click outside listener for all dropdowns
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setIsColumnMenuOpen(false);
      }
      if (viewModeMenuRef.current && !viewModeMenuRef.current.contains(e.target as Node)) {
        setIsViewModeMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
        setActiveSubmenu(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Sorted items
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      let result: number;
      switch (sortField) {
        case 'name':
          result = a.name.localeCompare(b.name);
          break;
        case 'sku':
          result = (a.sku || '').localeCompare(b.sku || '');
          break;
        case 'stockOnHand':
          result = Number(a.openingStock ?? 0) - Number(b.openingStock ?? 0);
          break;
        case 'costPrice':
          result = Number(a.costPrice ?? 0) - Number(b.costPrice ?? 0);
          break;
        case 'sellingPrice':
          result = Number(a.sellingPrice ?? 0) - Number(b.sellingPrice ?? 0);
          break;
        case 'reorderLevel':
          result = 0;
          break;
        case 'updatedAt':
          result = new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
          break;
        case 'createdAt':
        default:
          result = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
          break;
      }
      return sortAsc ? result : -result;
    });
  }, [items, sortField, sortAsc]);

  const queryClient = useQueryClient();
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

  const { data: customFieldsDef } = useActiveCustomFields(orgId, 'item');

  const deleteMutation = useMutation({
    mutationFn: (id: string) => itemsApi.deleteItem(orgId!, id),
    onSuccess: (_, id) => {
      releaseListRow(['items', orgId], id);
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
      setItemToDelete(null);
    },
    onError: () => setItemToDelete(null),
  });

  const headerStyle: React.CSSProperties = {
    padding: '11px 16px',
    fontWeight: 600,
    fontSize: 11.5,
    color: '#475569',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  };

  const setActiveForSelected = async (isActive: boolean) => {
    setIsProcessing(true);
    try {
      const outcomes = await Promise.allSettled(
        selectedIds.map((id) => itemsApi.updateItem({ orgId: orgId!, id, data: { isActive } })),
      );
      // Patched, not invalidated: "Active Items" would drop every row just marked inactive.
      selectedIds.forEach((id, index) => {
        if (outcomes[index]!.status === 'fulfilled') {
          patchListRow<Item>(queryClient, ['items', orgId], id, { isActive });
        }
      });
      setSelectedIds([]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkActive = () => setActiveForSelected(true);
  const handleMarkInactive = () => setActiveForSelected(false);

  const handleDeleteSelected = async () => {
    setIsBulkDeleteDialogOpen(true);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    if (selectedIds.length === items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map((i) => i.id));
    }
  };

  const cellPadding = viewDensity === 'expanded' ? '12px 16px' : '7px 16px';

  // Export helper
  const handleExportCsv = (type: 'items' | 'view' | 'stock') => {
    let headers: string[];
    let rows: (string | number)[][];

    if (type === 'stock') {
      headers = ['Item Name', 'SKU', 'Stock On Hand', 'Usage Unit'];
      rows = items.map((i) => [i.name, i.sku || '', Number(i.openingStock ?? 0), i.unit || '']);
    } else if (type === 'view') {
      headers = activeColumns.map((c) => c.label);
      rows = sortedItems.map((item) => {
        return activeColumns.map((c) => {
          const val = (item as unknown as Record<string, unknown>)[c.key];
          return val !== null && val !== undefined ? String(val) : '';
        });
      });
    } else {
      headers = [
        'Item Name',
        'SKU',
        'Type',
        'Purchase Description',
        'Purchase Rate',
        'Sales Description',
        'Rate',
        'Stock On Hand',
        'HSN/SAC',
        'Unit',
      ];
      rows = items.map((i) => [
        i.name,
        i.sku || '',
        i.itemType || '',
        i.purchaseDescription || '',
        Number(i.costPrice || 0),
        i.salesDescription || '',
        Number(i.sellingPrice || 0),
        Number(i.openingStock ?? 0),
        i.hsnCode || '',
        i.unit || '',
      ]);
    }

    const csvContent = [
      headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','),
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${type}_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIsMoreMenuOpen(false);
    setActiveSubmenu(null);
  };

  const handleSelectSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(field === 'name' || field === 'sku');
    }
    setIsMoreMenuOpen(false);
    setActiveSubmenu(null);
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Main Content Area */}
      <div
        className={`master-detail-container ${selectedItemId ? 'has-selection' : ''}`}
        style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}
      >
        <div
          className="master-pane"
          style={{
            flex: selectedItemId ? '0 0 320px' : 1,
            borderRight: selectedItemId ? '1px solid #e2e8f0' : 'none',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
          }}
        >
          {/* Page Header */}
          {!selectedItemId && selectedIds.length > 0 ? (
            <BulkActionBar
              selectedCount={selectedIds.length}
              onClearSelection={() => setSelectedIds([])}
              onMarkActive={handleMarkActive}
              onMarkInactive={handleMarkInactive}
              onDelete={handleDeleteSelected}
              isProcessing={isProcessing}
            />
          ) : (
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 24px',
                background: '#fff',
                borderBottom: '1px solid #e2e8f0',
              }}
            >
              <ListFilterDropdown
                filters={filters}
                value={filter}
                onChange={setFilter}
                fallbackLabel="All Items"
              />

              {/* Zoho-styled top right controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {!selectedItemId && (
                  <>
                    {/* View density dropdown (Expanded / Collapsed View) */}
                    <div ref={viewModeMenuRef} style={{ position: 'relative' }}>
                      <button
                        type="button"
                        onClick={() => setIsViewModeMenuOpen((o) => !o)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          background: '#fff',
                          border: '1px solid #e2e8f0',
                          borderRadius: 6,
                          padding: '6px 9px',
                          fontSize: 12.5,
                          fontWeight: 500,
                          color: '#475569',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        title="View Density"
                      >
                        <List size={14} />
                        <ChevronDown size={13} />
                      </button>
                      {isViewModeMenuOpen && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: 5,
                            background: '#fff',
                            borderRadius: 8,
                            boxShadow:
                              '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)',
                            border: '1px solid #e2e8f0',
                            minWidth: 165,
                            zIndex: 60,
                            padding: '4px 0',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setViewDensity('expanded');
                              setIsViewModeMenuOpen(false);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              width: '100%',
                              padding: '8px 14px',
                              border: 'none',
                              background: viewDensity === 'expanded' ? '#0284c7' : 'none',
                              color: viewDensity === 'expanded' ? '#fff' : '#1e293b',
                              fontSize: 13,
                              fontWeight: 500,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <List size={14} />
                              Expanded View
                            </span>
                            {viewDensity === 'expanded' && <Check size={14} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setViewDensity('collapsed');
                              setIsViewModeMenuOpen(false);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              width: '100%',
                              padding: '8px 14px',
                              border: 'none',
                              background: viewDensity === 'collapsed' ? '#0284c7' : 'none',
                              color: viewDensity === 'collapsed' ? '#fff' : '#1e293b',
                              fontSize: 13,
                              fontWeight: 500,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <AlignLeft size={14} />
                              Collapsed View
                            </span>
                            {viewDensity === 'collapsed' && <Check size={14} />}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Table View / Grid View toggle buttons */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        background: '#f1f5f9',
                        borderRadius: 6,
                        padding: 2,
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setLayoutMode('table')}
                        title="List View"
                        style={{
                          padding: '4px 7px',
                          border: 'none',
                          borderRadius: 4,
                          background: layoutMode === 'table' ? '#fff' : 'transparent',
                          color: layoutMode === 'table' ? '#0284c7' : '#64748b',
                          boxShadow: layoutMode === 'table' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <List size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setLayoutMode('grid')}
                        title="Grid / Gallery View"
                        style={{
                          padding: '4px 7px',
                          border: 'none',
                          borderRadius: 4,
                          background: layoutMode === 'grid' ? '#fff' : 'transparent',
                          color: layoutMode === 'grid' ? '#0284c7' : '#64748b',
                          boxShadow: layoutMode === 'grid' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <LayoutGrid size={15} />
                      </button>
                    </div>
                  </>
                )}

                {/* Primary New Item button (brand ocean blue) */}
                <button
                  onClick={() =>
                    navigate(`/organizations/${orgId}/items/new`, {
                      state: { returnUrl: location.pathname + location.search },
                    })
                  }
                  style={{
                    background: '#0284c7',
                    color: 'white',
                    border: 'none',
                    padding: '7px 15px',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#0369a1';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#0284c7';
                  }}
                >
                  <Plus size={16} /> New
                </button>

                {/* More Options (...) button with Zoho Submenus */}
                {!selectedItemId && (
                  <div ref={moreMenuRef} style={{ position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen((o) => !o);
                        setActiveSubmenu(null);
                      }}
                      title="More Options"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        border: isMoreMenuOpen ? '1px solid #bae6fd' : '1px solid #d1d5db',
                        background: isMoreMenuOpen ? '#f0f9ff' : '#fff',
                        cursor: 'pointer',
                        color: isMoreMenuOpen ? '#0284c7' : '#4b5563',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>

                    {isMoreMenuOpen && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          marginTop: 5,
                          background: '#fff',
                          borderRadius: 8,
                          boxShadow:
                            '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)',
                          border: '1px solid #e2e8f0',
                          minWidth: 220,
                          zIndex: 60,
                          padding: '6px 0',
                        }}
                      >
                        {/* 1. Sort by */}
                        <div
                          style={{ position: 'relative' }}
                          onMouseEnter={() => setActiveSubmenu('sort')}
                        >
                          <div
                            onClick={() =>
                              setActiveSubmenu(activeSubmenu === 'sort' ? null : 'sort')
                            }
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '9px 16px',
                              cursor: 'pointer',
                              background: activeSubmenu === 'sort' ? '#0284c7' : 'transparent',
                              color: activeSubmenu === 'sort' ? '#ffffff' : '#334155',
                              fontSize: 13,
                              fontWeight: 500,
                              transition: 'background 0.1s ease',
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <ArrowUpDown
                                size={15}
                                color={activeSubmenu === 'sort' ? '#ffffff' : '#0284c7'}
                              />
                              Sort by
                            </span>
                            <ChevronRight
                              size={14}
                              color={activeSubmenu === 'sort' ? '#ffffff' : '#94a3b8'}
                            />
                          </div>

                          {/* Sort Submenu to the LEFT (Screenshot 1) */}
                          {activeSubmenu === 'sort' && (
                            <div
                              style={{
                                position: 'absolute',
                                top: 0,
                                right: '100%',
                                marginRight: 6,
                                background: '#fff',
                                borderRadius: 8,
                                border: '1px solid #e2e8f0',
                                boxShadow:
                                  '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)',
                                minWidth: 195,
                                zIndex: 70,
                                padding: '6px 0',
                              }}
                            >
                              {[
                                { key: 'name', label: 'Name' },
                                { key: 'stockOnHand', label: 'Stock On Hand' },
                                { key: 'reorderLevel', label: 'Reorder Level' },
                                { key: 'costPrice', label: 'Purchase Rate' },
                                { key: 'sellingPrice', label: 'Rate' },
                                { key: 'sku', label: 'SKU' },
                                { key: 'updatedAt', label: 'Last Modified Time' },
                                { key: 'createdAt', label: 'Created Time' },
                              ].map((option) => {
                                const isSelected = sortField === option.key;
                                return (
                                  <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => handleSelectSort(option.key as SortField)}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      width: '100%',
                                      padding: '8px 16px',
                                      border: 'none',
                                      background: isSelected ? '#f0f9ff' : 'transparent',
                                      color: isSelected ? '#0284c7' : '#334155',
                                      fontWeight: isSelected ? 600 : 400,
                                      fontSize: 13,
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                    }}
                                    onMouseEnter={(e) => {
                                      if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                                    }}
                                    onMouseLeave={(e) => {
                                      if (!isSelected)
                                        e.currentTarget.style.background = 'transparent';
                                    }}
                                  >
                                    <span>{option.label}</span>
                                    {isSelected &&
                                      (sortAsc ? (
                                        <ArrowUp size={14} color="#0284c7" />
                                      ) : (
                                        <ArrowDown size={14} color="#0284c7" />
                                      ))}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* 2. Import */}
                        <div
                          style={{ position: 'relative' }}
                          onMouseEnter={() => setActiveSubmenu('import')}
                        >
                          <div
                            onClick={() =>
                              setActiveSubmenu(activeSubmenu === 'import' ? null : 'import')
                            }
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '9px 16px',
                              cursor: 'pointer',
                              background: activeSubmenu === 'import' ? '#0284c7' : 'transparent',
                              color: activeSubmenu === 'import' ? '#ffffff' : '#334155',
                              fontSize: 13,
                              fontWeight: 500,
                              transition: 'background 0.1s ease',
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <Download
                                size={15}
                                color={activeSubmenu === 'import' ? '#ffffff' : '#0284c7'}
                              />
                              Import
                            </span>
                            <ChevronRight
                              size={14}
                              color={activeSubmenu === 'import' ? '#ffffff' : '#94a3b8'}
                            />
                          </div>

                          {/* Import Submenu to the LEFT (Screenshot 2) */}
                          {activeSubmenu === 'import' && (
                            <div
                              style={{
                                position: 'absolute',
                                top: 0,
                                right: '100%',
                                marginRight: 6,
                                background: '#fff',
                                borderRadius: 8,
                                border: '1px solid #e2e8f0',
                                boxShadow:
                                  '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)',
                                minWidth: 195,
                                zIndex: 70,
                                padding: '6px 0',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  navigate(`/organizations/${orgId}/items/import`);
                                  setIsMoreMenuOpen(false);
                                  setActiveSubmenu(null);
                                }}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  padding: '8px 16px',
                                  border: 'none',
                                  background: 'none',
                                  fontSize: 13,
                                  color: '#334155',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f9ff')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                              >
                                Import Items
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  navigate(`/organizations/${orgId}/items/opening-stock`);
                                  setIsMoreMenuOpen(false);
                                  setActiveSubmenu(null);
                                }}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  padding: '8px 16px',
                                  border: 'none',
                                  background: 'none',
                                  fontSize: 13,
                                  color: '#334155',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f9ff')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                              >
                                Import Opening Stock
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsMoreMenuOpen(false);
                                  setActiveSubmenu(null);
                                }}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  padding: '8px 16px',
                                  border: 'none',
                                  background: 'none',
                                  fontSize: 13,
                                  color: '#334155',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f9ff')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                              >
                                Import Items Images
                              </button>
                            </div>
                          )}
                        </div>

                        {/* 3. Export */}
                        <div
                          style={{ position: 'relative' }}
                          onMouseEnter={() => setActiveSubmenu('export')}
                        >
                          <div
                            onClick={() =>
                              setActiveSubmenu(activeSubmenu === 'export' ? null : 'export')
                            }
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '9px 16px',
                              cursor: 'pointer',
                              background: activeSubmenu === 'export' ? '#0284c7' : 'transparent',
                              color: activeSubmenu === 'export' ? '#ffffff' : '#334155',
                              fontSize: 13,
                              fontWeight: 500,
                              transition: 'background 0.1s ease',
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <Upload
                                size={15}
                                color={activeSubmenu === 'export' ? '#ffffff' : '#0284c7'}
                              />
                              Export
                            </span>
                            <ChevronRight
                              size={14}
                              color={activeSubmenu === 'export' ? '#ffffff' : '#94a3b8'}
                            />
                          </div>

                          {/* Export Submenu to the LEFT (Screenshot 3) */}
                          {activeSubmenu === 'export' && (
                            <div
                              style={{
                                position: 'absolute',
                                top: 0,
                                right: '100%',
                                marginRight: 6,
                                background: '#fff',
                                borderRadius: 8,
                                border: '1px solid #e2e8f0',
                                boxShadow:
                                  '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)',
                                minWidth: 195,
                                zIndex: 70,
                                padding: '6px 0',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => handleExportCsv('items')}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  padding: '8px 16px',
                                  border: 'none',
                                  background: 'none',
                                  fontSize: 13,
                                  color: '#334155',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f9ff')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                              >
                                Export Items
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExportCsv('view')}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  padding: '8px 16px',
                                  border: 'none',
                                  background: 'none',
                                  fontSize: 13,
                                  color: '#334155',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f9ff')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                              >
                                Export Current View
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExportCsv('stock')}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  padding: '8px 16px',
                                  border: 'none',
                                  background: 'none',
                                  fontSize: 13,
                                  color: '#334155',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f9ff')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                              >
                                Export Opening Stock
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsMoreMenuOpen(false);
                                  setActiveSubmenu(null);
                                }}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  padding: '8px 16px',
                                  border: 'none',
                                  background: 'none',
                                  fontSize: 13,
                                  color: '#334155',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f9ff')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                              >
                                Export Item Images
                              </button>
                            </div>
                          )}
                        </div>

                        {/* 4. Preferences */}
                        <div
                          onClick={() => {
                            navigate(`/organizations/${orgId}/settings/modules/item`);
                            setIsMoreMenuOpen(false);
                            setActiveSubmenu(null);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 16px',
                            cursor: 'pointer',
                            color: '#334155',
                            fontSize: 13,
                            fontWeight: 500,
                          }}
                          onMouseEnter={(e) => {
                            setActiveSubmenu(null);
                            e.currentTarget.style.background = '#f0f9ff';
                          }}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <Settings size={15} color="#0284c7" />
                          Preferences
                        </div>

                        {/* 5. Refresh List */}
                        <div
                          onClick={() => {
                            queryClient.invalidateQueries({ queryKey: ['items', orgId] });
                            setIsMoreMenuOpen(false);
                            setActiveSubmenu(null);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 16px',
                            cursor: 'pointer',
                            color: '#334155',
                            fontSize: 13,
                            fontWeight: 500,
                          }}
                          onMouseEnter={(e) => {
                            setActiveSubmenu(null);
                            e.currentTarget.style.background = '#f0f9ff';
                          }}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <RefreshCw size={15} color="#0284c7" />
                          Refresh List
                        </div>

                        {/* 6. Reset Column Width */}
                        <div
                          onClick={() => {
                            saveColumns.mutate(
                              DEFAULT_ZOHO_ITEM_COLUMNS.map((c) => c.key),
                              {
                                onSuccess: () => {
                                  queryClient.invalidateQueries({
                                    queryKey: ['list-view', orgId, 'item'],
                                  });
                                },
                              },
                            );
                            setIsMoreMenuOpen(false);
                            setActiveSubmenu(null);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 16px',
                            cursor: 'pointer',
                            color: '#334155',
                            fontSize: 13,
                            fontWeight: 500,
                          }}
                          onMouseEnter={(e) => {
                            setActiveSubmenu(null);
                            e.currentTarget.style.background = '#f0f9ff';
                          }}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <RotateCcw size={15} color="#0284c7" />
                          Reset Column Width
                        </div>

                        {/* 7. Validate HSN/SAC */}
                        <div
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            setActiveSubmenu(null);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 16px',
                            cursor: 'pointer',
                            color: '#334155',
                            fontSize: 13,
                            fontWeight: 500,
                          }}
                          onMouseEnter={(e) => {
                            setActiveSubmenu(null);
                            e.currentTarget.style.background = '#f0f9ff';
                          }}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <CheckCircle2 size={15} color="#0284c7" />
                          Validate HSN/SAC
                        </div>

                        {/* 8. HSN/SAC Update History */}
                        <div
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            setActiveSubmenu(null);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 16px',
                            cursor: 'pointer',
                            color: '#334155',
                            fontSize: 13,
                            fontWeight: 500,
                          }}
                          onMouseEnter={(e) => {
                            setActiveSubmenu(null);
                            e.currentTarget.style.background = '#f0f9ff';
                          }}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <History size={15} color="#0284c7" />
                          HSN/SAC Update History
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </header>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                Loading items...
              </div>
            ) : items.length === 0 && search ? (
              <div style={{ padding: '48px 32px', textAlign: 'center', color: '#64748b' }}>
                No items match &ldquo;{search}&rdquo;.
              </div>
            ) : items.length === 0 ? (
              <div
                style={{
                  padding: '64px 32px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    background: '#f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '16px',
                  }}
                >
                  <Package size={40} color="#94a3b8" />
                </div>
                <h2
                  style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}
                >
                  No Items Yet
                </h2>
                <p
                  style={{
                    color: '#64748b',
                    maxWidth: 400,
                    margin: '0 0 24px 0',
                    lineHeight: 1.5,
                  }}
                >
                  You haven't added any items yet. Create your first item to start creating
                  transactions.
                </p>
                <button
                  onClick={() =>
                    navigate(`/organizations/${orgId}/items/new`, {
                      state: { returnUrl: location.pathname + location.search },
                    })
                  }
                  style={{
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    color: 'white',
                    border: 'none',
                    padding: '10px 24px',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(2, 132, 199, 0.25)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(2, 132, 199, 0.35)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(2, 132, 199, 0.25)';
                    e.currentTarget.style.transform = 'none';
                  }}
                >
                  Create Item
                </button>
              </div>
            ) : (
              <div>
                {selectedItemId ? (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div
                      style={{
                        padding: '10px 16px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#64748b',
                        background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        letterSpacing: '0.03em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {filters.find((f) => f.key === filter)?.label ?? 'Active Items'}
                    </div>
                    {sortedItems.map((item) => {
                      const isSelected = selectedItemId === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => setSearchParams({ id: item.id })}
                          style={{
                            padding: '12px 16px',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                            background: isSelected ? '#f0f7fd' : 'transparent',
                            borderLeft: isSelected ? '3px solid #0284c7' : '3px solid transparent',
                            transition: 'all 0.12s ease',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: '13px',
                                fontWeight: isSelected ? 600 : 500,
                                color: isSelected ? '#0284c7' : '#1e293b',
                                marginBottom: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              {item.itemStructure === 'composite' && (
                                <ShoppingBag size={14} color="#64748b" />
                              )}
                              <span
                                style={{
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {item.name}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: '12px',
                                color: '#64748b',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              SKU: {item.sku}
                            </div>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'flex-end',
                              marginLeft: '12px',
                              flexShrink: 0,
                            }}
                          >
                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                              ₹{item.sellingPrice ? Number(item.sellingPrice).toFixed(2) : '0.00'}
                            </div>
                            {item.isActive === false && (
                              <div
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 500,
                                  color: '#94a3b8',
                                  marginTop: '4px',
                                }}
                              >
                                INACTIVE
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : layoutMode === 'grid' ? (
                  /* Cards / Grid view matching Zoho Books */
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                      gap: 16,
                      padding: 24,
                    }}
                  >
                    {sortedItems.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => setSearchParams({ id: item.id })}
                        style={{
                          background: '#fff',
                          border: '1px solid #e2e8f0',
                          borderRadius: 8,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          flexDirection: 'column',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = '#0284c7';
                          e.currentTarget.style.boxShadow = '0 4px 12px rgba(2, 132, 199, 0.12)';
                          e.currentTarget.style.transform = 'translateY(-2px)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#e2e8f0';
                          e.currentTarget.style.boxShadow = 'none';
                          e.currentTarget.style.transform = 'none';
                        }}
                      >
                        <div
                          style={{
                            height: 140,
                            background: '#f8fafc',
                            borderBottom: '1px solid #e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                          }}
                        >
                          {item.frontImage &&
                          typeof item.frontImage === 'object' &&
                          'key' in item.frontImage ? (
                            <ItemThumbnailImage
                              orgId={orgId!}
                              itemId={item.id}
                              imageKey={item.frontImage.key}
                            />
                          ) : (
                            <ImageIcon size={38} color="#cbd5e1" />
                          )}
                          <div style={{ position: 'absolute', top: 8, right: 8 }}>
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: 12,
                                fontSize: 10.5,
                                fontWeight: 600,
                                background: item.itemType === 'goods' ? '#e0f2fe' : '#ecfdf5',
                                color: item.itemType === 'goods' ? '#0369a1' : '#047857',
                                textTransform: 'uppercase',
                              }}
                            >
                              {item.itemType}
                            </span>
                          </div>
                        </div>
                        <div
                          style={{
                            padding: '14px 16px',
                            display: 'flex',
                            flexDirection: 'column',
                            flex: 1,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: '#0284c7',
                              marginBottom: 4,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {item.name}
                          </div>
                          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
                            SKU: {item.sku || '-'}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginTop: 'auto',
                              paddingTop: 8,
                              borderTop: '1px solid #f1f5f9',
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontSize: 10.5,
                                  color: '#94a3b8',
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                }}
                              >
                                Rate
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                                ₹{Number(item.sellingPrice || 0).toFixed(2)}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div
                                style={{
                                  fontSize: 10.5,
                                  color: '#94a3b8',
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                }}
                              >
                                Stock
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 500, color: '#475569' }}>
                                {Number(item.openingStock ?? 0).toFixed(2)} {item.unit || ''}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="responsive-table-wrapper">
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr
                          style={{
                            background: '#f8fafc',
                            borderTop: '1px solid #e2e8f0',
                            borderBottom: '1px solid #e2e8f0',
                          }}
                        >
                          {/* Column 1: Customize button & Select All (Screenshot 2 & 3) */}
                          <th
                            style={{
                              width: 64,
                              ...headerStyle,
                              paddingLeft: 14,
                              paddingRight: 6,
                              textAlign: 'left',
                            }}
                          >
                            <div
                              ref={columnMenuRef}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                position: 'relative',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => setIsColumnMenuOpen((prev) => !prev)}
                                title="Customize Columns & View"
                                aria-label="Customize Columns"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: isColumnMenuOpen ? '#e0f2fe' : 'transparent',
                                  border: 'none',
                                  borderRadius: 4,
                                  padding: '3px 4px',
                                  cursor: 'pointer',
                                  color: isColumnMenuOpen ? '#0284c7' : '#64748b',
                                  transition: 'all 0.15s ease',
                                }}
                                onMouseEnter={(e) => {
                                  if (!isColumnMenuOpen) e.currentTarget.style.color = '#0284c7';
                                }}
                                onMouseLeave={(e) => {
                                  if (!isColumnMenuOpen) e.currentTarget.style.color = '#64748b';
                                }}
                              >
                                <SlidersHorizontal size={14} />
                              </button>

                              <input
                                type="checkbox"
                                checked={items.length > 0 && selectedIds.length === items.length}
                                onChange={toggleAll}
                                style={{ cursor: 'pointer', accentColor: '#0284c7' }}
                              />

                              {/* Customize Dropdown Menu */}
                              {isColumnMenuOpen && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    marginTop: 6,
                                    background: '#fff',
                                    borderRadius: 8,
                                    boxShadow:
                                      '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                                    border: '1px solid #e2e8f0',
                                    minWidth: 185,
                                    zIndex: 50,
                                    overflow: 'hidden',
                                    padding: '4px 0',
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsColumnMenuOpen(false);
                                      setIsColumnsOpen(true);
                                    }}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 10,
                                      width: '100%',
                                      padding: '9px 14px',
                                      border: 'none',
                                      background: 'none',
                                      fontSize: 13,
                                      fontWeight: 500,
                                      color: '#1e293b',
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = '#f0f7fd';
                                      e.currentTarget.style.color = '#0284c7';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = 'none';
                                      e.currentTarget.style.color = '#1e293b';
                                    }}
                                  >
                                    <SlidersHorizontal size={14} color="#0284c7" />
                                    Customize Columns
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsTextClipped((prev) => !prev);
                                      setIsColumnMenuOpen(false);
                                    }}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 10,
                                      width: '100%',
                                      padding: '9px 14px',
                                      border: 'none',
                                      background: 'none',
                                      fontSize: 13,
                                      fontWeight: 500,
                                      color: '#1e293b',
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = '#f0f7fd';
                                      e.currentTarget.style.color = '#0284c7';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = 'none';
                                      e.currentTarget.style.color = '#1e293b';
                                    }}
                                  >
                                    <AlignLeft size={14} color="#64748b" />
                                    {isTextClipped ? 'Wrap Text' : 'Clip Text'}
                                  </button>
                                </div>
                              )}
                            </div>
                          </th>

                          {/* Dynamic Columns */}
                          {activeColumns.map((col) => (
                            <th
                              key={col.key}
                              style={{
                                ...headerStyle,
                                cursor: col.key === 'name' ? 'pointer' : 'default',
                                userSelect: 'none',
                              }}
                              onClick={() => {
                                if (col.key === 'name') {
                                  setSortField('name');
                                  setSortAsc((prev) => !prev);
                                }
                              }}
                            >
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                {col.label}
                                {sortField === col.key && (
                                  <span style={{ color: '#0284c7', fontSize: 11, fontWeight: 700 }}>
                                    {sortAsc ? '▲' : '▼'}
                                  </span>
                                )}
                              </div>
                            </th>
                          ))}

                          {/* Search Icon at Far Right (Screenshot 2) */}
                          <th
                            style={{
                              width: 44,
                              ...headerStyle,
                              textAlign: 'center',
                              padding: '11px 12px',
                            }}
                          >
                            <button
                              type="button"
                              title="Search items"
                              onClick={() => {
                                const searchInput = document.querySelector(
                                  'input[type="search"], input[placeholder*="Search"]',
                                ) as HTMLInputElement | null;
                                searchInput?.focus();
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#64748b',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 0,
                              }}
                            >
                              <Search size={14} />
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedItems.map((item) => {
                          const isChecked = selectedIds.includes(item.id);
                          return (
                            <tr
                              key={item.id}
                              onClick={() => setSearchParams({ id: item.id })}
                              style={{
                                borderBottom: '1px solid #f1f5f9',
                                transition: 'background 0.12s ease',
                                cursor: 'pointer',
                                background: isChecked ? '#f0f7fd' : 'transparent',
                              }}
                              onMouseEnter={(e) => {
                                if (!isChecked) e.currentTarget.style.background = '#f8fafc';
                              }}
                              onMouseLeave={(e) => {
                                if (!isChecked) e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              {/* Checkbox column */}
                              <td
                                style={{
                                  width: 64,
                                  padding: cellPadding,
                                  paddingLeft: 36,
                                  paddingRight: 6,
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSelection(item.id)}
                                  style={{ cursor: 'pointer', accentColor: '#0284c7' }}
                                />
                              </td>

                              {/* Data columns */}
                              {activeColumns.map((col) => (
                                <td
                                  key={col.key}
                                  style={{
                                    padding: cellPadding,
                                    fontSize: 13,
                                    color: col.locked ? '#0284c7' : '#334155',
                                    fontWeight: col.locked ? 600 : 400,
                                    verticalAlign: 'middle',
                                    ...(isTextClipped && col.key !== 'name'
                                      ? {
                                          maxWidth: '220px',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                        }
                                      : {}),
                                  }}
                                >
                                  {renderItemCell(
                                    item,
                                    col.key,
                                    orgId!,
                                    isTextClipped,
                                    customFieldsDef,
                                  )}
                                </td>
                              ))}

                              {/* Spacer cell for search icon alignment */}
                              <td style={{ width: 44, padding: 0 }} />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pagination — hidden while an item is selected (narrow master pane) */}
          <Pagination
            pageContext={pageContext}
            page={page}
            onPageChange={setPage}
            perPage={perPage}
            onPerPageChange={setPerPage}
            total={total}
            isCounting={isCounting}
            onRequestCount={() => void requestCount()}
          />
        </div>

        {/* Right Panel - Detail */}
        {selectedItemId && (
          <div className="detail-pane" style={{ flex: 1, overflowY: 'auto' }}>
            <ItemDetail
              itemId={selectedItemId}
              onClose={() =>
                setSearchParams((prev) => {
                  prev.delete('id');
                  return prev;
                })
              }
            />
          </div>
        )}
      </div>

      <CustomizeColumnsModal
        isOpen={isColumnsOpen}
        onClose={() => setIsColumnsOpen(false)}
        catalog={catalog}
        visible={visible}
        isSaving={saveColumns.isPending}
        onSave={(cols) => saveColumns.mutate(cols, { onSuccess: () => setIsColumnsOpen(false) })}
      />

      <ConfirmDialog
        isOpen={!!itemToDelete}
        title="Delete Item"
        message="Are you sure you want to delete this item? This action cannot be undone."
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => {
          if (itemToDelete) {
            deleteMutation.mutate(itemToDelete);
          }
        }}
        onCancel={() => setItemToDelete(null)}
      />

      <ConfirmDialog
        isOpen={isBulkDeleteDialogOpen}
        title="Delete Selected Items"
        message={`Are you sure you want to delete ${selectedIds.length} item(s)? This action cannot be undone.`}
        confirmText={isProcessing ? 'Deleting...' : 'Delete'}
        onConfirm={async () => {
          setIsProcessing(true);
          try {
            const results = await Promise.allSettled(
              selectedIds.map((id) => itemsApi.deleteItem(orgId!, id)),
            );
            selectedIds.forEach((id) => releaseListRow(['items', orgId], id));
            const refused = results.filter((r) => r.status === 'rejected');
            if (refused.length > 0) {
              const first = (refused[0] as PromiseRejectedResult).reason;
              notify.error(
                refused.length === 1
                  ? toApiErrorMessage(first)
                  : `${refused.length} items were not deleted. ${toApiErrorMessage(first)}`,
              );
            }
            queryClient.invalidateQueries({ queryKey: ['items', orgId] });
            setSelectedIds([]);
          } finally {
            setIsProcessing(false);
            setIsBulkDeleteDialogOpen(false);
          }
        }}
        onCancel={() => setIsBulkDeleteDialogOpen(false)}
      />
    </div>
  );
}
