import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemsApi } from './items.api';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Pencil,
  ChevronDown,
  Package,
  DollarSign,
  TrendingUp,
  Layers,
  Archive,
  Copy,
  Trash2,
  Tag,
  Warehouse,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ItemLocations } from './components/ItemLocations';
import { ItemBatchDetails } from './components/ItemBatchDetails';
import { useTrackingLabel } from '../../hooks/useTrackingLabel';
import { ItemActivityHistory } from './ItemActivityHistory';
import { ItemImageGallery } from './components/ItemImageGallery';
import { CompositeItemsList } from '../inventory/composite-items/CompositeItemsList';
import { ItemTransactions } from './components/ItemTransactions';
import {
  fetchLocations,
  isOwnLocation,
  type Location,
} from '../configuration/locations/locations.api';
import { availableOf, declaredOpeningOf, stockOnHandOf } from './stockFigures';

interface ItemDetailProps {
  itemId?: string;
  onClose?: () => void;
}

export function ItemDetail({ itemId: propItemId, onClose: propOnClose }: ItemDetailProps = {}) {
  const { orgId, id: routeItemId } = useParams<{ orgId: string; id?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const itemId = propItemId || routeItemId!;
  const onClose = propOnClose || (() => navigate(`/organizations/${orgId}/items`));

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
    const tracking = String(item.inventoryTracking ?? '').toLowerCase();
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

  const { data: allLocations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: !!orgId,
  });

  const ownLocationIds = useMemo(() => {
    return new Set(allLocations.filter(isOwnLocation).map((l: Location) => l.id));
  }, [allLocations]);

  const { totalOpeningStock, totalStockOnHand } = useMemo(() => {
    if (Array.isArray(openingStockRows) && openingStockRows.length > 0) {
      return {
        totalOpeningStock: openingStockRows.reduce((acc, row) => acc + declaredOpeningOf(row), 0),
        totalStockOnHand: openingStockRows.reduce((acc, row) => acc + stockOnHandOf(row), 0),
      };
    }
    const declared = Number(item?.openingStock ?? 0);
    return { totalOpeningStock: declared, totalStockOnHand: declared };
  }, [openingStockRows, item]);

  const ownPremisesStock = useMemo(() => {
    if (Array.isArray(openingStockRows) && openingStockRows.length > 0) {
      let onHand = 0;
      let committed = 0;
      let available = 0;

      for (const row of openingStockRows) {
        if (!ownLocationIds.has(row.locationId)) continue;
        const rowOnHand = stockOnHandOf(row);
        const rowCommitted = Number(row.committedStock ?? 0) || 0;
        const rowAvailable = availableOf(row);

        onHand += rowOnHand;
        committed += rowCommitted;
        available += rowAvailable;
      }
      return { onHand, committed, available };
    }
    const defaultStock = Number(item?.openingStock ?? 0);
    return { onHand: defaultStock, committed: 0, available: defaultStock };
  }, [openingStockRows, item, ownLocationIds]);

  const outsidePremisesStock = useMemo(() => {
    return Math.max(0, totalStockOnHand - ownPremisesStock.onHand);
  }, [totalStockOnHand, ownPremisesStock.onHand]);

  // Margin Calculation
  const cost = Number(item?.costPrice ?? 0);
  const price = Number(item?.sellingPrice ?? 0);
  const marginPercentage = useMemo(() => {
    if (price > 0 && cost >= 0) {
      return (((price - cost) / price) * 100).toFixed(1);
    }
    return null;
  }, [cost, price]);

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
      queryClient.invalidateQueries({ queryKey: ['compositeItems', orgId] });
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

    navigate(`/organizations/${orgId}/items/new`, {
      state: { itemToClone, returnUrl: location.pathname + location.search },
    });
  };

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          color: '#64748b',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            border: '3px solid #e2e8f0',
            borderTopColor: '#0284c7',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 500 }}>Loading item overview...</span>
      </div>
    );
  }

  if (!item) {
    return (
      <div
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          maxWidth: 480,
          margin: '40px auto',
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.05)',
        }}
      >
        <AlertCircle size={40} color="#94a3b8" style={{ margin: '0 auto 16px' }} />
        <h3 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
          Item not found
        </h3>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
          This item may have been moved or removed.
        </p>
        <button
          onClick={onClose}
          style={{
            padding: '8px 18px',
            background: '#0284c7',
            color: '#fff',
            borderRadius: 6,
            border: 'none',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Back to Items
        </button>
      </div>
    );
  }

  const isGoods = item.itemType === 'goods';
  const isActive = item.isActive !== false;
  const inStock = totalStockOnHand > 0;

  return (
    <div
      style={{
        minHeight: '100%',
        flexShrink: 0,
        background: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 1. Header Navigation Bar */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #eef2f6',
          padding: '12px 20px',
          position: 'sticky',
          top: 0,
          zIndex: 30,
        }}
      >
        <div
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          {/* Left: Back & Title info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={onClose}
              title="Back to items list"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 34,
                height: 34,
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                background: '#fff',
                cursor: 'pointer',
                color: '#475569',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f1f5f9';
                e.currentTarget.style.color = '#0284c7';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#fff';
                e.currentTarget.style.color = '#475569';
              }}
            >
              <ArrowLeft size={16} />
            </button>

            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  color: '#64748b',
                  marginBottom: 3,
                }}
              >
                <Link
                  to={`/organizations/${orgId}/items`}
                  style={{ color: '#64748b', textDecoration: 'none' }}
                >
                  Items
                </Link>
                <span>/</span>
                <span style={{ color: '#0f172a', fontWeight: 500 }}>{item.name}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
                  {item.name}
                </h1>

                {/* SKU Badge */}
                {item.sku && (
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#475569',
                      background: '#f1f5f9',
                      padding: '2px 8px',
                      borderRadius: 4,
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    SKU: {item.sku}
                  </span>
                )}

                {/* Goods/Service badge */}
                <span
                  style={{
                    padding: '2px 8px',
                    background: isGoods ? '#f0f9ff' : '#ecfdf5',
                    color: isGoods ? '#0369a1' : '#047857',
                    border: `1px solid ${isGoods ? '#bae6fd' : '#a7f3d0'}`,
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'capitalize',
                  }}
                >
                  {item.itemType}
                </span>

                {/* Active Status with pulsating dot */}
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '2px 8px',
                    background: isActive ? '#ecfdf5' : '#f1f5f9',
                    color: isActive ? '#15803d' : '#64748b',
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: isActive ? '#22c55e' : '#94a3b8',
                    }}
                  />
                  {isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Edit Button */}
            <button
              onClick={() => {
                if (item.itemStructure === 'composite') {
                  navigate(`/organizations/${orgId}/composite-items/${itemId}/edit`, {
                    state: { returnUrl: location.pathname },
                  });
                } else {
                  navigate(`/organizations/${orgId}/items/${itemId}/edit`, {
                    state: { returnUrl: location.pathname },
                  });
                }
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                background: '#0284c7',
                color: '#fff',
                borderRadius: 6,
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0369a1')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#0284c7')}
            >
              <Pencil size={14} /> Edit Item
            </button>

            {/* Adjust Opening Stock button */}
            {isInventoryTracked && (
              <button
                onClick={() => navigate(`/organizations/${orgId}/items/${itemId}/opening-stock`)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  background: '#fff',
                  color: '#0f172a',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f8fafc';
                  e.currentTarget.style.borderColor = '#94a3b8';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#fff';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                }}
              >
                <Warehouse size={15} color="#0284c7" /> Adjust Stock
              </button>
            )}

            {/* More Menu */}
            <div style={{ position: 'relative' }} ref={moreMenuRef}>
              <button
                type="button"
                onClick={() => setIsMoreOpen((o) => !o)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '8px 12px',
                  background: '#fff',
                  color: '#475569',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                More <ChevronDown size={14} />
              </button>

              {isMoreOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 6,
                    background: '#fff',
                    borderRadius: 8,
                    boxShadow:
                      '0 10px 25px -5px rgba(0,0,0,0.12), 0 8px 10px -6px rgba(0,0,0,0.08)',
                    border: '1px solid #e2e8f0',
                    minWidth: 180,
                    zIndex: 40,
                    padding: '4px',
                  }}
                >
                  <div
                    onClick={handleClone}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      fontSize: 13,
                      color: '#1e293b',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <Copy size={14} color="#64748b" /> Clone Item
                  </div>

                  <div
                    onClick={() => toggleActiveMutation.mutate(!isActive)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      fontSize: 13,
                      color: '#1e293b',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <Archive size={14} color="#64748b" /> Mark as {isActive ? 'Inactive' : 'Active'}
                  </div>

                  <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />

                  <div
                    onClick={() => {
                      setIsMoreOpen(false);
                      setShowDeleteConfirm(true);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      fontSize: 13,
                      color: '#ef4444',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fef2f2')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <Trash2 size={14} color="#ef4444" /> Delete Item
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Container */}
      <div style={{ width: '100%', padding: '20px 20px' }}>
        {/* 2. Executive KPI Metrics Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          {/* Card 1: Stock on Hand */}
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '18px 22px',
              border: '1px solid #f1f5f9',
              boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Stock On Hand
              </span>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: '#f0f9ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Package size={17} color="#0284c7" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 700, color: '#0f172a' }}>
                {totalStockOnHand.toFixed(2)}
              </span>
              <span style={{ fontSize: 13, color: '#64748b' }}>{item.unit || 'Units'}</span>
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              {inStock ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    color: '#15803d',
                    background: '#f0fdf4',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontWeight: 600,
                  }}
                >
                  <CheckCircle2 size={12} /> Available in Warehouse
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    color: '#b45309',
                    background: '#fef3c7',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontWeight: 600,
                  }}
                >
                  <AlertCircle size={12} /> Low / Out of Stock
                </span>
              )}
            </div>
          </div>

          {/* Card 2: Cost Price */}
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '18px 22px',
              border: '1px solid #f1f5f9',
              boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Purchase Rate (Cost)
              </span>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: '#f8fafc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <DollarSign size={17} color="#475569" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 26, fontWeight: 700, color: '#0f172a' }}>
                ₹{cost > 0 ? Number(cost).toFixed(2) : '0.00'}
              </span>
              <span style={{ fontSize: 12, color: '#64748b' }}>/ {item.unit || 'unit'}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
              Base procurement cost
            </div>
          </div>

          {/* Card 3: Selling Price */}
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '18px 22px',
              border: '1px solid #f1f5f9',
              boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Selling Rate
              </span>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: '#f0fdf4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <TrendingUp size={17} color="#16a34a" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 26, fontWeight: 700, color: '#0f172a' }}>
                ₹{price > 0 ? Number(price).toFixed(2) : '0.00'}
              </span>
              <span style={{ fontSize: 12, color: '#64748b' }}>/ {item.unit || 'unit'}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
              Standard retail / invoice price
            </div>
          </div>

          {/* Card 4: Profit Margin */}
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '18px 22px',
              border: '1px solid #f1f5f9',
              boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Gross Margin
              </span>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: '#f0f9ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Tag size={17} color="#0284c7" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: Number(marginPercentage) >= 0 ? '#15803d' : '#ef4444',
                }}
              >
                {marginPercentage ? `${marginPercentage}%` : 'N/A'}
              </span>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
              {price > cost
                ? `Profit of ₹${(price - cost).toFixed(2)} per unit`
                : 'Margin based on retail & cost'}
            </div>
          </div>
        </div>

        {/* 3. Modern Segmented Navigation Tabs (No underlines) */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginBottom: 20,
            background: '#f1f5f9',
            padding: '3px',
            borderRadius: 8,
            overflowX: 'auto',
            maxWidth: '100%',
          }}
        >
          {[
            'Overview',
            ...(isInventoryTracked ? ['Locations'] : []),
            ...(isBatchTracked ? [batchTabName] : []),
            'Transactions',
            'Images',
            'History',
            ...(showComponentsTab ? ['Components'] : []),
          ].map((tab) => {
            const isTabActive = effectiveActiveTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                style={{
                  background: isTabActive ? '#ffffff' : 'transparent',
                  color: isTabActive ? '#0284c7' : '#475569',
                  fontWeight: isTabActive ? 600 : 500,
                  border: 'none',
                  padding: '7px 16px',
                  borderRadius: 6,
                  fontSize: 13,
                  cursor: 'pointer',
                  boxShadow: isTabActive
                    ? '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)'
                    : 'none',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {/* 4. Tab Body Content */}
        {effectiveActiveTab === 'Overview' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.8fr) minmax(320px, 1fr)',
              gap: 24,
              alignItems: 'start',
            }}
          >
            {/* Left Main Column: Specs & Pricing */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* General Information Card */}
              <div
                style={{
                  background: '#fff',
                  borderRadius: 12,
                  padding: '24px 28px',
                  border: '1px solid #f1f5f9',
                  boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.03)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 20,
                    paddingBottom: 12,
                    borderBottom: '1px solid #f1f5f9',
                  }}
                >
                  <Package size={18} color="#0284c7" />
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                    Item Specifications
                  </h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    { label: 'Item Name', value: item.name },
                    { label: 'SKU Code', value: item.sku || '-' },
                    { label: 'Category', value: item.category || 'Uncategorized' },
                    { label: 'Primary Unit', value: item.unit || '-' },
                    { label: 'HSN / SAC Code', value: item.hsnCode || '-' },
                    { label: 'Item Type', value: item.itemType === 'goods' ? 'Goods' : 'Service' },
                    {
                      label: 'Structure',
                      value: item.itemStructure === 'composite' ? 'Composite Item' : 'Single Item',
                    },
                    {
                      label: 'Inventory Tracking',
                      value: isInventoryTracked
                        ? `Tracked (${item.inventoryTracking || 'Standard'})`
                        : 'Not Tracked',
                    },
                  ].map((row, idx) => (
                    <div
                      key={row.label}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '180px 1fr',
                        padding: '8px 12px',
                        background: idx % 2 === 0 ? '#f8fafc' : 'transparent',
                        borderRadius: 6,
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>
                        {row.label}
                      </span>
                      <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 600 }}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pricing & Commercials Card */}
              <div
                style={{
                  background: '#fff',
                  borderRadius: 12,
                  padding: '24px 28px',
                  border: '1px solid #f1f5f9',
                  boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.03)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 20,
                    paddingBottom: 12,
                    borderBottom: '1px solid #f1f5f9',
                  }}
                >
                  <DollarSign size={18} color="#0284c7" />
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                    Commercial & Valuation Details
                  </h3>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: 20,
                  }}
                >
                  {/* Purchase Side */}
                  <div
                    style={{
                      background: '#f8fafc',
                      borderRadius: 8,
                      padding: '16px 20px',
                      border: '1px solid #eef2f6',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      Purchase / Cost
                    </span>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: '#0f172a',
                        marginTop: 4,
                        marginBottom: 12,
                      }}
                    >
                      ₹{cost.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                      <strong>Description:</strong> {item.purchaseDescription || 'None provided'}
                    </div>
                  </div>

                  {/* Sales Side */}
                  <div
                    style={{
                      background: '#f8fafc',
                      borderRadius: 8,
                      padding: '16px 20px',
                      border: '1px solid #eef2f6',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      Sales / Retail
                    </span>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: '#0f172a',
                        marginTop: 4,
                        marginBottom: 12,
                      }}
                    >
                      ₹{price.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                      <strong>Description:</strong> {item.salesDescription || 'None provided'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Custom Fields (if present) */}
              {item.customFields && Object.keys(item.customFields).length > 0 && (
                <div
                  style={{
                    background: '#fff',
                    borderRadius: 12,
                    padding: '24px 28px',
                    border: '1px solid #f1f5f9',
                    boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.03)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 20,
                      paddingBottom: 12,
                      borderBottom: '1px solid #f1f5f9',
                    }}
                  >
                    <Layers size={18} color="#0284c7" />
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                      Organization Custom Fields
                    </h3>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: 16,
                    }}
                  >
                    {Object.entries(item.customFields).map(([key, val]) => (
                      <div
                        key={key}
                        style={{
                          background: '#f8fafc',
                          padding: '10px 14px',
                          borderRadius: 6,
                          border: '1px solid #f1f5f9',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            color: '#64748b',
                            textTransform: 'capitalize',
                            fontWeight: 500,
                          }}
                        >
                          {key.replace(/([A-Z])/g, ' $1')}
                        </div>
                        <div
                          style={{ fontSize: 13, color: '#0f172a', fontWeight: 600, marginTop: 2 }}
                        >
                          {String(val ?? '-')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Inventory Context & Media */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Inventory & Stock Breakdown */}
              <div
                style={{
                  background: '#fff',
                  borderRadius: 12,
                  padding: '24px 24px',
                  border: '1px solid #f1f5f9',
                  boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.03)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 18,
                    paddingBottom: 12,
                    borderBottom: '1px solid #f1f5f9',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Warehouse size={18} color="#0284c7" />
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#0f172a' }}>
                      Warehouse Stock Breakdown
                    </h3>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#0284c7',
                      background: '#f0f9ff',
                      padding: '2px 8px',
                      borderRadius: 10,
                    }}
                  >
                    Live
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: '#f8fafc',
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ fontSize: 13, color: '#475569' }}>Own Premises Stock</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                      {ownPremisesStock.onHand.toFixed(2)}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: '#f8fafc',
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ fontSize: 13, color: '#475569' }}>Committed Stock</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>
                      {ownPremisesStock.committed.toFixed(2)}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: '#f0fdf4',
                      borderRadius: 8,
                      border: '1px solid #dcfce7',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#166534' }}>
                      Available for Sale
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#15803d' }}>
                      {ownPremisesStock.available.toFixed(2)}
                    </span>
                  </div>

                  {outsidePremisesStock > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: '#f8fafc',
                        borderRadius: 8,
                      }}
                    >
                      <span style={{ fontSize: 13, color: '#475569' }}>
                        Outside / Jobwork Stock
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#0284c7' }}>
                        {outsidePremisesStock.toFixed(2)}
                      </span>
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: '#f8fafc',
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ fontSize: 13, color: '#475569' }}>Initial Opening Stock</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                      {totalOpeningStock.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div style={{ marginTop: 18 }}>
                  <button
                    onClick={() => setActiveTab('Locations')}
                    style={{
                      width: '100%',
                      padding: '9px 14px',
                      background: '#f1f5f9',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#0284c7',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e0f2fe')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                  >
                    View All Warehouse Locations &rarr;
                  </button>
                </div>
              </div>

              {/* Item Media Gallery Card */}
              <ItemImageGallery orgId={orgId!} itemId={itemId} item={item} />
            </div>
          </div>
        )}

        {effectiveActiveTab === 'Locations' && (
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '24px',
              boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.04)',
            }}
          >
            <ItemLocations orgId={orgId!} itemId={itemId} isBatchTracked={isBatchTracked} />
          </div>
        )}

        {effectiveActiveTab === batchTabName && (
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '24px',
              boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.04)',
            }}
          >
            <ItemBatchDetails
              orgId={orgId!}
              itemId={itemId}
              itemName={item.name}
              inventoryTracking={item.inventoryTracking}
            />
          </div>
        )}

        {effectiveActiveTab === 'Transactions' && (
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '24px',
              boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.04)',
            }}
          >
            <ItemTransactions orgId={orgId!} itemId={itemId} />
          </div>
        )}

        {effectiveActiveTab === 'Images' && (
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '24px',
              boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.04)',
            }}
          >
            <ItemImageGallery orgId={orgId!} itemId={itemId} item={item} />
          </div>
        )}

        {effectiveActiveTab === 'History' && (
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '24px',
              boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.04)',
            }}
          >
            <ItemActivityHistory activities={activities} isLoading={isLoadingActivities} />
          </div>
        )}

        {effectiveActiveTab === 'Components' && item.itemStructure === 'composite' && (
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '24px',
              boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.04)',
            }}
          >
            <CompositeItemsList itemId={itemId} />
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

export default ItemDetail;
