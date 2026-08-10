import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { compositeItemsApi } from './compositeItems.api';
import { ItemComboBox } from '../../../components/ui/ItemComboBox';
import type { Item } from '../../items/items.schemas';
import type { CompositeComponent } from './compositeItems.api';

interface CompositeItemsListProps {
  itemId: string;
}

export function CompositeItemsList({ itemId }: CompositeItemsListProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Form state
  const [componentItem, setComponentItem] = useState<Item | null>(null);
  const [qtyPerUnit, setQtyPerUnit] = useState<string>('');

  const { data: components = [], isLoading } = useQuery({
    queryKey: ['compositeComponents', orgId, itemId],
    queryFn: () => compositeItemsApi.getComponents(orgId!, itemId),
    enabled: Boolean(orgId && itemId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      compositeItemsApi.createComponent(orgId!, itemId, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        component_item_id: componentItem!.id,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        qty_per_unit: Number(qtyPerUnit),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compositeComponents', orgId, itemId] });
      setIsAdding(false);
      resetForm();
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { message?: string } } };
      alert(err.response?.data?.message || 'Failed to add component');
    }
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      compositeItemsApi.updateComponent(orgId!, itemId, editingId!, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        component_item_id: componentItem!.id,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        qty_per_unit: Number(qtyPerUnit),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compositeComponents', orgId, itemId] });
      setEditingId(null);
      resetForm();
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { message?: string } } };
      alert(err.response?.data?.message || 'Failed to update component');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => compositeItemsApi.deleteComponent(orgId!, itemId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compositeComponents', orgId, itemId] });
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { message?: string } } };
      alert(err.response?.data?.message || 'Failed to delete component');
    }
  });

  const resetForm = () => {
    setComponentItem(null);
    setQtyPerUnit('');
  };

  const handleEdit = (comp: CompositeComponent) => {
    setEditingId(comp.id);
    setIsAdding(false);
    // eslint-disable-next-line @typescript-eslint/naming-convention
    setComponentItem({ id: comp.component_item_id, name: comp.component?.name || '' } as unknown as Item);
    // eslint-disable-next-line @typescript-eslint/naming-convention
    setQtyPerUnit(comp.qty_per_unit.toString());
  };

  const handleSave = () => {
    if (!componentItem || !qtyPerUnit || Number(qtyPerUnit) <= 0) {
      alert('Please select an item and enter a valid quantity.');
      return;
    }
    if (editingId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  if (isLoading) return <div style={{ padding: '24px' }}>Loading recipe...</div>;

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 500, margin: 0, color: '#1e293b' }}>Bill of Materials (Recipe)</h3>
        {!isAdding && !editingId && (
          <button
            onClick={() => { setIsAdding(true); resetForm(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '6px 12px', background: '#0062ff', color: 'white',
              border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer'
            }}
          >
            <Plus size={14} /> Add Component
          </button>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #eef0f3' }}>
        <thead style={{ background: '#f8fafc' }}>
          <tr>
            <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', color: '#64748b', fontWeight: 500, borderBottom: '1px solid #eef0f3' }}>Component Item</th>
            <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', color: '#64748b', fontWeight: 500, borderBottom: '1px solid #eef0f3', width: '150px' }}>Quantity</th>
            <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', color: '#64748b', fontWeight: 500, borderBottom: '1px solid #eef0f3', width: '120px' }}>Unit</th>
            <th style={{ padding: '12px', textAlign: 'right', fontSize: '12px', color: '#64748b', fontWeight: 500, borderBottom: '1px solid #eef0f3', width: '100px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {components.map((comp) => {
            const isEditing = editingId === comp.id;
            return (
              <tr key={comp.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                <td style={{ padding: '12px', fontSize: '13px', color: '#1e293b' }}>
                  {isEditing ? (
                    <ItemComboBox
                      orgId={orgId!}
                      value={componentItem?.id}
                      initialItem={componentItem}
                      excludeItemId={itemId}
                      onChange={(item) => setComponentItem(item)}
                      placeholder="Select Component..."
                    />
                  ) : (
                    <div>
                      <div style={{ fontWeight: 500 }}>{comp.component?.name}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{comp.component?.sku}</div>
                    </div>
                  )}
                </td>
                <td style={{ padding: '12px', fontSize: '13px', color: '#1e293b' }}>
                  {isEditing ? (
                    <input
                      type="number"
                      value={qtyPerUnit}
                      onChange={(e) => setQtyPerUnit(e.target.value)}
                      placeholder="Qty"
                      style={{ width: '100%', padding: '6px', border: '1px solid #d1d5db', borderRadius: '4px' }}
                    />
                  ) : (
                    comp.qty_per_unit
                  )}
                </td>
                <td style={{ padding: '12px', fontSize: '13px', color: '#64748b' }}>
                  {comp.component?.unit || '-'}
                </td>
                <td style={{ padding: '12px', textAlign: 'right' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button onClick={handleSave} style={{ padding: '4px 8px', background: '#0062ff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>Save</button>
                      <button onClick={() => setEditingId(null)} style={{ padding: '4px 8px', background: 'transparent', color: '#64748b', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                      <button onClick={() => handleEdit(comp)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }} title="Edit"><Edit2 size={14} /></button>
                      <button onClick={() => { if(confirm('Are you sure you want to delete this component?')) deleteMutation.mutate(comp.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }} title="Delete"><Trash2 size={14} /></button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}

          {isAdding && (
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #eef0f3' }}>
              <td style={{ padding: '12px' }}>
                <ItemComboBox
                  orgId={orgId!}
                  value={componentItem?.id}
                  initialItem={componentItem}
                  excludeItemId={itemId}
                  onChange={(item) => setComponentItem(item)}
                  placeholder="Select Component..."
                />
              </td>
              <td style={{ padding: '12px' }}>
                <input
                  type="number"
                  value={qtyPerUnit}
                  onChange={(e) => setQtyPerUnit(e.target.value)}
                  placeholder="Qty"
                  style={{ width: '100%', padding: '6px', border: '1px solid #d1d5db', borderRadius: '4px' }}
                />
              </td>
              <td style={{ padding: '12px', fontSize: '12px', color: '#64748b' }}>
                {componentItem?.unit || '-'}
              </td>
              <td style={{ padding: '12px', textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button onClick={handleSave} style={{ padding: '4px 8px', background: '#0062ff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>Save</button>
                  <button onClick={() => setIsAdding(false)} style={{ padding: '4px 8px', background: 'transparent', color: '#64748b', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>Cancel</button>
                </div>
              </td>
            </tr>
          )}

          {components.length === 0 && !isAdding && (
            <tr>
              <td colSpan={4} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                No components added yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
