import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchFifoCost } from './adjustments.api';

interface FifoCostFieldProps {
  orgId: string;
  itemId: string;
  locationId: string;
  /** How much is leaving — positive. */
  quantity: number;
  id?: string;
  ariaLabel?: string;
  style: React.CSSProperties;
}

/** A decrease's cost price: what FIFO would take for it now. Read-only — the user never states it. */
export function FifoCostField({
  orgId,
  itemId,
  locationId,
  quantity,
  id,
  ariaLabel,
  style,
}: FifoCostFieldProps) {
  const { data } = useQuery({
    queryKey: ['adjustmentFifoCost', orgId, itemId, locationId, quantity],
    queryFn: () => fetchFifoCost(orgId, { itemId, locationId, quantity }),
    enabled: !!locationId && quantity > 0,
    placeholderData: keepPreviousData,
    // Any posting moves the layers; never show a cost from before it.
    staleTime: 0,
  });

  return (
    <input
      id={id}
      aria-label={ariaLabel}
      value={data?.unitCost != null ? Number(data.unitCost).toFixed(2) : ''}
      placeholder="—"
      disabled
      title="FIFO cost"
      className="locked-value"
      style={style}
    />
  );
}
