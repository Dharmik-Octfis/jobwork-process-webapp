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
    <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', fontSize: '12px' }}>
      <div style={{ color: '#1e293b' }}>
        Stock on Hand:
      </div>
      <div style={{ fontWeight: 500, color: '#0f172a' }}>
        {locationOnHand.toFixed(2)} pcs
      </div>
      <button
        type="button"
        onClick={(e) => onClick(e, openingStockRows)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          fontSize: '13px',
          color: '#2563eb',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h18"></path>
          <path d="M9 8h1"></path>
          <path d="M9 12h1"></path>
          <path d="M9 16h1"></path>
          <path d="M14 8h1"></path>
          <path d="M14 12h1"></path>
          <path d="M14 16h1"></path>
          <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
        </svg>
        {deliveryLocationName}
      </button>
    </div>
  );
}
