import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemsApi } from './items.api';
import { useParams, useNavigate } from 'react-router-dom';
import { X, Edit, ChevronDown, Plus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ItemActivityHistory } from './ItemActivityHistory';
import { ItemImageGallery } from './components/ItemImageGallery';

interface ItemDetailProps {
  itemId: string;
  onClose: () => void;
}

export function ItemDetail({ itemId, onClose }: ItemDetailProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState('Overview');
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { data: item, isLoading } = useQuery({
    queryKey: ['item', orgId, itemId],
    queryFn: () => itemsApi.getItem(orgId!, itemId),
    enabled: Boolean(orgId && itemId),
  });

  const { data: activities = [], isLoading: isLoadingActivities } = useQuery({
    queryKey: ['itemActivities', orgId, itemId],
    queryFn: () => itemsApi.fetchItemActivities(orgId!, itemId),
    enabled: Boolean(orgId && itemId) && activeTab === 'History',
  });

  const deleteMutation = useMutation({
    mutationFn: () => itemsApi.deleteItem(orgId!, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
      onClose();
    },
  });

  const handleClone = () => {
    setIsMoreOpen(false);
    if (!item) return;

    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...restToClone
    } = item;
    const itemToClone = {
      ...restToClone,
      sku: '',
      name: `Copy of ${item.name}`,
    };

    navigate(`/organizations/${orgId}/items/new`, { state: { itemToClone } });
  };

  if (isLoading) {
    return (
      <div style={{ padding: '24px', display: 'flex', justifyContent: 'center', color: '#64748b' }}>
        Loading item details...
      </div>
    );
  }

  if (!item) {
    return (
      <div style={{ padding: '24px', display: 'flex', justifyContent: 'center', color: '#64748b' }}>
        Item not found.
      </div>
    );
  }



  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#fff',
        borderLeft: '1px solid #eef0f3',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid #eef0f3',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1e293b', margin: 0 }}>
            {item.name}
          </h2>
          <span
            style={{
              background: item.type === 'Goods' ? '#e0e7ff' : '#dcfce7',
              color: item.type === 'Goods' ? '#3730a3' : '#166534',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 500,
            }}
          >
            {item.type}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => navigate(`/organizations/${orgId}/items/new`)}
            style={{
              padding: '6px 12px',
              border: 'none',
              background: '#0062ff',
              color: 'white',
              borderRadius: '4px',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 500,
            }}
          >
            <Plus size={14} /> New
          </button>

          <button
            onClick={() => navigate(`/organizations/${orgId}/items/${itemId}/edit`)}
            style={{
              padding: '6px 12px',
              border: '1px solid #d1d5db',
              background: 'white',
              borderRadius: '4px',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Edit size={14} /> Edit
          </button>

          <div style={{ position: 'relative' }} ref={moreMenuRef}>
            <button
              onClick={() => setIsMoreOpen(!isMoreOpen)}
              style={{
                padding: '6px 8px',
                border: '1px solid #d1d5db',
                background: 'white',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ChevronDown size={14} />
            </button>
            {isMoreOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  background: 'white',
                  border: '1px solid #eef0f3',
                  borderRadius: '6px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  zIndex: 10,
                  minWidth: '160px',
                  padding: '4px 0',
                }}
              >
                <div
                  onClick={handleClone}
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#1e293b',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  Clone Item
                </div>
                <div
                  onClick={() => {
                    setIsMoreOpen(false);
                    setShowDeleteConfirm(true);
                  }}
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#dc2626',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fef2f2')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  Delete Item
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            style={{
              padding: '6px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #eef0f3', padding: '0 24px', gap: '24px' }}>
        {['Overview', 'Locations', 'Transactions', 'Related Lists', 'History'].map((tab) => (
          <div
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '12px 0',
              fontSize: '13px',
              fontWeight: activeTab === tab ? 500 : 400,
              color: activeTab === tab ? '#0062ff' : '#64748b',
              borderBottom: activeTab === tab ? '2px solid #0062ff' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            {tab}
          </div>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
        {activeTab === 'History' ? (
          <div style={{ margin: '-24px' }}>
            <ItemActivityHistory activities={activities} isLoading={isLoadingActivities} />
          </div>
        ) : activeTab === 'Overview' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '400px 380px', gap: '32px', justifyContent: 'start' }}>
          {/* Primary Info (Left) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <div>
            <div style={{ fontSize: '15px', fontWeight: 500, color: '#1e293b', marginBottom: '16px' }}>Primary Details</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Item Name</div>
                <div style={{ fontSize: '12px', color: '#0062ff', fontWeight: 500 }}>{item.name}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                <div style={{ fontSize: '12px', color: '#64748b' }}>SKU</div>
                <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>{item.sku}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Unit</div>
                <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>{item.unit}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Category</div>
                <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>{item.category || '-'}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Brand</div>
                <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>{item.brand || '-'}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Manufacturer</div>
                <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>{item.manufacturer || '-'}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Type</div>
                <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>{item.type}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Item Type</div>
                <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>{item.itemType}</div>
              </div>



              {item.hsnCode && (
                <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>HSN Code</div>
                  <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>{item.hsnCode}</div>
                </div>
              )}
            </div>
            </div>

            {item.isPurchaseInfo && (
              <div>
                <div style={{ fontSize: '15px', fontWeight: 500, color: '#1e293b', marginBottom: '16px' }}>Purchase Information</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Cost Price</div>
                    <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>₹{item.costPrice ? Number(item.costPrice).toFixed(2) : '0.00'}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Purchase Account</div>
                    <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>{item.purchaseAccount || '-'}</div>
                  </div>
                </div>
              </div>
            )}

            {item.isSalesInfo && (
              <div>
                <div style={{ fontSize: '15px', fontWeight: 500, color: '#1e293b', marginBottom: '16px' }}>Sales Information</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Selling Price</div>
                    <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>₹{item.sellingPrice ? Number(item.sellingPrice).toFixed(2) : '0.00'}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Sales Account</div>
                    <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>{item.salesAccount || '-'}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Images & Stock */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

            {/* Image Gallery & Upload */}
            <ItemImageGallery orgId={orgId!} itemId={itemId} item={item} />

            {/* Opening Stock */}
            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0062ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                <h3 style={{ fontSize: '13px', fontWeight: 500, color: '#0062ff', margin: 0 }}>Opening Stock</h3>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ background: '#fff', padding: '12px', borderRadius: '6px', border: '1px solid #eef0f3', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                    <span style={{ fontSize: '20px', fontWeight: 400, color: '#000' }}>0</span>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>Qty</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#1e293b' }}>Opening Stock</div>
                </div>

                <div style={{ background: '#fff', padding: '12px', borderRadius: '6px', border: '1px solid #eef0f3', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                    <span style={{ fontSize: '20px', fontWeight: 400, color: '#000' }}>0</span>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>Qty</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#1e293b' }}>Stock In</div>
                </div>

                <div style={{ background: '#fff', padding: '12px', borderRadius: '6px', border: '1px solid #eef0f3', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                    <span style={{ fontSize: '20px', fontWeight: 400, color: '#000' }}>0</span>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>Qty</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#1e293b' }}>Stock Out</div>
                </div>

                <div style={{ background: '#fff', padding: '12px', borderRadius: '6px', border: '1px solid #eef0f3', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                    <span style={{ fontSize: '20px', fontWeight: 400, color: '#000' }}>0</span>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>Qty</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#1e293b' }}>Stock on Hand</div>
                </div>
              </div>
            </div>

          </div>
          </div>
        ) : (
          <div style={{ color: '#64748b', display: 'flex', justifyContent: 'center', marginTop: '40px' }}>
            This section is under development.
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Item"
        message="Are you sure you want to delete this item? This action cannot be undone."
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
