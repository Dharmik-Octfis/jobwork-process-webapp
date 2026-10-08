import { useState, useMemo } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchAvailableBatches } from '../../jobwork/batches/batches.api';
import { useTrackingLabel } from '../../../hooks/useTrackingLabel';

interface SelectBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  itemId: string;
  itemName: string;
  locationId: string;
  onSelect: (batchId: string, supplierBatchRef: string | null) => void;
}

export function SelectBatchModal({
  isOpen,
  onClose,
  orgId,
  itemId,
  itemName,
  locationId,
  onSelect,
}: SelectBatchModalProps) {
  const [search, setSearch] = useState('');
  const trackingLabel = useTrackingLabel();

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['available-batches', orgId, itemId, locationId],
    queryFn: () =>
      fetchAvailableBatches(orgId, {
        itemId,
        locationId,
        ownership: 'own',
        limit: 100,
      }),
    enabled: Boolean(isOpen && orgId && itemId && locationId),
  });

  const filteredBatches = useMemo(() => {
    if (!search) return batches;
    const lower = search.toLowerCase();
    return batches.filter(
      (b) =>
        b.supplierBatchRef?.toLowerCase().includes(lower) ||
        b.manufacturerBatch?.toLowerCase().includes(lower)
    );
  }, [batches, search]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '600px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#0f172a' }}>
              Select {trackingLabel.singular}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#64748b' }}>
              {itemName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              display: 'flex',
              padding: '4px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e2e8f0' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              padding: '8px 12px',
            }}
          >
            <Search size={16} color="#64748b" />
            <input
              type="text"
              placeholder={`Search ${trackingLabel.plural.toLowerCase()}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                marginLeft: '8px',
                fontSize: '14px',
                width: '100%',
                color: '#0f172a',
              }}
            />
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '0 24px' }}>
          {isLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
              <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 12px' }} />
              Loading {trackingLabel.plural.toLowerCase()}...
            </div>
          ) : filteredBatches.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
              No {trackingLabel.plural.toLowerCase()} found.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px', marginBottom: '24px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '12px 8px', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '12px', fontWeight: 600 }}>{trackingLabel.singular.toUpperCase()}</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '12px', fontWeight: 600 }}>AVAILABLE QTY</th>
                  <th style={{ width: '80px', borderBottom: '1px solid #e2e8f0' }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.map((b) => (
                  <tr key={b.batchId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 8px', color: '#0f172a', fontSize: '14px', fontWeight: 500 }}>
                      {b.supplierBatchRef || 'Unnamed'}
                      {b.manufacturerBatch && (
                        <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 400, marginTop: '2px' }}>
                          Mfg: {b.manufacturerBatch}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 8px', color: '#0f172a', fontSize: '14px', textAlign: 'right', fontWeight: 500 }}>
                      {b.availableQty}
                    </td>
                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(b.batchId, b.supplierBatchRef);
                          onClose();
                        }}
                        style={{
                          background: '#eff6ff',
                          color: '#2563eb',
                          border: 'none',
                          padding: '6px 12px',
                          borderRadius: '4px',
                          fontSize: '13px',
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
