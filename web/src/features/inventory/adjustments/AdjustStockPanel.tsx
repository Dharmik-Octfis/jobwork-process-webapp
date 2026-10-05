import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notify } from '../../../lib/notify';
import { X } from 'lucide-react';
import { Select } from '../../../components/ui/Select';
import { DateInput } from '../../../components/ui/DateInput';
import { InfoTip } from '../../../components/ui/InfoTip';
import { RadioGroup } from '../../../components/ui/RadioGroup';
import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { useTrackingLabel } from '../../../hooks/useTrackingLabel';
import {
  fetchLocations,
  isOwnLocation,
  type Location,
} from '../../configuration/locations/locations.api';
import { itemsApi } from '../../items/items.api';
import { stockOnHandOf } from '../../items/stockFigures';
import { formatMoney, formatQty } from '../../jobwork/jobwork.schemas';
import { createAdjustment, fetchCurrentValues } from './adjustments.api';
import { FifoCostField } from './FifoCostField';
import {
  ADJUSTMENT_TYPE_OPTIONS,
  type AdjustmentType,
  type SaveAdjustmentPayload,
} from './adjustments.schemas';
import {
  QTY_EPSILON,
  adjustedOf,
  batchButtonText,
  batchSummary,
  boxTexts,
  emptyLine,
  isBatchTracked,
  lineProblem,
  toLinePayload,
  toValueLinePayload,
  uomOf,
  valueProblem,
  withQuantity,
  withoutBatches,
  type AdjustableItem,
  type LineDraft,
} from './adjustmentLine';
import { formPrimaryButton, formSecondaryButton } from './adjustmentButtons';
import { announceOutcome, refreshAfterAdjustment, reportSaveError } from './adjustmentSave';
import { LineBatchPicker } from './LineBatchPicker';
import { ReasonSelect } from './ReasonSelect';

interface AdjustStockPanelProps {
  orgId: string;
  item: AdjustableItem;
  onClose: () => void;
}

type Field =
  'adjustmentDate' | 'locationId' | 'quantity' | 'costPrice' | 'batches' | 'reasonId' | 'value';

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
 * Adjust Stock, from the item's own page — ONE line of the same document the
 * Inventory → New Adjustment page writes many of, through the same API.
 *
 * "New quantity on hand" and "Quantity adjusted" are one number seen two ways:
 * typing either rewrites the other from the quantity available. Only the
 * DIFFERENCE is sent — the server re-reads the balance itself when it posts.
 *
 * A PANEL, not a dialog: it takes the place of the item's overview in the
 * detail pane, with the item list still beside it, and closing it puts the
 * overview back.
 */
export function AdjustStockPanel({ orgId, item, onClose }: AdjustStockPanelProps) {
  const queryClient = useQueryClient();
  const tracking = useTrackingLabel();
  // The button that opened this is gone (the overview it sat on is replaced), so
  // focus would fall back to the top of the page and Tab would start in the sidebar.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);
  const uomLabel = uomOf(item);

  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('quantity');
  const isValue = adjustmentType === 'value';
  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().slice(0, 10));
  const [referenceNumber, setReferenceNumber] = useState('');
  const [chosenLocationId, setChosenLocationId] = useState<string | null>(null);
  const [line, setLine] = useState<LineDraft>(() => emptyLine(item));
  const [reasonId, setReasonId] = useState('');
  const [description, setDescription] = useState('');
  const [isPicking, setIsPicking] = useState(false);
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

  // A value adjustment's "Current Value": what the stock here is worth, from the cost layers.
  const { data: currentRows = [] } = useQuery({
    queryKey: ['adjustment-values', orgId, locationId, [item.id]],
    queryFn: () => fetchCurrentValues(orgId, { locationId, itemIds: [item.id] }),
    enabled: isValue && Boolean(locationId),
  });
  const current = {
    qty: Number(currentRows[0]?.quantity ?? 0),
    value: Number(currentRows[0]?.value ?? 0),
  };
  const valueTexts = boxTexts(line, current.value);

  const changeType = (next: AdjustmentType) => {
    if (next === adjustmentType) return;
    setAdjustmentType(next);
    setLine(emptyLine(item));
    setInvalid(new Set());
  };

  const adjusted = adjustedOf(line, available);
  const magnitude = Math.abs(adjusted);
  const texts = boxTexts(line, available);
  const picked = batchSummary(line, adjusted);
  const isDecrease = adjusted < 0 && magnitude >= QTY_EPSILON;

  const clear = (...fields: Field[]) =>
    setInvalid((prev) => {
      const next = new Set(prev);
      for (const field of fields) next.delete(field);
      return next.size === prev.size ? prev : next;
    });

  const setQuantity = (box: 'adjusted' | 'new', text: string) => {
    setLine((prev) => withQuantity(prev, box, text, available));
    clear('quantity', 'batches');
  };

  const setValue = (box: 'adjusted' | 'new', text: string) => {
    setLine((prev) => withQuantity(prev, box, text, current.value));
    clear('value');
  };

  const mutation = useMutation({
    mutationFn: (payload: SaveAdjustmentPayload) => createAdjustment(orgId, payload),
    onSuccess: (adjustment) => {
      announceOutcome(adjustment);
      refreshAfterAdjustment(queryClient, [item.id]);
      onClose();
    },
    onError: (error) => {
      const fields = reportSaveError(error);
      // The server files a line's problems under `lines`; here that is the quantity row.
      setInvalid(
        new Set(
          fields.map((field) =>
            field.startsWith('lines') ? (isValue ? 'value' : 'quantity') : field,
          ) as Field[],
        ),
      );
    },
  });

  const handleSave = (saveAs: 'draft' | 'adjust') => {
    const problems: [Field, string][] = [];
    if (!adjustmentDate) problems.push(['adjustmentDate', 'Enter the date.']);
    if (!locationId) problems.push(['locationId', 'Select a location.']);
    if (isValue) {
      if (Math.abs(adjustedOf(line, current.value)) < 0.005) {
        problems.push(['value', 'Enter a value to adjust.']);
      } else if (saveAs === 'adjust') {
        const problem = valueProblem(line, item, current);
        if (problem) problems.push([problem.field, problem.message]);
      }
    } else if (magnitude < QTY_EPSILON) problems.push(['quantity', 'Enter a quantity to adjust.']);
    else if (saveAs === 'adjust') {
      // A draft may be incomplete; Adjust is where it has to be right.
      const problem = lineProblem(line, item, available, {
        batches: tracking.plural.toLowerCase(),
      });
      if (problem) problems.push([problem.field, problem.message]);
    }
    if (!reasonId) problems.push(['reasonId', 'Select a reason.']);

    if (problems.length > 0) {
      setInvalid(new Set(problems.map(([field]) => field)));
      notify.error(problems[0]![1]);
      return;
    }

    mutation.mutate({
      adjustmentType,
      locationId,
      adjustmentDate,
      reasonId,
      referenceNumber: referenceNumber.trim() || null,
      description: description.trim() || null,
      lines: [
        isValue
          ? toValueLinePayload(line, item, current.value)
          : toLinePayload(line, item, available),
      ],
      saveAs,
    });
  };

  const busy = mutation.isPending;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 0,
        background: '#fff',
        borderLeft: '1px solid #eef0f3',
        outline: 'none',
      }}
    >
      <div className="detail-page-header">
        <h2
          className="detail-title"
          style={{ fontWeight: 400, fontSize: 24, color: '#222222', margin: 0, minWidth: 0 }}
        >
          Adjust Stock - {item.name}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            padding: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={18} />
        </button>
      </div>

      <div className="detail-page-content" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 680, minWidth: 0 }}>
          <div style={{ marginBottom: 8 }}>
            <RadioGroup
              name="adjust-stock-type"
              value={adjustmentType}
              onChange={changeType}
              options={ADJUSTMENT_TYPE_OPTIONS}
              ariaLabel="Mode of adjustment"
            />
          </div>
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
                  // The batch rows belong to one godown.
                  if (value !== locationId) setLine((prev) => withoutBatches(prev));
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

            {isValue ? (
              <>
                <div className="form-field-grid" style={rowStyle}>
                  <label htmlFor="adjust-current-value" style={labelStyle}>
                    Current Value
                  </label>
                  <input
                    id="adjust-current-value"
                    value={formatMoney(current.value)}
                    disabled
                    className="locked-value"
                    style={inputStyle(false)}
                  />
                </div>
                <div className="form-field-grid" style={rowStyle}>
                  <label htmlFor="adjust-new-value" style={labelStyle}>
                    Changed Value
                  </label>
                  <input
                    id="adjust-new-value"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={valueTexts.newQty}
                    onChange={(event) => {
                      if (/^\d*\.?\d{0,2}$/.test(event.target.value)) {
                        setValue('new', event.target.value);
                      }
                    }}
                    style={inputStyle(invalid.has('value'))}
                  />
                </div>
                <div className="form-field-grid" style={{ ...rowStyle, borderBottom: 'none' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <label htmlFor="adjust-value" style={requiredStyle}>
                      Adjusted Value*
                    </label>
                    <InfoTip label="How a value adjustment works">
                      The change goes onto the newest purchase of this item at this location; no
                      stock moves. Lowering the value is a write-down. Raise it only to correct a
                      cost entered wrong or to undo an earlier write-down. Post the same change in
                      your accounts.
                    </InfoTip>
                  </span>
                  <input
                    id="adjust-value"
                    inputMode="decimal"
                    placeholder="Eg. +500, -500"
                    value={valueTexts.adjusted}
                    onChange={(event) => {
                      if (/^[+-]?\d*\.?\d{0,2}$/.test(event.target.value)) {
                        setValue('adjusted', event.target.value);
                      }
                    }}
                    style={inputStyle(invalid.has('value'))}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="form-field-grid" style={rowStyle}>
                  <label htmlFor="adjust-available" style={labelStyle}>
                    Quantity Available
                  </label>
                  <div style={{ minWidth: 0 }}>
                    <input
                      id="adjust-available"
                      value={formatQty(available)}
                      disabled
                      className="locked-value"
                      style={inputStyle(false)}
                    />
                    {uomLabel && (
                      <div
                        style={{ fontSize: 11, color: '#64748b', marginTop: 4, textAlign: 'right' }}
                      >
                        {uomLabel}
                      </div>
                    )}
                  </div>
                </div>

                <div className="form-field-grid" style={rowStyle}>
                  <label htmlFor="adjust-new" style={labelStyle}>
                    New Quantity on hand
                  </label>
                  <input
                    id="adjust-new"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={texts.newQty}
                    onChange={(event) => {
                      if (/^\d*\.?\d{0,4}$/.test(event.target.value)) {
                        setQuantity('new', event.target.value);
                      }
                    }}
                    style={inputStyle(invalid.has('quantity'))}
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
                    value={texts.adjusted}
                    onChange={(event) => {
                      // A sign, digits and one point — "+5" and "-15" are how this is typed.
                      if (/^[+-]?\d*\.?\d{0,4}$/.test(event.target.value)) {
                        setQuantity('adjusted', event.target.value);
                      }
                    }}
                    style={inputStyle(invalid.has('quantity'))}
                  />
                </div>

                <div className="form-field-grid" style={rowStyle}>
                  <label htmlFor="adjust-cost" style={isDecrease ? labelStyle : requiredStyle}>
                    {isDecrease ? 'Cost Price' : 'Cost Price*'}
                  </label>
                  {/* A decrease states no cost — FIFO decides what stock leaving is worth, shown read-only. */}
                  {isDecrease ? (
                    <FifoCostField
                      id="adjust-cost"
                      orgId={orgId}
                      itemId={item.id}
                      locationId={locationId}
                      quantity={magnitude}
                      style={inputStyle(false, true)}
                    />
                  ) : (
                    <input
                      id="adjust-cost"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      value={line.costPrice}
                      onWheel={blurOnWheel}
                      onChange={(event) => {
                        setLine((prev) => ({ ...prev, costPrice: event.target.value }));
                        clear('costPrice');
                      }}
                      style={inputStyle(invalid.has('costPrice'))}
                    />
                  )}
                </div>

                {isBatchTracked(item) && magnitude >= QTY_EPSILON && (
                  <div className="form-field-grid" style={{ ...rowStyle, borderBottom: 'none' }}>
                    <span style={requiredStyle}>{tracking.singular} Details*</span>
                    <button
                      type="button"
                      disabled={!locationId}
                      onClick={() => {
                        setIsPicking(true);
                        clear('batches');
                      }}
                      style={{
                        minHeight: 36,
                        padding: '0 10px',
                        background: 'none',
                        border: 'none',
                        borderRadius: 4,
                        color: invalid.has('batches') ? '#dc2626' : '#2563eb',
                        fontSize: 13,
                        textAlign: 'right',
                        cursor: locationId ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {batchButtonText(picked.count, adjusted, tracking)}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ marginTop: 16 }}>
            <span style={{ ...requiredStyle, display: 'block', marginBottom: 6 }}>Reason*</span>
            <ReasonSelect
              orgId={orgId}
              value={reasonId}
              onChange={(value) => {
                setReasonId(value);
                clear('reasonId');
              }}
              hasError={invalid.has('reasonId')}
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
        </div>
      </div>

      <div className="form-actions-footer page-footer">
        <button
          type="button"
          onClick={() => handleSave('adjust')}
          disabled={busy}
          style={formPrimaryButton(busy)}
        >
          {busy ? 'Saving…' : 'Adjust'}
        </button>
        <button
          type="button"
          onClick={() => handleSave('draft')}
          disabled={busy}
          style={formSecondaryButton(busy)}
        >
          Save as Draft
        </button>
        <button type="button" onClick={onClose} disabled={busy} style={formSecondaryButton(busy)}>
          Cancel
        </button>
      </div>

      {isPicking && (
        <LineBatchPicker
          orgId={orgId}
          item={item}
          locationId={locationId}
          locationName={locationName}
          line={line}
          adjusted={adjusted}
          onClose={() => setIsPicking(false)}
          onSave={(next, overwriteAdjusted) => {
            setLine(
              overwriteAdjusted === null
                ? next
                : { ...next, typed: { box: 'adjusted', text: String(overwriteAdjusted) } },
            );
            setIsPicking(false);
          }}
        />
      )}
    </div>
  );
}
