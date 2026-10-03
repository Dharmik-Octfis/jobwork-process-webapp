import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBatchUnitLabel } from '../../../hooks/useTrackingLabel';
import { fetchAvailableBatches } from '../../jobwork/batches/batches.api';
import { AddBatchesModal } from '../../jobwork/issues/AddBatchesModal';
import { AddBillBatchesModal } from '../../purchases/bills/AddBillBatchesModal';
import { selectionFromSaved, uomOf, type AdjustableItem, type LineDraft } from './adjustmentLine';

const BATCH_PAGE = 200;

interface LineBatchPickerProps {
  orgId: string;
  item: AdjustableItem;
  locationId: string;
  locationName: string | null;
  line: LineDraft;
  /** The line's signed quantity: its sign picks the dialog, its size the target. */
  adjusted: number;
  /** The batch rows, and — when the user ticked "overwrite" — the new signed quantity. */
  onSave: (line: LineDraft, overwriteAdjusted: number | null) => void;
  onClose: () => void;
}

/**
 * Which batches a batch-tracked line touches: the bill's Add Batches dialog on
 * an increase, the issue's Select Batches dialog on a decrease — the same two
 * dialogs every other screen uses, not copies of them.
 *
 * Mounted only while open: each dialog seeds its rows once, on mount.
 */
export function LineBatchPicker({
  orgId,
  item,
  locationId,
  locationName,
  line,
  adjusted,
  onSave,
  onClose,
}: LineBatchPickerProps) {
  const unitLabel = useBatchUnitLabel();
  const [search, setSearch] = useState('');
  const isIncrease = adjusted > 0;
  const magnitude = Math.abs(adjusted);

  const { data: batches = [], isLoading } = useQuery({
    queryKey: [
      'available-batches',
      orgId,
      item.id,
      locationId,
      search,
      'adjustment',
      unitLabel.enabled,
    ],
    queryFn: () =>
      fetchAvailableBatches(orgId, {
        itemId: item.id,
        locationId,
        ownership: 'own',
        search: search || undefined,
        limit: BATCH_PAGE,
        withUnits: unitLabel.enabled,
      }),
    enabled: !isIncrease && Boolean(locationId),
  });

  if (isIncrease) {
    return (
      <AddBillBatchesModal
        orgId={orgId}
        itemId={item.id}
        locationId={locationId}
        isOpen
        onClose={onClose}
        itemName={item.name}
        sku={item.sku}
        uomLabel={uomOf(item)}
        locationName={locationName}
        lineQty={magnitude}
        initialBatches={line.inBatches}
        defaultSellingPrice={item.sellingPrice ? String(item.sellingPrice) : ''}
        defaultMrp=""
        onSave={(rows, overwriteQty) => onSave({ ...line, inBatches: rows }, overwriteQty)}
      />
    );
  }

  const hasSelection = Object.keys(line.outSelection).length > 0;
  // A saved draft's rows become a selection only once the batches behind them
  // have loaded — and the dialog reads its selection once, so it waits for that.
  if (!hasSelection && line.outSaved.length > 0 && isLoading) return null;
  const selection = hasSelection ? line.outSelection : selectionFromSaved(line.outSaved, batches);

  return (
    <AddBatchesModal
      isOpen
      onClose={onClose}
      itemName={item.name}
      sku={item.sku || null}
      uomLabel={uomOf(item)}
      locationName={locationName}
      plannedQty={null}
      lineQty={magnitude}
      selection={selection}
      onSave={(rows, overwriteQty) =>
        onSave(
          { ...line, outSelection: rows, outSaved: [] },
          overwriteQty === null ? null : -overwriteQty,
        )
      }
      batches={batches}
      search={search}
      onSearchChange={setSearch}
      isLoading={isLoading}
      isCapped={batches.length >= BATCH_PAGE}
    />
  );
}
