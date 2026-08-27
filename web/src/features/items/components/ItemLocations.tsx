import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, ChevronDown } from 'lucide-react';
import { fetchLocations, type Location } from '../../configuration/locations/locations.api';
import { itemsApi } from '../items.api';
import type { ItemOpeningStockLocationRowDto } from '../items.schemas';

// Stable identity so the `useMemo` below doesn't recompute on every render while the query loads.
const EMPTY_ROWS: ItemOpeningStockLocationRowDto[] = [];

interface ItemLocationsProps {
  orgId: string;
  itemId: string;
  isBatchTracked?: boolean;
}

export function ItemLocations({ orgId, itemId, isBatchTracked: _isBatchTracked = true }: ItemLocationsProps) {
  const navigate = useNavigate();
  const [stockType, setStockType] = useState<'accounting' | 'physical'>('accounting');
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);

  const { data: _item } = useQuery({
    queryKey: ['item', orgId, itemId],
    queryFn: () => itemsApi.getItem(orgId, itemId),
    enabled: !!orgId && !!itemId,
  });

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId),
    enabled: !!orgId,
  });

  const { data: openingStockRows = EMPTY_ROWS, isLoading: isOpeningStockLoading } = useQuery({
    queryKey: ['itemOpeningStock', orgId, itemId],
    queryFn: () => itemsApi.getOpeningStock(orgId, itemId),
    enabled: !!orgId && !!itemId,
  });


  // 🔴 `stockOnHand` FIRST — it is the ledger balance, which is what every other
  // screen sees. Reading `openingStock` ahead of it froze this column at the
  // declared figure, so an item that had since been issued to a processor still
  // showed its full opening quantity here and nowhere else. The declared value and
  // the batch total survive only as fallbacks for a payload that predates them; a
  // location drained to 0 must read 0, which is why this tests nullish and not
  // truthiness.
  const stockByLocation = useMemo(() => {
    const map = new Map<string, { onHand: number; committed: number; available: number }>();
    for (const row of Array.isArray(openingStockRows) ? openingStockRows : []) {
      const batchTotal = row.batches.reduce(
        (acc, batch) => acc + (Number(batch.quantityIn) || 0),
        0,
      );
      const onHand = Number(row.stockOnHand ?? row.openingStock ?? batchTotal) || 0;
      const committed = Number(row.committedStock ?? 0) || 0;
      const available = Number(row.availableForSale ?? onHand - committed) || 0;
      map.set(row.locationId, { onHand, committed, available });
    }
    return map;
  }, [openingStockRows]);

  return (
    <div style={{ padding: '0 24px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 500, color: '#1e293b', margin: 0 }}>
            Stock Locations
          </h2>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setIsSettingsMenuOpen(!isSettingsMenuOpen)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                height: '32px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                background: '#f8fafc',
                cursor: 'pointer',
                color: '#334155',
              }}
            >
              <Settings size={15} />
              <ChevronDown size={12} />
            </button>
            {isSettingsMenuOpen && (
              <>
                <div
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9 }}
                  onClick={() => setIsSettingsMenuOpen(false)}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    marginTop: '6px',
                    left: 0,
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    boxShadow:
                      '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                    zIndex: 10,
                    padding: '6px',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      navigate(`/organizations/${orgId}/items/${itemId}/opening-stock`);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 16px',
                      textAlign: 'center',
                      background: '#3b82f6',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: 500,
                      color: '#ffffff',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#2563eb';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#3b82f6';
                    }}
                  >
                    Add Opening Stock
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            border: '1px solid #0062ff',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => setStockType('accounting')}
            style={{
              padding: '6px 16px',
              fontSize: '13px',
              fontWeight: 500,
              border: 'none',
              background: stockType === 'accounting' ? '#0062ff' : '#fff',
              color: stockType === 'accounting' ? '#fff' : '#0062ff',
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
          >
            Accounting Stock
          </button>
          <button
            type="button"
            onClick={() => setStockType('physical')}
            style={{
              padding: '6px 16px',
              fontSize: '13px',
              fontWeight: 500,
              border: 'none',
              borderLeft: '1px solid #0062ff',
              background: stockType === 'physical' ? '#0062ff' : '#fff',
              color: stockType === 'physical' ? '#fff' : '#0062ff',
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
          >
            Physical Stock
          </button>
        </div>
      </div>

      <div
        style={{
          border: '1px solid #eef0f3',
          borderRadius: '6px',
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eef0f3' }}>
              <th
                rowSpan={2}
                style={{
                  padding: '12px 16px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  borderRight: '1px solid #eef0f3',
                  verticalAlign: 'middle',
                }}
              >
                Location Name
              </th>
              <th
                colSpan={3}
                style={{
                  padding: '12px 16px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  textAlign: 'center',
                }}
              >
                {stockType === 'accounting' ? 'Accounting Stock' : 'Physical Stock'}
              </th>
            </tr>
            <tr style={{ borderBottom: '1px solid #eef0f3' }}>
              <th
                style={{
                  padding: '12px 16px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  borderRight: '1px solid #eef0f3',
                  borderTop: '1px solid #eef0f3',
                }}
              >
                Stock on Hand
              </th>
              <th
                style={{
                  padding: '12px 16px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  borderRight: '1px solid #eef0f3',
                  borderTop: '1px solid #eef0f3',
                }}
              >
                Committed Stock
              </th>
              <th
                style={{
                  padding: '12px 16px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  borderTop: '1px solid #eef0f3',
                }}
              >
                Available for Sale
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading || isOpeningStockLoading ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: '#64748b',
                    fontSize: '13px',
                  }}
                >
                  Loading locations...
                </td>
              </tr>
            ) : locations.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: '#64748b',
                    fontSize: '13px',
                  }}
                >
                  No locations found.
                </td>
              </tr>
            ) : (
              [...locations]
                .sort((a, b) => (a.isPrimary ? -1 : b.isPrimary ? 1 : 0))
                .map((loc: Location) => {
                  const stock = stockByLocation.get(loc.id) ?? {
                    onHand: 0,
                    committed: 0,
                    available: 0,
                  };
                  return (
                    <tr key={loc.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                      <td
                        style={{
                          padding: '12px 16px',
                          fontSize: '13px',
                          color: '#1e293b',
                          borderRight: '1px solid #eef0f3',
                        }}
                      >
                        {loc.name} {loc.isPrimary && <span style={{ color: '#fbbf24' }}>★</span>}
                      </td>
                      <td
                        style={{
                          padding: '12px 16px',
                          fontSize: '13px',
                          color: '#1e293b',
                          borderRight: '1px solid #eef0f3',
                          textAlign: 'right',
                        }}
                      >
                        {stock.onHand.toFixed(2)}
                      </td>
                      <td
                        style={{
                          padding: '12px 16px',
                          fontSize: '13px',
                          color: '#1e293b',
                          borderRight: '1px solid #eef0f3',
                          textAlign: 'right',
                        }}
                      >
                        {stock.committed.toFixed(2)}
                      </td>
                      <td
                        style={{
                          padding: '12px 16px',
                          fontSize: '13px',
                          color: '#1e293b',
                          textAlign: 'right',
                        }}
                      >
                        {stock.available.toFixed(2)}
                      </td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
