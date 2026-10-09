import { useState } from 'react';
import type { Location } from '../../configuration/locations/locations.api';
import type { ItemOpeningStockLocationRowDto } from '../items.schemas';
import { LineItemStockDisplay } from '../../purchases/bills/components/LineItemStockDisplay';
import { WarehouseLocationsPopover } from '../../purchases/bills/components/WarehouseLocationsPopover';

interface ItemStockAndBatchDisplayProps {
  orgId: string;
  itemId: string;
  unit?: string | null;
  deliveryLocationId: string;
  locations: Location[];
  trackInventory?: boolean;
  inventoryTracking?: 'batch' | 'none' | null;
  batchButtonLabel?: string;
  onBatchClick?: () => void;
}

export function ItemStockAndBatchDisplay({
  orgId,
  itemId,
  unit,
  deliveryLocationId,
  locations,
  trackInventory,
  inventoryTracking,
  batchButtonLabel = '+ Add Batches',
  onBatchClick,
}: ItemStockAndBatchDisplayProps) {
  const [stockPopoverAnchor, setStockPopoverAnchor] = useState<{
    element: HTMLElement;
    stockRows: ItemOpeningStockLocationRowDto[];
  } | null>(null);

  return (
    <div style={{ marginTop: '6px' }}>
      <LineItemStockDisplay
        orgId={orgId}
        itemId={itemId}
        unit={unit}
        deliveryLocationId={deliveryLocationId}
        locations={locations}
        onClick={(e, rows) =>
          setStockPopoverAnchor({
            element: e.currentTarget,
            stockRows: rows,
          })
        }
      />

      {trackInventory && inventoryTracking === 'batch' && onBatchClick && (
        <div style={{ marginTop: '6px', textAlign: 'right' }}>
          <button
            type="button"
            onClick={onBatchClick}
            style={{
              background: 'none',
              border: 'none',
              color: '#2563eb',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            {batchButtonLabel}
          </button>
        </div>
      )}

      <WarehouseLocationsPopover
        isOpen={!!stockPopoverAnchor}
        onClose={() => setStockPopoverAnchor(null)}
        anchorEl={stockPopoverAnchor?.element || null}
        locations={locations}
        stockRows={stockPopoverAnchor?.stockRows || []}
        selectedLocationId={deliveryLocationId}
      />
    </div>
  );
}
