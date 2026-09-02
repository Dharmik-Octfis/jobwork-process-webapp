import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemsApi } from './items.api';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { X, Edit, ChevronDown, Building2, HelpCircle } from 'lucide-react';
import { useState, useRef, useEffect, Fragment, useMemo } from 'react';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ItemLocations } from './components/ItemLocations';
import { ItemBatchDetails } from './components/ItemBatchDetails';
import { useTrackingLabel } from '../../hooks/useTrackingLabel';
import { ItemActivityHistory } from './ItemActivityHistory';
import { ItemImageGallery } from './components/ItemImageGallery';
import { CompositeItemsList } from '../inventory/composite-items/CompositeItemsList';
import { ItemTransactions } from './components/ItemTransactions';

interface ItemDetailProps {
  itemId: string;
  onClose: () => void;
}

export function ItemDetail({ itemId, onClose }: ItemDetailProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
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

  const isInventoryTracked = item?.trackInventory !== false;

  const { singular } = useTrackingLabel();
  const batchTabName = `${singular} Details`;

  const isBatchTracked = useMemo(() => {
    if (!item || !isInventoryTracked) return false;
    const tracking = String(item.inventoryTracking ?? item.inventoryTracking ?? '').toLowerCase();
    return tracking === 'batch';
  }, [item, isInventoryTracked]);

  const showComponentsTab = item?.itemStructure === 'composite';

  const effectiveActiveTab =
    (activeTab === 'Locations' && !isInventoryTracked) ||
    (activeTab === batchTabName && !isBatchTracked) ||
    (activeTab === 'Components' && !showComponentsTab)
      ? 'Overview'
      : activeTab;

  const { data: activities = [], isLoading: isLoadingActivities } = useQuery({
    queryKey: ['itemActivities', orgId, itemId],
    queryFn: () => itemsApi.fetchItemActivities(orgId!, itemId),
    enabled: Boolean(orgId && itemId) && effectiveActiveTab === 'History',
  });

  const { data: openingStockRows = [] } = useQuery({
    queryKey: ['itemOpeningStock', orgId, itemId],
    queryFn: () => itemsApi.getOpeningStock(orgId!, itemId),
    enabled: Boolean(orgId && itemId),
  });

  const totalOpeningStock = useMemo(() => {
    if (Array.isArray(openingStockRows) && openingStockRows.length > 0) {
      return openingStockRows.reduce((acc, row) => {
        const batchTotal = Array.isArray(row.batches)
          ? row.batches.reduce((bAcc, b) => bAcc + (Number(b.quantityIn) || 0), 0)
          : 0;
        const stockOnHand =
          Number(row.stockOnHand ?? row.openingStock ?? batchTotal) || batchTotal || 0;
        return acc + stockOnHand;
      }, 0);
    }
    return Number(item?.openingStock ?? 0);
  }, [openingStockRows, item]);

  const deleteMutation = useMutation({
    mutationFn: () => itemsApi.deleteItem(orgId!, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
      onClose();
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (newIsActive: boolean) =>
      itemsApi.updateItem({ orgId: orgId!, id: itemId, data: { isActive: newIsActive } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item', orgId, itemId] });
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
      setIsMoreOpen(false);
    },
  });

  const handleClone = () => {
    setIsMoreOpen(false);
    if (!item) return;

    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...restToClone } = item;
    const itemToClone = {
      ...restToClone,
      sku: '',
      name: `Copy of ${item.name}`,
    };

    navigate(`/organizations/${orgId}/items/new`, { state: { itemToClone , returnUrl: location.pathname + location.search } });
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
              background: item.isActive !== false ? '#3b82f6' : '#94a3b8',
              color: 'white',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 500,
            }}
          >
            {item.isActive !== false ? 'Active' : 'Inactive'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {item.itemStructure === 'composite' && (
            <button
              onClick={() =>
                navigate(`/organizations/${orgId}/inventory/assembly/new?itemId=${item.id}`)
              }
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
              Create Assembly
            </button>
          )}
          <button
            onClick={() => {
              if (item.itemStructure === 'composite') {
                navigate(`/organizations/${orgId}/composite-items/${itemId}/edit`, { state: { returnUrl: location.pathname + location.search } });
              } else {
                navigate(`/organizations/${orgId}/items/${itemId}/edit`, { state: { returnUrl: location.pathname + location.search } });
              }
            }}
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
                  Clone
                </div>
                <div
                  onClick={() =>
                    toggleActiveMutation.mutate(item.isActive === false ? true : false)
                  }
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#1e293b',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  Mark as {item.isActive !== false ? 'Inactive' : 'Active'}
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
                  Delete
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid #eef0f3',
          padding: '0 24px',
          gap: '16px',
        }}
      >
        {[
          'Overview',
          ...(isInventoryTracked ? ['Locations'] : []),
          ...(isBatchTracked ? [batchTabName] : []),
          'Transactions',
          'Related Lists',
          'History',
          ...(showComponentsTab ? ['Components'] : []),
        ].map((tab, idx) => (
          <Fragment key={tab}>
            {idx > 0 && <div style={{ height: '16px', width: '1px', background: '#cbd5e1' }} />}
            <div
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 0',
                fontSize: '13px',
                fontWeight: effectiveActiveTab === tab ? 500 : 400,
                color: effectiveActiveTab === tab ? '#0062ff' : '#64748b',
                borderBottom:
                  effectiveActiveTab === tab ? '2px solid #0062ff' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              {tab}
            </div>
          </Fragment>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
        {effectiveActiveTab === 'History' ? (
          <div style={{ margin: '-24px' }}>
            <ItemActivityHistory activities={activities} isLoading={isLoadingActivities} />
          </div>
        ) : effectiveActiveTab === 'Components' && item.itemStructure === 'composite' ? (
          <div style={{ margin: '-24px' }}>
            <CompositeItemsList itemId={itemId} />
          </div>
        ) : effectiveActiveTab === 'Overview' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '400px 380px',
              gap: '32px',
              justifyContent: 'start',
            }}
          >
            {/* Primary Info (Left) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
              <div>
                <div
                  style={{
                    fontSize: '15px',
                    fontWeight: 500,
                    color: '#1e293b',
                    marginBottom: '16px',
                  }}
                >
                  Primary Details
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Item Name</div>
                    <div style={{ fontSize: '12px', color: '#0062ff', fontWeight: 500 }}>
                      {item.name}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>SKU</div>
                    <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>
                      {item.sku}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Unit</div>
                    <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>
                      {item.unit}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Category</div>
                    <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>
                      {item.category || '-'}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Type</div>
                    <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>
                      {item.itemType}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Item Type</div>
                    <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>
                      {item.itemStructure}
                    </div>
                  </div>

                  {item.hsnCode && (
                    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>HSN Code</div>
                      <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>
                        {item.hsnCode}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {item.isPurchaseInfo && (
                <div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 500,
                      color: '#1e293b',
                      marginBottom: '16px',
                    }}
                  >
                    Purchase Information
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>Cost Price</div>
                      <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>
                        ₹{item.costPrice ? Number(item.costPrice).toFixed(2) : '0.00'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {item.isSalesInfo && (
                <div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 500,
                      color: '#1e293b',
                      marginBottom: '16px',
                    }}
                  >
                    Sales Information
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr' }}>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>Selling Price</div>
                      <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 500 }}>
                        ₹{item.sellingPrice ? Number(item.sellingPrice).toFixed(2) : '0.00'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Images & Stock */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
              {/* Image Gallery & Upload */}
              <ItemImageGallery orgId={orgId!} itemId={itemId} item={item} />

              {/* Opening Stock & Inventory Detailed Summary Card */}
              <div
                style={{
                  background: '#f8fafc',
                  padding: '20px 24px',
                  borderRadius: '8px',
                  border: '1px solid #f1f5f9',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                }}
              >
                {/* Opening Stock Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Building2 size={16} color="#0062ff" />
                  <span style={{ fontSize: '14px', color: '#0062ff', fontWeight: 500 }}>
                    Opening Stock
                  </span>
                  <span
                    title="Total opening stock"
                    style={{ display: 'inline-flex', alignItems: 'center' }}
                  >
                    <HelpCircle size={14} color="#64748b" style={{ cursor: 'pointer' }} />
                  </span>
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#0f172a',
                      marginLeft: '2px',
                    }}
                  >
                    : {totalOpeningStock.toFixed(2)}
                  </span>
                </div>

                {/* Accounting Stock Section */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginBottom: '12px',
                    }}
                  >
                    <h3
                      style={{
                        fontSize: '15px',
                        fontWeight: 600,
                        color: '#0f172a',
                        margin: 0,
                      }}
                    >
                      Accounting Stock
                    </h3>
                    <span
                      title="Accounting stock summary"
                      style={{ display: 'inline-flex', alignItems: 'center' }}
                    >
                      <HelpCircle size={14} color="#64748b" style={{ cursor: 'pointer' }} />
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '140px 12px 1fr',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '13px',
                          color: '#475569',
                          borderBottom: '1px dotted #94a3b8',
                          width: 'fit-content',
                          paddingBottom: '1px',
                        }}
                      >
                        Stock on Hand
                      </span>
                      <span style={{ fontSize: '13px', color: '#475569' }}>:</span>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#0062ff' }}>
                        {totalOpeningStock.toFixed(2)}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '140px 12px 1fr',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '13px',
                          color: '#475569',
                          borderBottom: '1px dotted #94a3b8',
                          width: 'fit-content',
                          paddingBottom: '1px',
                        }}
                      >
                        Committed Stock
                      </span>
                      <span style={{ fontSize: '13px', color: '#475569' }}>:</span>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: '#0f172a' }}>
                        0.00
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '140px 12px 1fr',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '13px',
                          color: '#475569',
                          borderBottom: '1px dotted #94a3b8',
                          width: 'fit-content',
                          paddingBottom: '1px',
                        }}
                      >
                        Available for Sale
                      </span>
                      <span style={{ fontSize: '13px', color: '#475569' }}>:</span>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: '#0f172a' }}>
                        {totalOpeningStock.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Physical Stock Section */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginBottom: '12px',
                    }}
                  >
                    <h3
                      style={{
                        fontSize: '15px',
                        fontWeight: 600,
                        color: '#0f172a',
                        margin: 0,
                      }}
                    >
                      Physical Stock
                    </h3>
                    <span
                      title="Physical stock summary"
                      style={{ display: 'inline-flex', alignItems: 'center' }}
                    >
                      <HelpCircle size={14} color="#64748b" style={{ cursor: 'pointer' }} />
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '140px 12px 1fr',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '13px',
                          color: '#475569',
                          borderBottom: '1px dotted #94a3b8',
                          width: 'fit-content',
                          paddingBottom: '1px',
                        }}
                      >
                        Stock on Hand
                      </span>
                      <span style={{ fontSize: '13px', color: '#475569' }}>:</span>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: '#0f172a' }}>
                        {totalOpeningStock.toFixed(2)}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '140px 12px 1fr',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '13px',
                          color: '#475569',
                          borderBottom: '1px dotted #94a3b8',
                          width: 'fit-content',
                          paddingBottom: '1px',
                        }}
                      >
                        Committed Stock
                      </span>
                      <span style={{ fontSize: '13px', color: '#475569' }}>:</span>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: '#0f172a' }}>
                        0.00
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '140px 12px 1fr',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '13px',
                          color: '#475569',
                          borderBottom: '1px dotted #94a3b8',
                          width: 'fit-content',
                          paddingBottom: '1px',
                        }}
                      >
                        Available for Sale
                      </span>
                      <span style={{ fontSize: '13px', color: '#475569' }}>:</span>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: '#0f172a' }}>
                        {totalOpeningStock.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Opening Stock (4-box summary) - PLACED LAST */}
              {isInventoryTracked && (
                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '16px',
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#0062ff"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"></path>
                      <path d="M6 18h12"></path>
                      <path d="M6 14h12"></path>
                      <rect width="12" height="12" x="6" y="10"></rect>
                    </svg>
                    <h3 style={{ fontSize: '13px', fontWeight: 500, color: '#0062ff', margin: 0 }}>
                      Opening Stock Summary
                    </h3>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div
                      style={{
                        background: '#fff',
                        padding: '12px',
                        borderRadius: '6px',
                        border: '1px solid #eef0f3',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                        <span style={{ fontSize: '20px', fontWeight: 400, color: '#000' }}>
                          {totalOpeningStock.toFixed(2)}
                        </span>
                        <span style={{ fontSize: '10px', color: '#64748b' }}>
                          {item.unit || 'Qty'}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#1e293b' }}>Opening Stock</div>
                    </div>

                    <div
                      style={{
                        background: '#fff',
                        padding: '12px',
                        borderRadius: '6px',
                        border: '1px solid #eef0f3',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                        <span style={{ fontSize: '20px', fontWeight: 400, color: '#000' }}>0</span>
                        <span style={{ fontSize: '10px', color: '#64748b' }}>Qty</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#1e293b' }}>Stock In</div>
                    </div>

                    <div
                      style={{
                        background: '#fff',
                        padding: '12px',
                        borderRadius: '6px',
                        border: '1px solid #eef0f3',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                        <span style={{ fontSize: '20px', fontWeight: 400, color: '#000' }}>0</span>
                        <span style={{ fontSize: '10px', color: '#64748b' }}>Qty</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#1e293b' }}>Stock Out</div>
                    </div>

                    <div
                      style={{
                        background: '#fff',
                        padding: '12px',
                        borderRadius: '6px',
                        border: '1px solid #eef0f3',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                        <span style={{ fontSize: '20px', fontWeight: 400, color: '#000' }}>
                          {totalOpeningStock.toFixed(2)}
                        </span>
                        <span style={{ fontSize: '10px', color: '#64748b' }}>
                          {item.unit || 'Qty'}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#1e293b' }}>Stock on Hand</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : effectiveActiveTab === 'Locations' ? (
          <div style={{ margin: '0 -24px' }}>
            <ItemLocations orgId={orgId!} itemId={itemId} isBatchTracked={isBatchTracked} />
          </div>
        ) : effectiveActiveTab === batchTabName ? (
          <div style={{ margin: '0 -24px' }}>
            <ItemBatchDetails
              orgId={orgId!}
              itemId={itemId}
              itemName={item.name}
              inventoryTracking={item.inventoryTracking || item.inventoryTracking}
            />
          </div>
        ) : effectiveActiveTab === 'Transactions' ? (
          <div style={{ margin: '-24px', height: 'calc(100% + 48px)' }}>
            <ItemTransactions orgId={orgId!} itemId={itemId} />
          </div>
        ) : (
          <div
            style={{
              color: '#64748b',
              display: 'flex',
              justifyContent: 'center',
              marginTop: '40px',
            }}
          >
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
