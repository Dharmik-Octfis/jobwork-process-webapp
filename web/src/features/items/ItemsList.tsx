import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemsApi } from './items.api.ts';
import { Plus, Package, SlidersHorizontal, ShoppingBag } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { ItemDetail } from './ItemDetail';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Pagination } from '../../components/ui/Pagination';
import { useListSearch } from '../../hooks/useListSearch';
import { useListCount } from '../../hooks/useListCount';
import { useListColumns } from '../../hooks/useListColumns';
import { CustomizeColumnsModal } from '../../components/ui/CustomizeColumnsModal';
import { ListFilterDropdown } from '../../components/ui/ListFilterDropdown';
import { CUSTOM_FIELD_PREFIX } from '../list-views/listViews.api';
import type { Item } from './items.schemas.ts';

/**
 * How each selectable column renders. Keys match the backend catalog
 * (listViews.catalog.ts); anything prefixed `cf:` is a per-org custom field read
 * out of the row's `customFields` blob, so a new custom field needs no code here.
 * `type` keeps its pill styling, which is why this returns a node, not a string.
 */
function renderItemCell(item: Item, key: string): React.ReactNode {
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
    const value = item.customFields?.[key.slice(CUSTOM_FIELD_PREFIX.length)];
    if (value === null || value === undefined || value === '') return '-';
    return Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (key === 'type') {
    return (
      <span
        style={{
          padding: '2px 8px',
          background: item.type === 'Goods' ? '#e0e7ff' : '#dcfce7',
          color: item.type === 'Goods' ? '#3730a3' : '#166534',
          borderRadius: 12,
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        {item.type}
      </span>
    );
  }
  if (key === 'name') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {item.item_type === 'Composite Item' && <ShoppingBag size={14} color="#64748b" />}
        {item.name}
      </div>
    );
  }
  const value = (item as unknown as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'createdAt' || key === 'updatedAt')
    return new Date(String(value)).toLocaleDateString();
  return String(value);
}

export function ItemsList() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedItemId = searchParams.get('id');

  // Search term (from the global top-bar box, via `?search=`) + page cursor.
  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch();

  const { data, isLoading } = useQuery({
    queryKey: ['items', orgId, search, filter, page, perPage],
    queryFn: () =>
      itemsApi.getItems(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });

  const items = data?.results ?? [];
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
  const { catalog, visible, filters, columns, save: saveColumns } = useListColumns(orgId, 'item');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);

  const queryClient = useQueryClient();
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => itemsApi.deleteItem(orgId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
      setItemToDelete(null);
    },
  });

  const headerStyle = {
    padding: '12px 16px',
    fontWeight: 600,
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase' as const,
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
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}>
        <div
          style={{
            flex: selectedItemId ? '0 0 320px' : 1,
            borderRight: selectedItemId ? '1px solid #eef0f3' : 'none',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
          }}
        >
          {/* Page Header */}
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 24px',
              background: '#fff',
              borderBottom: '1px solid #eef0f3',
            }}
          >
            <ListFilterDropdown
              filters={filters}
              value={filter}
              onChange={setFilter}
              fallbackLabel="Active Items"
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {!selectedItemId && (
                <button
                  onClick={() => setIsColumnsOpen(true)}
                  title="Customize Columns"
                  aria-label="Customize Columns"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 30,
                    height: 30,
                    borderRadius: 4,
                    border: '1px solid #e2e8f0',
                    background: '#fff',
                    cursor: 'pointer',
                    color: '#64748b',
                  }}
                >
                  <SlidersHorizontal size={15} />
                </button>
              )}
              <button
                onClick={() => navigate(`/organizations/${orgId}/items/new`)}
                style={{
                  background: '#186337',
                  color: 'white',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontWeight: 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                <Plus size={16} /> New
              </button>
            </div>
          </header>

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
                  style={{ color: '#64748b', maxWidth: 400, margin: '0 0 24px 0', lineHeight: 1.5 }}
                >
                  You haven't added any items yet. Create your first item to start creating
                  transactions.
                </p>
                <button
                  onClick={() => navigate(`/organizations/${orgId}/items/new`)}
                  style={{
                    background: '#28a745',
                    color: 'white',
                    border: 'none',
                    padding: '10px 24px',
                    borderRadius: '4px',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
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
                        padding: '8px 16px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#64748b',
                        background: '#f9f9fb',
                        borderBottom: '1px solid #eef0f3',
                      }}
                    >
                      {filters.find((f) => f.key === filter)?.label ?? 'Active Items'}
                    </div>
                    {items.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => setSearchParams({ id: item.id })}
                        style={{
                          padding: '12px 16px',
                          borderBottom: '1px solid #eef0f3',
                          cursor: 'pointer',
                          background: selectedItemId === item.id ? '#f1f5f9' : 'transparent',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          if (selectedItemId !== item.id)
                            e.currentTarget.style.background = '#f8fafc';
                        }}
                        onMouseLeave={(e) => {
                          if (selectedItemId !== item.id)
                            e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <div
                          style={{
                            fontSize: '13px',
                            fontWeight: 500,
                            color: '#1e293b',
                            marginBottom: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          {item.item_type === 'Composite Item' && (
                            <ShoppingBag size={14} color="#64748b" />
                          )}
                          <span>{item.name}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>SKU: {item.sku}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr
                        style={{
                          background: '#f9f9fb',
                          borderTop: '1px solid #eef0f3',
                          borderBottom: '1px solid #eef0f3',
                        }}
                      >
                        {columns.map((col) => (
                          <th key={col.key} style={headerStyle}>
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr
                          key={item.id}
                          onClick={() => setSearchParams({ id: item.id })}
                          style={{
                            borderBottom: '1px solid #eef0f3',
                            transition: 'background 0.1s',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          {columns.map((col) => (
                            <td
                              key={col.key}
                              style={{
                                padding: '12px 16px',
                                fontSize: 13,
                                // The locked column is the identity you click through on.
                                color: col.locked ? '#0062ff' : '#333',
                                fontWeight: col.locked ? 500 : 400,
                              }}
                            >
                              {renderItemCell(item, col.key)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          {/* Pagination — hidden while an item is selected (narrow master pane) */}
          {!selectedItemId && (
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
          )}
        </div>

        {/* Right Panel - Detail */}
        {selectedItemId && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ItemDetail itemId={selectedItemId} onClose={() => setSearchParams({})} />
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
    </div>
  );
}
