import { useQuery } from '@tanstack/react-query';
import { compositeItemsApi } from './compositeItems.api';
import { ImageIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

interface AssociatedItemsViewProps {
  orgId: string;
  itemId: string;
}

export function AssociatedItemsView({ orgId, itemId }: AssociatedItemsViewProps) {
  const { data: components = [], isLoading } = useQuery({
    queryKey: ['compositeComponents', orgId, itemId],
    queryFn: () => compositeItemsApi.getComponents(orgId, itemId),
    enabled: Boolean(orgId && itemId),
  });

  if (isLoading || components.length === 0) {
    return null;
  }

  return (
    <div style={{ marginTop: '24px' }}>
      <div
        style={{
          fontSize: '16px',
          fontWeight: 500,
          color: 'var(--color-text)',
          marginBottom: '16px',
        }}
      >
        Associated Items
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: '1px solid #eef0f3', borderBottom: '1px solid #eef0f3' }}>
        <thead style={{ background: '#f8fafc' }}>
          <tr>
            <th style={{ padding: '12px 0', textAlign: 'left', fontSize: '12px', color: '#64748b', fontWeight: 500, borderBottom: '1px solid #eef0f3' }}>
              ITEM DETAILS
            </th>
            <th style={{ padding: '12px 0', textAlign: 'right', fontSize: '12px', color: '#64748b', fontWeight: 500, borderBottom: '1px solid #eef0f3', width: '100px' }}>
              QUANTITY
            </th>
          </tr>
        </thead>
        <tbody>
          {components.map((comp) => (
            <tr key={comp.id} style={{ borderBottom: '1px solid #eef0f3' }}>
              <td style={{ padding: '16px 0', display: 'flex', gap: '16px' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '4px',
                    background: '#f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    overflow: 'hidden'
                  }}
                >
                  {comp.component?.images?.[0] ? (
                    <img 
                      src={comp.component.images[0].url} 
                      alt={comp.component.name} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    />
                  ) : (
                    <ImageIcon size={20} color="#cbd5e1" />
                  )}
                </div>
                <div>
                  <div style={{ marginBottom: comp.component?.sku ? 0 : '8px' }}>
                    <Link 
                      to={`/organizations/${orgId}/items?id=${comp.componentItemId}`}
                      target="_blank"
                      style={{ fontSize: '13px', color: '#0062ff', fontWeight: 500, textDecoration: 'none' }}
                    >
                      {comp.component?.name}
                    </Link>
                  </div>
                  {comp.component?.sku && (
                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>
                      [{comp.component.sku}]
                    </div>
                  )}
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    Accounting Stock: {comp.component?.stockOnHand?.toFixed(2) ?? '0.00'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    Physical Stock: {comp.component?.stockOnHand?.toFixed(2) ?? '0.00'}
                  </div>
                </div>
              </td>
              <td style={{ padding: '16px 0', textAlign: 'right', fontSize: '13px', color: '#1e293b', verticalAlign: 'top' }}>
                {comp.qtyPerUnit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
