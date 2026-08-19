import { X, Search, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Location } from '../../../configuration/locations/locations.api';
import type { ItemOpeningStockLocationRowDto } from '../../../items/items.schemas';

interface WarehouseLocationsPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  anchorEl: HTMLElement | null;
  locations: Location[];
  stockRows: ItemOpeningStockLocationRowDto[];
  selectedLocationId?: string;
  onSelectLocation?: (locationId: string) => void;
}

export function WarehouseLocationsPopover({
  isOpen,
  onClose,
  anchorEl,
  locations,
  stockRows,
  selectedLocationId,
  onSelectLocation,
}: WarehouseLocationsPopoverProps) {
  const [search, setSearch] = useState('');
  const [stockType, setStockType] = useState<'accounting' | 'physical'>('accounting');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorEl &&
        !anchorEl.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, anchorEl]);

  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  useEffect(() => {
    if (!isOpen || !anchorEl) return;

    const updatePosition = () => {
      const r = anchorEl.getBoundingClientRect();
      setPos({ top: r.bottom + 8, left: r.left });
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, anchorEl]);

  if (!isOpen || !anchorEl) return null;

  const filteredLocations = [...locations]
    .sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return a.name.localeCompare(b.name);
    })
    .filter((loc) =>
      loc.name.toLowerCase().includes(search.toLowerCase())
    );

  return createPortal(
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        zIndex: 1000,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        width: '600px',
        maxWidth: 'calc(100vw - 32px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 500, color: '#0f172a' }}>
          Warehouse Locations
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              display: 'flex',
              background: '#f1f5f9',
              borderRadius: '6px',
              padding: '2px',
            }}
          >
            <button
              type="button"
              onClick={() => setStockType('accounting')}
              style={{
                padding: '4px 12px',
                border: 'none',
                background: stockType === 'accounting' ? '#fff' : 'transparent',
                boxShadow: stockType === 'accounting' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 500,
                color: stockType === 'accounting' ? '#0f172a' : '#64748b',
                cursor: 'pointer',
              }}
            >
              Accounting Stock
            </button>
            <button
              type="button"
              onClick={() => setStockType('physical')}
              style={{
                padding: '4px 12px',
                border: 'none',
                background: stockType === 'physical' ? '#fff' : 'transparent',
                boxShadow: stockType === 'physical' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 500,
                color: stockType === 'physical' ? '#0f172a' : '#64748b',
                cursor: 'pointer',
              }}
            >
              Physical Stock
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ef4444',
              cursor: 'pointer',
              display: 'flex',
              padding: '4px',
            }}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', maxHeight: '300px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <th
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontWeight: 500,
                  color: '#64748b',
                  width: '40%',
                  borderRight: '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Search size={14} color="#94a3b8" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Location Name"
                    style={{
                      border: 'none',
                      background: 'transparent',
                      outline: 'none',
                      width: '100%',
                      fontSize: '13px',
                      color: '#0f172a',
                    }}
                  />
                </div>
              </th>
              <th
                colSpan={3}
                style={{
                  padding: '8px',
                  textAlign: 'center',
                  fontWeight: 500,
                  color: '#64748b',
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                {stockType === 'accounting' ? 'Accounting Stock' : 'Physical Stock'}
              </th>
            </tr>
            <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <th style={{ borderRight: '1px solid #e2e8f0' }}></th>
              <th
                style={{
                  padding: '8px 16px',
                  textAlign: 'right',
                  fontWeight: 500,
                  color: '#64748b',
                }}
              >
                Stock on Hand
              </th>
              <th
                style={{
                  padding: '8px 16px',
                  textAlign: 'right',
                  fontWeight: 500,
                  color: '#64748b',
                }}
              >
                Committed Stock
              </th>
              <th
                style={{
                  padding: '8px 16px',
                  textAlign: 'right',
                  fontWeight: 500,
                  color: '#64748b',
                }}
              >
                Available for Sale
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredLocations.map((loc) => {
              const row = stockRows.find((r) => r.locationId === loc.id);
              
              // Determine stock values from row or default to 0
              // The API usually returns these fields, but we should fallback gracefully
              let onHand = 0;
              if (row) {
                 const batchTotal = row.batches?.reduce((acc, b) => acc + (Number(b.quantityIn) || 0), 0) || 0;
                 onHand = Number(row.stockOnHand ?? row.openingStock ?? batchTotal) || 0;
              }
              const committed = Number(row?.committedStock ?? 0) || 0;
              const available = Number(row?.availableForSale ?? onHand - committed) || 0;

              return (
                <tr
                  key={loc.id}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    background: selectedLocationId === loc.id ? '#f0f9ff' : '#fff',
                  }}
                >
                  <td
                    style={{
                      padding: '12px 16px',
                      width: '40%',
                      borderRight: '1px solid #e2e8f0',
                    }}
                  >
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        cursor: onSelectLocation ? 'pointer' : 'default',
                      }}
                    >
                      <input
                        type="radio"
                        name="warehouseLocation"
                        checked={selectedLocationId === loc.id}
                        onChange={() => {
                          onSelectLocation?.(loc.id);
                          onClose();
                        }}
                        disabled={!onSelectLocation}
                        style={{ cursor: onSelectLocation ? 'pointer' : 'default' }}
                      />
                      <span style={{ color: '#334155', fontWeight: 500 }}>{loc.name}</span>
                      {loc.isPrimary && <Star size={14} color="#f59e0b" fill="#f59e0b" />}
                    </label>
                  </td>
                  <td
                    style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontWeight: 600,
                      color: '#0f172a',
                      boxSizing: 'border-box',
                    }}
                  >
                    {onHand.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      color: '#64748b',
                    }}
                  >
                    {committed.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      color: '#64748b',
                    }}
                  >
                    {available.toFixed(2)}
                  </td>
                </tr>
              );
            })}
            {filteredLocations.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                  No locations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>,
    document.body
  );
}
