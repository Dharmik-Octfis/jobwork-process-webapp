import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Search, Edit } from 'lucide-react';
import { itemsApi } from './items.api.ts';

export function ItemsList() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['items', orgId],
    queryFn: () => itemsApi.getItems(orgId!),
  });

  const filteredItems = items.filter(
    (item) =>
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.sku.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', padding: '24px', boxSizing: 'border-box', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111827', margin: '0 0 4px 0', letterSpacing: '-0.02em' }}>Items</h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 15 }}>Manage your inventory, products, and services.</p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={() => navigate(`/organizations/${orgId}/items/new`)}
            style={{
              background: '#2563eb',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              transition: 'background 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = '#1d4ed8')}
            onMouseOut={(e) => (e.currentTarget.style.background = '#2563eb')}
          >
            <Plus size={18} />
            New Item
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <Search size={18} color="#9ca3af" style={{ position: 'absolute', left: 14, top: 12 }} />
          <input
            type="text"
            placeholder="Search by name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '11px 14px 11px 42px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 14,
              boxSizing: 'border-box',
              outline: 'none',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#2563eb')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#d1d5db')}
          />
        </div>
      </div>

      {/* Table Content */}
      <div style={{ flex: 1, background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' }}>
        {isLoading ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#6b7280', fontSize: 15 }}>Loading items...</div>
        ) : filteredItems.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#6b7280', fontSize: 15 }}>
            No items found. {search && 'Try a different search term.'}
          </div>
        ) : (
          <div style={{ width: '100%', overflowX: 'auto' }}>
            {/* Table Header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '3fr 2fr 1.5fr 1fr 1fr 80px',
                padding: '16px 20px',
                background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                fontWeight: 600,
                color: '#475569',
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              <div>Name</div>
              <div>SKU</div>
              <div>Type</div>
              <div>Unit</div>
              <div>Stock</div>
              <div style={{ textAlign: 'center' }}>Actions</div>
            </div>

            {/* Table Body */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {filteredItems.map((item, index) => (
                <div
                  key={item.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '3fr 2fr 1.5fr 1fr 1fr 80px',
                    padding: '16px 20px',
                    borderBottom: index === filteredItems.length - 1 ? 'none' : '1px solid #f1f5f9',
                    alignItems: 'center',
                    fontSize: 14,
                    color: '#1f2937',
                    background: 'white',
                    transition: 'background 0.15s',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseOut={(e) => (e.currentTarget.style.background = 'white')}
                >
                  <div 
                    style={{ fontWeight: 500, color: '#0f172a', cursor: 'pointer', display: 'flex', alignItems: 'center' }} 
                    onClick={() => navigate(`/organizations/${orgId}/items/${item.id}/edit`)}
                  >
                    {item.name}
                  </div>
                  <div style={{ color: '#64748b' }}>{item.sku}</div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
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
                  </div>
                  <div style={{ color: '#64748b' }}>{item.unit}</div>
                  <div style={{ color: '#64748b' }}>-</div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                    <button
                      onClick={() => navigate(`/organizations/${orgId}/items/${item.id}/edit`)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#94a3b8', borderRadius: 6, transition: 'all 0.2s' }}
                      onMouseOver={(e) => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#334155'; }}
                      onMouseOut={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94a3b8'; }}
                    >
                      <Edit size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
