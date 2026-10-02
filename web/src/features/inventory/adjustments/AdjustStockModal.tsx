import { useMemo, useState } from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { toApiErrorMessage } from '../../../api/client';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { DateInput } from '../../../components/ui/DateInput';
import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { useBatchUnitLabel, useTrackingLabel } from '../../../hooks/useTrackingLabel';
import {
  fetchLocations,
  isOwnLocation,
  type Location,
} from '../../configuration/locations/locations.api';
import { itemsApi } from '../../items/items.api';
import { stockOnHandOf } from '../../items/stockFigures';
import type { Item } from '../../items/items.schemas';
import { formatQty } from '../../jobwork/jobwork.schemas';
import { fetchAvailableBatches } from '../../jobwork/batches/batches.api';
import { AddBatchesModal } from '../../jobwork/issues/AddBatchesModal';
import type { BatchSelection } from '../../jobwork/issues/batchSelection';
import {
  AddBillBatchesModal,
  type InitialBillBatch,
} from '../../purchases/bills/AddBillBatchesModal';
import { createAdjustment } from './adjustments.api';
import {
  ADJUSTMENT_REASON_OPTIONS,
  type AdjustmentBatchPayload,
  type CreateAdjustmentPayload,
} from './adjustments.schemas';

interface AdjustStockModalProps {
  orgId: string;
  item: Item & { id: string };
  onClose: () => void;
}

type Field =
  'adjustmentDate' | 'locationId' | 'quantityAdjusted' | 'costPrice' | 'batches' | 'reason';

const QTY_EPSILON = 0.00005;
const BATCH_PAGE = 200;

const round4 = (value: number) => Number(value.toFixed(4));
/** `''` for a box nobody has typed in, so it shows its placeholder rather than 0. */
const numberOf = (text: string) => {
  const value = parseFloat(text);
  return Number.isFinite(value) ? value : 0;
};

const rowStyle: React.CSSProperties = {
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 260px)',
  padding: '10px 12px',
  borderBottom: '1px solid #eef0f3',
};

const labelStyle: React.CSSProperties = { fontSize: 13, color: '#334155' };
const requiredStyle: React.CSSProperties = { ...labelStyle, color: '#dc2626' };

const inputStyle = (hasError: boolean, readOnly = false): React.CSSProperties => ({
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  height: 36,
  padding: '0 10px',
  border: `1px solid ${hasError ? '#dc2626' : '#d5dae1'}`,
  borderRadius: 4,
  fontSize: 13,
  textAlign: 'right',
  color: '#111',
  background: readOnly ? '#f8fafc' : '#fff',
});

/**
 * Adjust Stock — quantity only (docs/STOCK_ADJUSTMENT_PLAN.md §5).
 *
 * "New quantity on hand" and "Quantity adjusted" are one number seen two ways:
 * typing either rewrites the other from the quantity available. Only the
 * DIFFERENCE is sent — the server re-reads the balance itself.
 *
 * A batch-tracked item says which batches: the bill's Add Batches dialog on an
 * increase, the issue's Select Batches dialog on a decrease — the same two
 * dialogs, not copies of them.
 */
export function AdjustStockModal({ orgId, item, onClose }: AdjustStockModalProps) {
  const queryClient = useQueryClient();
  const tracking = useTrackingLabel();
  const unitLabel = useBatchUnitLabel();
  const uomLabel = item.stockingUom?.symbol || item.unit || '';
  const isBatchTracked = String(item.inventoryTracking ?? '').toLowerCase() === 'batch';

  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().slice(0, 10));
  const [referenceNumber, setReferenceNumber] = useState('');
  const [chosenLocationId, setChosenLocationId] = useState<string | null>(null);
  /**
   * ONE typed figure, and which box it was typed in — the other box is derived
   * from it at render. Holding both as text would let them drift apart when the
   * quantity available changes under them (another location, a late-loading balance).
   */
  const [typed, setTyped] = useState<{ box: 'adjusted' | 'new'; text: string }>({
    box: 'adjusted',
    text: '',
  });
  const [costPrice, setCostPrice] = useState(
    item.costPrice !== null && item.costPrice !== undefined ? String(item.costPrice) : '',
  );
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [inBatches, setInBatches] = useState<InitialBillBatch[]>([]);
  const [outSelection, setOutSelection] = useState<Record<string, BatchSelection>>({});
  const [picker, setPicker] = useState<'in' | 'out' | null>(null);
  const [pickSearch, setPickSearch] = useState('');
  const [invalid, setInvalid] = useState<ReadonlySet<Field>>(new Set());

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId),
  });
  const { data: stockRows = [] } = useQuery({
    queryKey: ['itemOpeningStock', orgId, item.id],
    queryFn: () => itemsApi.getOpeningStock(orgId, item.id),
  });

  // Our own premises only — stock at a job worker is adjusted by closing the challan.
  const ownLocations = useMemo(() => locations.filter(isOwnLocation), [locations]);
  const locationId =
    chosenLocationId ??
    ownLocations.find((location: Location) => location.isPrimary)?.id ??
    (ownLocations.length === 1 ? ownLocations[0]!.id : '');
  const locationName = ownLocations.find((location) => location.id === locationId)?.name ?? null;

  const available = useMemo(() => {
    const row = stockRows.find((one) => one.locationId === locationId);
    return row ? stockOnHandOf(row) : 0;
  }, [stockRows, locationId]);

  const adjustedFor = (entry: typeof typed) =>
    entry.text.trim() === ''
      ? 0
      : entry.box === 'adjusted'
        ? numberOf(entry.text)
        : round4(numberOf(entry.text) - available);
  const adjusted = adjustedFor(typed);
  const magnitude = Math.abs(adjusted);
  const isIncrease = adjusted > 0;
  const isDecrease = adjusted < 0;
  const isBlank = typed.text.trim() === '';
  const adjustedText = typed.box === 'adjusted' ? typed.text : isBlank ? '' : String(adjusted);
  const newQtyText =
    typed.box === 'new' ? typed.text : isBlank ? '' : String(round4(available + adjusted));

  const clear = (field: Field) =>
    setInvalid((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });

  /** The batch rows belong to one direction at one godown; either changing makes
   * them answers to a question no longer being asked. */
  const dropBatches = () => {
    setInBatches([]);
    setOutSelection({});
  };

  const setQuantity = (box: 'adjusted' | 'new', text: string) => {
    const next = { box, text };
    if (Math.sign(adjustedFor(next)) !== Math.sign(adjusted)) dropBatches();
    setTyped(next);
    clear('quantityAdjusted');
    clear('batches');
  };

  const pickedTotal = isIncrease
    ? inBatches.reduce((sum, batch) => sum + numberOf(String(batch.quantity ?? '')), 0)
    : Object.values(outSelection).reduce((sum, row) => sum + row.qty, 0);
  const pickedCount = isIncrease
    ? inBatches.length
    : new Set(Object.values(outSelection).map((row) => row.batch.batchId)).size;

  const { data: pickBatches = [], isLoading: pickBatchesLoading } = useQuery({
    queryKey: [
      'available-batches',
      orgId,
      item.id,
      locationId,
      pickSearch,
      'adjustment',
      unitLabel.enabled,
    ],
    queryFn: () =>
      fetchAvailableBatches(orgId, {
        itemId: item.id,
        locationId,
        ownership: 'own',
        search: pickSearch || undefined,
        limit: BATCH_PAGE,
        withUnits: unitLabel.enabled,
      }),
    enabled: picker === 'out' && Boolean(locationId),
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateAdjustmentPayload) => createAdjustment(orgId, payload),
    onSuccess: (adjustment) => {
      toast.success(`Stock adjusted — ${adjustment.adjustmentNumber}.`);
      // Every figure this item shows is cached; a stale one reads as "the
      // adjustment did nothing".
      void queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey.includes(item.id) ||
          ['items', 'availableBatches', 'available-batches', 'stockAdjustments'].includes(
            String(queryKey[0]),
          ),
      });
      onClose();
    },
    onError: (error) => {
      toast.error(toApiErrorMessage(error));
      if (axios.isAxiosError(error)) {
        const details = (error.response?.data as { details?: Record<string, unknown> })?.details;
        if (details) setInvalid(new Set(Object.keys(details) as Field[]));
      }
    },
  });

  const handleSave = () => {
    const problems: [Field, string][] = [];
    if (!adjustmentDate) problems.push(['adjustmentDate', 'Enter the date.']);
    if (!locationId) problems.push(['locationId', 'Select a location.']);
    if (magnitude < QTY_EPSILON) problems.push(['quantityAdjusted', 'Enter a quantity to adjust.']);
    else if (isDecrease && magnitude > available + QTY_EPSILON) {
      problems.push([
        'quantityAdjusted',
        `Only ${formatQty(available)} ${uomLabel} is available here.`,
      ]);
    }
    if (isIncrease && (costPrice.trim() === '' || numberOf(costPrice) < 0)) {
      problems.push(['costPrice', 'Enter the cost price.']);
    }
    if (isBatchTracked && magnitude >= QTY_EPSILON) {
      if (pickedCount === 0) {
        problems.push([
          'batches',
          `${isIncrease ? 'Add' : 'Select'} the ${tracking.plural.toLowerCase()}.`,
        ]);
      } else if (Math.abs(pickedTotal - magnitude) > QTY_EPSILON) {
        problems.push([
          'batches',
          `${tracking.plural} add up to ${formatQty(pickedTotal)}, not ${formatQty(magnitude)}.`,
        ]);
      }
    }
    if (!reason) problems.push(['reason', 'Select a reason.']);

    if (problems.length > 0) {
      setInvalid(new Set(problems.map(([field]) => field)));
      toast.error(problems[0]![1]);
      return;
    }

    const batches: AdjustmentBatchPayload[] | undefined = !isBatchTracked
      ? undefined
      : isIncrease
        ? inBatches.map((batch) => ({
            batchId: batch.batchId || undefined,
            supplierBatchRef: batch.supplierBatchRef || undefined,
            manufacturerBatch: batch.manufacturerBatch || undefined,
            manufacturedDate: batch.manufacturedDate ? String(batch.manufacturedDate) : undefined,
            expiryDate: batch.expiryDate ? String(batch.expiryDate) : undefined,
            mrp: batch.mrp === null || batch.mrp === undefined ? undefined : Number(batch.mrp),
            sellingPrice:
              batch.sellingPrice === null || batch.sellingPrice === undefined
                ? undefined
                : Number(batch.sellingPrice),
            quantity: Number(batch.quantity),
            units: batch.units?.map((unit) => ({
              batchUnitId: unit.batchUnitId || undefined,
              label: unit.label || undefined,
              quantity: Number(unit.quantity),
            })),
          }))
        : Object.values(outSelection).map((row) => ({
            batchId: row.batch.batchId,
            batchUnitId: row.unit?.batchUnitId ?? null,
            quantity: row.qty,
          }));

    mutation.mutate({
      itemId: item.id,
      locationId,
      adjustmentDate,
      quantityAdjusted: adjusted,
      costPrice: isIncrease ? numberOf(costPrice) : null,
      reason,
      referenceNumber: referenceNumber.trim() || null,
      description: description.trim() || null,
      batches,
    });
  };

  return (
    <>
      <Modal
        isOpen
        title={`Adjust Stock - ${item.name}`}
        onClose={onClose}
        width={640}
        footer={
          <>
            <button
              type="button"
              onClick={handleSave}
              disabled={mutation.isPending}
              style={{
                minHeight: 44,
                padding: '6px 20px',
                background: mutation.isPending ? '#f1f5f9' : '#15803d',
                color: mutation.isPending ? '#94a3b8' : '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: mutation.isPending ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                fontSize: 13,
              }}
            >
              {mutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                minHeight: 44,
                padding: '6px 16px',
                background: '#fff',
                color: '#334155',
                border: '1px solid #d5dae1',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Cancel
            </button>
          </>
        }
      >
        <div
          className="form-field-grid"
          style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', alignItems: 'start' }}
        >
          <div style={{ minWidth: 0 }}>
            <label
              htmlFor="adjust-date"
              style={{ ...requiredStyle, display: 'block', marginBottom: 6 }}
            >
              Date*
            </label>
            <DateInput
              id="adjust-date"
              value={adjustmentDate}
              onChange={(value) => {
                setAdjustmentDate(value);
                clear('adjustmentDate');
              }}
              hasError={invalid.has('adjustmentDate')}
              portal
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <label
              htmlFor="adjust-reference"
              style={{ ...labelStyle, display: 'block', marginBottom: 6 }}
            >
              Reference Number
            </label>
            <input
              id="adjust-reference"
              value={referenceNumber}
              maxLength={100}
              onChange={(event) => setReferenceNumber(event.target.value)}
              style={{ ...inputStyle(false), textAlign: 'left' }}
            />
          </div>
        </div>

        <div style={{ border: '1px solid #eef0f3', borderRadius: 4, marginTop: 16 }}>
          <div className="form-field-grid" style={rowStyle}>
            <span style={requiredStyle}>Location*</span>
            <Select
              value={locationId}
              onChange={(value) => {
                if (value !== locationId) dropBatches();
                setChosenLocationId(value);
                clear('locationId');
              }}
              options={ownLocations.map((location) => ({
                value: location.id,
                label: location.name,
              }))}
              placeholder="Select a location…"
              hasError={invalid.has('locationId')}
              ariaLabel="Location"
              portal
            />
          </div>

          <div className="form-field-grid" style={rowStyle}>
            <label htmlFor="adjust-available" style={labelStyle}>
              Quantity Available{uomLabel ? ` (${uomLabel})` : ''}
            </label>
            <input
              id="adjust-available"
              value={formatQty(available)}
              readOnly
              tabIndex={-1}
              style={inputStyle(false, true)}
            />
          </div>

          <div className="form-field-grid" style={rowStyle}>
            <label htmlFor="adjust-new" style={labelStyle}>
              New Quantity on hand
            </label>
            <input
              id="adjust-new"
              inputMode="decimal"
              placeholder="0.00"
              value={newQtyText}
              onChange={(event) => {
                if (/^\d*\.?\d{0,4}$/.test(event.target.value))
                  setQuantity('new', event.target.value);
              }}
              style={inputStyle(invalid.has('quantityAdjusted'))}
            />
          </div>

          <div className="form-field-grid" style={rowStyle}>
            <label htmlFor="adjust-quantity" style={requiredStyle}>
              Quantity Adjusted*
            </label>
            <input
              id="adjust-quantity"
              inputMode="decimal"
              placeholder="Eg. +10, -10"
              value={adjustedText}
              onChange={(event) => {
                // A sign, digits and one point — "+5" and "-15" are how this is typed.
                if (/^[+-]?\d*\.?\d{0,4}$/.test(event.target.value)) {
                  setQuantity('adjusted', event.target.value);
                }
              }}
              style={inputStyle(invalid.has('quantityAdjusted'))}
            />
          </div>

          {/* A decrease states no cost — FIFO decides what stock leaving is worth. */}
          {isIncrease && (
            <div className="form-field-grid" style={rowStyle}>
              <label htmlFor="adjust-cost" style={requiredStyle}>
                Cost Price*
              </label>
              <input
                id="adjust-cost"
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={costPrice}
                onWheel={blurOnWheel}
                onChange={(event) => {
                  setCostPrice(event.target.value);
                  clear('costPrice');
                }}
                style={inputStyle(invalid.has('costPrice'))}
              />
            </div>
          )}

          {isBatchTracked && magnitude >= QTY_EPSILON && (
            <div className="form-field-grid" style={{ ...rowStyle, borderBottom: 'none' }}>
              <span style={requiredStyle}>{tracking.singular} Details*</span>
              <button
                type="button"
                disabled={!locationId}
                onClick={() => {
                  setPickSearch('');
                  setPicker(isIncrease ? 'in' : 'out');
                  clear('batches');
                }}
                style={{
                  minHeight: 36,
                  padding: '0 10px',
                  background: '#fff',
                  border: `1px solid ${invalid.has('batches') ? '#dc2626' : '#d5dae1'}`,
                  borderRadius: 4,
                  color: '#2563eb',
                  fontSize: 13,
                  textAlign: 'right',
                  cursor: locationId ? 'pointer' : 'not-allowed',
                }}
              >
                {pickedCount > 0
                  ? `${pickedCount} ${pickedCount === 1 ? tracking.singular : tracking.plural} · ${formatQty(pickedTotal)} ${uomLabel}`
                  : `${isIncrease ? 'Add' : 'Select'} ${tracking.plural}`}
              </button>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <span style={{ ...requiredStyle, display: 'block', marginBottom: 6 }}>Reason*</span>
          <Select
            value={reason}
            onChange={(value) => {
              setReason(value);
              clear('reason');
            }}
            options={ADJUSTMENT_REASON_OPTIONS}
            placeholder="Select a reason…"
            hasError={invalid.has('reason')}
            ariaLabel="Reason"
            portal
          />
        </div>

        <div style={{ marginTop: 16 }}>
          <label
            htmlFor="adjust-description"
            style={{ ...labelStyle, display: 'block', marginBottom: 6 }}
          >
            Description
          </label>
          <textarea
            id="adjust-description"
            value={description}
            rows={3}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              border: '1px solid #d5dae1',
              borderRadius: 4,
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </div>
      </Modal>

      {/* Both mounted only while open: each seeds its rows once, on mount. */}
      {picker === 'in' && (
        <AddBillBatchesModal
          orgId={orgId}
          itemId={item.id}
          locationId={locationId}
          isOpen
          onClose={() => setPicker(null)}
          itemName={item.name}
          sku={item.sku}
          uomLabel={uomLabel}
          locationName={locationName}
          lineQty={magnitude}
          initialBatches={inBatches}
          defaultSellingPrice={item.sellingPrice ? String(item.sellingPrice) : ''}
          defaultMrp=""
          onSave={(batches, overwriteQty) => {
            setInBatches(batches);
            if (overwriteQty !== null) setTyped({ box: 'adjusted', text: String(overwriteQty) });
            setPicker(null);
          }}
        />
      )}
      {picker === 'out' && (
        <AddBatchesModal
          isOpen
          onClose={() => setPicker(null)}
          itemName={item.name}
          sku={item.sku || null}
          uomLabel={uomLabel}
          locationName={locationName}
          plannedQty={null}
          lineQty={magnitude}
          selection={outSelection}
          onSave={(rows, overwriteQty) => {
            setOutSelection(rows);
            if (overwriteQty !== null) setTyped({ box: 'adjusted', text: String(-overwriteQty) });
            setPicker(null);
          }}
          batches={pickBatches}
          search={pickSearch}
          onSearchChange={setPickSearch}
          isLoading={pickBatchesLoading}
          isCapped={pickBatches.length >= BATCH_PAGE}
        />
      )}
    </>
  );
}
