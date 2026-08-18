import { useQuery } from '@tanstack/react-query';
import { itemsApi } from '../../../items/items.api';
import type { Location } from '../../../configuration/locations/locations.api';
import type { ItemOpeningStockLocationRowDto } from '../../../items/items.schemas';
interface LineItemStockDisplayProps {
  orgId: string;
  itemId: string;
  deliveryLocationId: string;
  locations: Location[];
  onClick: (e: React.MouseEvent<HTMLButtonElement>, rows: ItemOpeningStockLocationRowDto[]) => void;
}

export function LineItemStockDisplay({
  orgId,
  itemId,
  deliveryLocationId,
  locations,
  onClick,
}: LineItemStockDisplayProps) {
  const { data: openingStockRows = [], isLoading } = useQuery({
    queryKey: ['itemOpeningStock', orgId, itemId],
    queryFn: () => itemsApi.getOpeningStock(orgId, itemId),
    enabled: !!orgId && !!itemId,
  });

  if (isLoading) {
    return <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>Loading stock...</div>;
  }

  // Find the stock for the current delivery location
  let locationOnHand = 0;
  const locationRow = openingStockRows.find((r) => r.locationId === deliveryLocationId);
  
  if (locationRow) {
    const batchTotal = locationRow.batches?.reduce((acc, b) => acc + (Number(b.quantityIn) || 0), 0) || 0;
    locationOnHand = Number(locationRow.stockOnHand ?? locationRow.openingStock ?? batchTotal) || 0;
  }

  const deliveryLocationName = locations.find((l) => l.id === deliveryLocationId)?.name || 'Unknown Location';

  return (
    <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'flex-end' }}>
      <button
        type="button"
        onClick={(e) => onClick(e, openingStockRows)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          fontSize: '11px',
          color: '#3b82f6',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          textAlign: 'right',
        }}
      >
        <span style={{ fontWeight: 600 }}>{locationOnHand.toFixed(2)} pcs</span>
        <span style={{ color: '#64748b' }}>{deliveryLocationName}</span>
      </button>
    </div>
  );
}
