import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemsApi } from './items.api.ts';
import { Plus, ChevronDown, Package } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { ItemDetail } from './ItemDetail';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

export function ItemsList() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedItemId = searchParams.get('id');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['items', orgId],
    queryFn: () => itemsApi.getItems(orgId!),
    enabled: Boolean(orgId),
  });

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
        <div style={{ flex: selectedItemId ? '0 0 320px' : 1, borderRight: selectedItemId ? '1px solid #eef0f3' : 'none', display: 'flex', flexDirection: 'column', background: '#fff' }}>
          
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#000', margin: 0 }}>
                All Items
              </h1>
              <ChevronDown size={16} color="#0062ff" strokeWidth={2.5} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {!selectedItemId && (
                <button
                  onClick={() => navigate(`/organizations/${orgId}/items/new`)}
                  style={{
                    background: '#0062ff',
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
                  }}
                >
                  <Plus size={16} /> New
                </button>
              )}
            </div>
          </header>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
            Loading items...
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
            <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}>
              No Items Yet
            </h2>
            <p style={{ color: '#64748b', maxWidth: 400, margin: '0 0 24px 0', lineHeight: 1.5 }}>
              You haven't added any items yet. Create your first item to start creating transactions.
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
                <div style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, color: '#64748b', background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
                  All Items
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
                      if (selectedItemId !== item.id) e.currentTarget.style.background = '#f8fafc';
                    }}
                    onMouseLeave={(e) => {
                      if (selectedItemId !== item.id) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 500, color: '#1e293b', marginBottom: '4px' }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                      SKU: {item.sku}
                    </div>
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
                    <th style={headerStyle}>NAME</th>
                    <th style={headerStyle}>SKU</th>
                    <th style={headerStyle}>TYPE</th>
                    <th style={headerStyle}>UNIT</th>
                    <th style={headerStyle}>STOCK</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSearchParams({ id: item.id })}
                      style={{ borderBottom: '1px solid #eef0f3', transition: 'background 0.1s', cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '12px 16px', color: '#0062ff', fontSize: 13, fontWeight: 500 }}>
                        {item.name}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#333', fontSize: 13 }}>
                        {item.sku}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#333', fontSize: 13 }}>
                        <span style={{ 
                          padding: '2px 8px', 
                          background: item.type === 'Goods' ? '#e0e7ff' : '#dcfce7', 
                          color: item.type === 'Goods' ? '#3730a3' : '#166534', 
                          borderRadius: 12, 
                          fontSize: 12,
                          fontWeight: 500
                        }}>
                          {item.type}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#333', fontSize: 13 }}>
                        {item.unit}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#333', fontSize: 13 }}>
                        -
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
            )}
          </div>
        </div>
        
        {/* Right Panel - Detail */}
        {selectedItemId && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ItemDetail itemId={selectedItemId} onClose={() => setSearchParams({})} />
          </div>
        )}
      </div>

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
