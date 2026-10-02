import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { Plus, Trash2, X } from 'lucide-react';
import { Select } from '../../../components/ui/Select';
import { DateInput } from '../../../components/ui/DateInput';
import { InfoTip } from '../../../components/ui/InfoTip';
import { RadioGroup } from '../../../components/ui/RadioGroup';
import { ItemComboBox } from '../../../components/ui/ItemComboBox';
import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { useTrackingLabel } from '../../../hooks/useTrackingLabel';
import {
  fetchLocations,
  isOwnLocation,
  type Location,
} from '../../configuration/locations/locations.api';
import type { Item } from '../../items/items.schemas';
import { fetchStockLocations } from '../../jobwork/batches/batches.api';
import { formatQty } from '../../jobwork/jobwork.schemas';
import {
  createAdjustment,
  fetchAdjustment,
  fetchCurrentValues,
  updateAdjustment,
} from './adjustments.api';
import {
  ADJUSTMENT_TYPE_OPTIONS,
  isUnposted,
  reasonOptionsFor,
  type AdjustmentType,
  type SaveAdjustmentPayload,
  type StockAdjustmentDetail,
} from './adjustments.schemas';
import {
  QTY_EPSILON,
  adjustedOf,
  batchSummary,
  boxTexts,
  emptyLine,
  fromSavedLine,
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
import { FifoCostField } from './FifoCostField';
import { ValueCells } from './ValueAdjustmentCells';

interface Row {
  key: string;
  item: AdjustableItem | null;
  line: LineDraft;
}

const blankRow = (): Row => ({ key: crypto.randomUUID(), item: null, line: emptyLine() });

const fieldLabel: React.CSSProperties = { fontSize: 13, color: '#334155' };
const requiredLabel: React.CSSProperties = { ...fieldLabel, color: '#dc2626' };

const textInput = (hasError = false): React.CSSProperties => ({
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  height: 36,
  padding: '0 10px',
  border: `1px solid ${hasError ? '#dc2626' : '#d5dae1'}`,
  borderRadius: 4,
  fontSize: 13,
  color: '#111',
  background: '#fff',
});

const th: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  textAlign: 'right',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid #eef0f3',
};
const td: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #eef0f3',
  verticalAlign: 'top',
};

/**
 * Inventory → New Adjustment, and the same form for editing one that has not
 * posted. A header and a table of items; every item is one line of ONE
 * adjustment, saved by one request (STOCK_ADJUSTMENT_ROUND2_PLAN.md).
 */
export function AdjustmentFormPage() {
  const { orgId, id } = useParams<{ orgId: string; id?: string }>();
  const navigate = useNavigate();
  const listUrl = `/organizations/${orgId}/inventory/adjustments`;

  const { data: existing, isLoading } = useQuery({
    queryKey: ['stockAdjustment', orgId, id],
    queryFn: () => fetchAdjustment(orgId!, id!),
    enabled: Boolean(orgId && id),
  });

  if (!orgId) return null;
  if (id && isLoading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading…</div>;
  }
  if (id && (!existing || !isUnposted(existing.status))) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
        {existing
          ? `${existing.adjustmentNumber} can no longer be edited.`
          : 'Adjustment not found.'}{' '}
        <button
          type="button"
          onClick={() => navigate(listUrl)}
          style={{
            border: 'none',
            background: 'none',
            color: '#2563eb',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Back to adjustments
        </button>
      </div>
    );
  }

  // Keyed, so the form's state is seeded once from the adjustment it opened on.
  return <AdjustmentForm key={existing?.id ?? 'new'} orgId={orgId} existing={existing ?? null} />;
}

function AdjustmentForm({
  orgId,
  existing,
}: {
  orgId: string;
  existing: StockAdjustmentDetail | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tracking = useTrackingLabel();
  const listUrl = `/organizations/${orgId}/inventory/adjustments`;
  const leave = (adjustmentId?: string) =>
    navigate(adjustmentId ? `${listUrl}?id=${adjustmentId}` : listUrl);

  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>(
    existing?.adjustmentType ?? 'quantity',
  );
  const isValue = adjustmentType === 'value';
  const [adjustmentDate, setAdjustmentDate] = useState(
    (existing?.adjustmentDate ?? new Date().toISOString()).slice(0, 10),
  );
  const [referenceNumber, setReferenceNumber] = useState(existing?.referenceNumber ?? '');
  const [reason, setReason] = useState(existing?.reason ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [chosenLocationId, setChosenLocationId] = useState<string | null>(
    existing?.locationId ?? null,
  );
  const [rows, setRows] = useState<Row[]>(() =>
    existing?.lines.length
      ? existing.lines.map((saved) => ({
          key: crypto.randomUUID(),
          item: saved.item,
          line: fromSavedLine(saved),
        }))
      : [blankRow()],
  );
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  /** Header field names, and `<rowKey>:<field>` for a cell of the item table. */
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId),
  });
  // Our own premises only — stock at a job worker is adjusted by closing the challan.
  const ownLocations = useMemo(() => locations.filter(isOwnLocation), [locations]);
  const locationId =
    chosenLocationId ??
    ownLocations.find((location: Location) => location.isPrimary)?.id ??
    (ownLocations.length === 1 ? ownLocations[0]!.id : '');
  const locationName = ownLocations.find((location) => location.id === locationId)?.name ?? null;

  /**
   * What each chosen item has at each location — ONE request for every row, not
   * one per row. Display only: the server re-reads the balance when it posts.
   */
  const itemIds = useMemo(
    () => [...new Set(rows.flatMap((row) => (row.item ? [row.item.id] : [])))].sort(),
    [rows],
  );
  const { data: stock = [] } = useQuery({
    queryKey: ['adjustment-stock', orgId, itemIds],
    queryFn: () => fetchStockLocations(orgId, { itemIds, ownership: 'own' }),
    enabled: itemIds.length > 0,
    placeholderData: (prev) => prev,
  });
  const availableOf = (itemId: string | undefined) => {
    if (!itemId) return 0;
    const here = stock.find((location) => location.id === locationId);
    return Number(here?.items.find((one) => one.itemId === itemId)?.availableQty ?? 0) || 0;
  };

  // A value line's "Current Value": what the stock here is worth, from the cost layers.
  const { data: currentValues = [] } = useQuery({
    queryKey: ['adjustment-values', orgId, locationId, itemIds],
    queryFn: () => fetchCurrentValues(orgId, { locationId, itemIds }),
    enabled: isValue && itemIds.length > 0 && Boolean(locationId),
    // Keep the old figures only while the location is the same — another
    // location's value would turn a typed "New Value" into the wrong change.
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[2] === locationId ? prev : undefined,
  });
  const currentOf = (itemId: string | undefined) => {
    const row = currentValues.find((one) => one.itemId === itemId);
    return { qty: Number(row?.quantity ?? 0), value: Number(row?.value ?? 0) };
  };

  const changeType = (next: AdjustmentType) => {
    if (next === adjustmentType) return;
    setAdjustmentType(next);
    // The two kinds share no reason and no figure; the items stay.
    if (!reasonOptionsFor(next).some((option) => option.value === reason)) setReason('');
    setRows((prev) => prev.map((row) => ({ ...row, line: emptyLine(row.item) })));
    setInvalid(new Set());
  };

  const clear = (...names: string[]) =>
    setInvalid((prev) => {
      const next = new Set(prev);
      for (const name of names) next.delete(name);
      return next.size === prev.size ? prev : next;
    });

  const updateRow = (key: string, change: (row: Row) => Row) =>
    setRows((prev) => prev.map((row) => (row.key === key ? change(row) : row)));

  const mutation = useMutation({
    mutationFn: (payload: SaveAdjustmentPayload) =>
      existing ? updateAdjustment(orgId, existing.id, payload) : createAdjustment(orgId, payload),
    onSuccess: (adjustment) => {
      announceOutcome(adjustment);
      refreshAfterAdjustment(queryClient, itemIds);
      leave(adjustment.id);
    },
    onError: (error) => setInvalid(new Set(reportSaveError(error))),
  });

  const handleSave = (saveAs: 'draft' | 'adjust') => {
    const problems: [string, string][] = [];
    if (!adjustmentDate) problems.push(['adjustmentDate', 'Enter the date.']);
    if (!reason) problems.push(['reason', 'Select a reason.']);
    if (!locationId) problems.push(['locationId', 'Select a location.']);

    // A row nobody filled in is not a line; it is the empty row the form starts with.
    const filled = rows.filter((row) => row.item || row.line.typed.text.trim() !== '');
    if (filled.length === 0) problems.push([`${rows[0]?.key}:item`, 'Add at least one item.']);

    const seen = new Set<string>();
    for (const row of filled) {
      if (!row.item) {
        problems.push([`${row.key}:item`, 'Select an item on every row.']);
        continue;
      }
      if (seen.has(row.item.id)) {
        problems.push([`${row.key}:item`, `${row.item.name} is on this adjustment twice.`]);
        continue;
      }
      seen.add(row.item.id);

      if (isValue) {
        const current = currentOf(row.item.id);
        if (Math.abs(adjustedOf(row.line, current.value)) < 0.005) {
          problems.push([`${row.key}:value`, `${row.item.name}: enter a value to adjust.`]);
        } else if (saveAs === 'adjust') {
          // A draft only needs a figure; Adjust needs one that can post.
          const problem = valueProblem(row.line, row.item, current);
          if (problem) problems.push([`${row.key}:${problem.field}`, problem.message]);
        }
        continue;
      }

      const available = availableOf(row.item.id);
      if (Math.abs(adjustedOf(row.line, available)) < QTY_EPSILON) {
        problems.push([`${row.key}:quantity`, `${row.item.name}: enter a quantity to adjust.`]);
      } else if (saveAs === 'adjust') {
        // A draft may be incomplete; Adjust is where it has to be right.
        const problem = lineProblem(row.line, row.item, available, {
          batches: tracking.plural.toLowerCase(),
        });
        if (problem) problems.push([`${row.key}:${problem.field}`, problem.message]);
      }
    }

    if (problems.length > 0) {
      setInvalid(new Set(problems.map(([name]) => name)));
      toast.error(problems[0]![1]);
      return;
    }

    mutation.mutate({
      adjustmentType,
      locationId,
      adjustmentDate,
      reason,
      referenceNumber: referenceNumber.trim() || null,
      description: description.trim() || null,
      lines: filled.map((row) =>
        isValue
          ? toValueLinePayload(row.line, row.item!, currentOf(row.item!.id).value)
          : toLinePayload(row.line, row.item!, availableOf(row.item!.id)),
      ),
      saveAs,
    });
  };

  const picking = rows.find((row) => row.key === pickingKey);
  const busy = mutation.isPending;
  const headerRow: React.CSSProperties = {
    gridTemplateColumns: 'minmax(0, 200px) minmax(0, 420px)',
    marginBottom: 14,
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#1e293b' }}>
          {existing ? `Edit Adjustment ${existing.adjustmentNumber}` : 'New Adjustment'}
        </h1>
        <button
          type="button"
          onClick={() => leave(existing?.id)}
          aria-label="Close"
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            display: 'flex',
            padding: 4,
            borderRadius: 4,
          }}
        >
          <X size={20} />
        </button>
      </div>

      <div className="page-body">
        <div className="form-field-grid" style={headerRow}>
          <span style={fieldLabel}>Mode of adjustment</span>
          <RadioGroup
            name="adjustment-type"
            value={adjustmentType}
            onChange={changeType}
            options={ADJUSTMENT_TYPE_OPTIONS}
            ariaLabel="Mode of adjustment"
          />
        </div>

        <div className="form-field-grid" style={headerRow}>
          <label htmlFor="adj-reference" style={fieldLabel}>
            Reference Number
          </label>
          <input
            id="adj-reference"
            value={referenceNumber}
            maxLength={100}
            onChange={(event) => setReferenceNumber(event.target.value)}
            style={textInput()}
          />
        </div>

        <div className="form-field-grid" style={headerRow}>
          <label htmlFor="adj-date" style={requiredLabel}>
            Date*
          </label>
          <DateInput
            id="adj-date"
            value={adjustmentDate}
            onChange={(value) => {
              setAdjustmentDate(value);
              clear('adjustmentDate');
            }}
            hasError={invalid.has('adjustmentDate')}
          />
        </div>

        <div className="form-field-grid" style={headerRow}>
          <span style={requiredLabel}>Reason*</span>
          <Select
            value={reason}
            onChange={(value) => {
              setReason(value);
              clear('reason');
            }}
            options={reasonOptionsFor(adjustmentType)}
            placeholder="Select a reason…"
            hasError={invalid.has('reason')}
            ariaLabel="Reason"
          />
        </div>

        <div className="form-field-grid" style={headerRow}>
          <span style={requiredLabel}>Location*</span>
          <Select
            value={locationId}
            onChange={(value) => {
              // Every row's batches belong to the godown they were picked at.
              if (value !== locationId) {
                setRows((prev) => prev.map((row) => ({ ...row, line: withoutBatches(row.line) })));
              }
              setChosenLocationId(value);
              clear('locationId');
            }}
            options={ownLocations.map((location) => ({ value: location.id, label: location.name }))}
            placeholder="Select a location…"
            hasError={invalid.has('locationId')}
            ariaLabel="Location"
          />
        </div>

        <div className="form-field-grid" style={{ ...headerRow, alignItems: 'start' }}>
          <label htmlFor="adj-description" style={fieldLabel}>
            Description
          </label>
          <textarea
            id="adj-description"
            value={description}
            rows={3}
            maxLength={500}
            placeholder="Max. 500 characters"
            onChange={(event) => setDescription(event.target.value)}
            style={{
              ...textInput(),
              height: 'auto',
              padding: '8px 10px',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ marginTop: 24, border: '1px solid #eef0f3', borderRadius: 4 }}>
          <div
            style={{
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 600,
              color: '#1e293b',
              background: '#f8fafc',
              borderBottom: '1px solid #eef0f3',
            }}
          >
            Item Table
          </div>
          <div className="responsive-table-wrapper">
            <table
              style={{ width: '100%', minWidth: isValue ? 860 : 980, borderCollapse: 'collapse' }}
            >
              <thead>
                {isValue ? (
                  <tr>
                    <th style={{ ...th, textAlign: 'left', minWidth: 260 }}>Item Details</th>
                    <th style={th}>Quantity on hand</th>
                    <th style={th}>Current Value</th>
                    <th style={th}>New Value</th>
                    <th style={th}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Adjusted Value
                        <InfoTip label="How a value adjustment works">
                          The change goes onto the newest purchase of this item at this location; no
                          stock moves. Lowering the value is a write-down. Raise it only to correct
                          a cost entered wrong or to undo an earlier write-down. Post the same
                          change in your accounts.
                        </InfoTip>
                      </span>
                    </th>
                    <th style={{ ...th, width: 44 }} aria-label="Remove" />
                  </tr>
                ) : (
                  <tr>
                    <th style={{ ...th, textAlign: 'left', minWidth: 260 }}>Item Details</th>
                    <th style={th}>Quantity Available</th>
                    <th style={th}>New Quantity on hand</th>
                    <th style={th}>Quantity Adjusted</th>
                    <th style={th}>Cost Price</th>
                    <th style={th}>{tracking.plural}</th>
                    <th style={{ ...th, width: 44 }} aria-label="Remove" />
                  </tr>
                )}
              </thead>
              <tbody>
                {rows.map((row) => {
                  const available = availableOf(row.item?.id);
                  const adjusted = adjustedOf(row.line, available);
                  const texts = boxTexts(row.line, available);
                  const picked = batchSummary(row.line, adjusted);
                  const numberCell = (name: string): React.CSSProperties => ({
                    ...textInput(invalid.has(`${row.key}:${name}`)),
                    textAlign: 'right',
                    width: 130,
                  });
                  const itemName = row.item?.name ?? 'this row';
                  return (
                    <tr key={row.key}>
                      <td style={td}>
                        <ItemComboBox
                          orgId={orgId}
                          value={row.item?.id ?? null}
                          initialItem={row.item as Item | null}
                          onChange={(item) => {
                            // A different item is a different line: nothing typed
                            // for the old one carries over.
                            updateRow(row.key, (prev) => ({
                              ...prev,
                              item: item?.id ? { ...item, id: item.id } : null,
                              line: emptyLine(item?.id ? { ...item, id: item.id } : null),
                            }));
                            clear(`${row.key}:item`);
                          }}
                          placeholder="Select an item…"
                          hasError={invalid.has(`${row.key}:item`)}
                          ariaLabel="Item"
                          portal
                        />
                        {row.item?.sku && (
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                            SKU: {row.item.sku}
                          </div>
                        )}
                      </td>
                      {isValue ? (
                        <ValueCells
                          row={row}
                          current={currentOf(row.item?.id)}
                          itemName={itemName}
                          numberCell={numberCell}
                          onType={(box, text, currentValue) => {
                            updateRow(row.key, (prev) => ({
                              ...prev,
                              line: withQuantity(prev.line, box, text, currentValue),
                            }));
                            clear(`${row.key}:value`);
                          }}
                        />
                      ) : (
                        <>
                          <td style={{ ...td, textAlign: 'right' }}>
                            {row.item ? (
                              <>
                                <input
                                  aria-label={`Quantity available, ${itemName}`}
                                  value={formatQty(available)}
                                  disabled
                                  className="locked-value"
                                  style={numberCell('available')}
                                />
                                {uomOf(row.item) && (
                                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                                    {uomOf(row.item)}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span style={{ fontSize: 13, color: '#94a3b8', lineHeight: '36px' }}>
                                -
                              </span>
                            )}
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <input
                              inputMode="decimal"
                              placeholder="0.00"
                              aria-label={`New quantity on hand, ${itemName}`}
                              disabled={!row.item}
                              value={texts.newQty}
                              onChange={(event) => {
                                if (!/^\d*\.?\d{0,4}$/.test(event.target.value)) return;
                                updateRow(row.key, (prev) => ({
                                  ...prev,
                                  line: withQuantity(
                                    prev.line,
                                    'new',
                                    event.target.value,
                                    available,
                                  ),
                                }));
                                clear(`${row.key}:quantity`, `${row.key}:batches`);
                              }}
                              style={numberCell('quantity')}
                            />
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <input
                              inputMode="decimal"
                              placeholder="Eg. +10, -10"
                              aria-label={`Quantity adjusted, ${itemName}`}
                              disabled={!row.item}
                              value={texts.adjusted}
                              onChange={(event) => {
                                // A sign, digits and one point — "+5" and "-15".
                                if (!/^[+-]?\d*\.?\d{0,4}$/.test(event.target.value)) return;
                                updateRow(row.key, (prev) => ({
                                  ...prev,
                                  line: withQuantity(
                                    prev.line,
                                    'adjusted',
                                    event.target.value,
                                    available,
                                  ),
                                }));
                                clear(`${row.key}:quantity`, `${row.key}:batches`);
                              }}
                              style={numberCell('quantity')}
                            />
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            {/* A decrease states no cost — FIFO decides what leaving stock is worth, shown read-only. */}
                            {row.item && adjusted <= -QTY_EPSILON ? (
                              <FifoCostField
                                orgId={orgId}
                                itemId={row.item.id}
                                locationId={locationId}
                                quantity={Math.abs(adjusted)}
                                ariaLabel={`Cost price, ${itemName}`}
                                style={numberCell('costPrice')}
                              />
                            ) : row.item ? (
                              <input
                                type="number"
                                inputMode="decimal"
                                step="any"
                                min={0}
                                aria-label={`Cost price, ${itemName}`}
                                value={row.line.costPrice}
                                onWheel={blurOnWheel}
                                onChange={(event) => {
                                  updateRow(row.key, (prev) => ({
                                    ...prev,
                                    line: { ...prev.line, costPrice: event.target.value },
                                  }));
                                  clear(`${row.key}:costPrice`);
                                }}
                                style={numberCell('costPrice')}
                              />
                            ) : (
                              <span style={{ fontSize: 13, color: '#94a3b8', lineHeight: '36px' }}>
                                -
                              </span>
                            )}
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            {row.item &&
                            isBatchTracked(row.item) &&
                            Math.abs(adjusted) >= QTY_EPSILON ? (
                              <button
                                type="button"
                                disabled={!locationId}
                                onClick={() => {
                                  setPickingKey(row.key);
                                  clear(`${row.key}:batches`);
                                }}
                                style={{
                                  minHeight: 36,
                                  padding: '0 10px',
                                  background: 'none',
                                  border: 'none',
                                  borderRadius: 4,
                                  color: invalid.has(`${row.key}:batches`) ? '#dc2626' : '#2563eb',
                                  fontSize: 13,
                                  whiteSpace: 'nowrap',
                                  cursor: locationId ? 'pointer' : 'not-allowed',
                                }}
                              >
                                {picked.count > 0
                                  ? `${picked.count} · ${formatQty(picked.total)}`
                                  : `${adjusted > 0 ? 'Add' : 'Select'} ${tracking.plural}`}
                              </button>
                            ) : (
                              <span style={{ fontSize: 13, color: '#94a3b8', lineHeight: '36px' }}>
                                -
                              </span>
                            )}
                          </td>
                        </>
                      )}
                      <td style={{ ...td, textAlign: 'center' }}>
                        <button
                          type="button"
                          aria-label={`Remove ${itemName}`}
                          onClick={() =>
                            setRows((prev) =>
                              prev.length === 1
                                ? [blankRow()]
                                : prev.filter((one) => one.key !== row.key),
                            )
                          }
                          style={{
                            width: 36,
                            height: 36,
                            border: 'none',
                            background: 'none',
                            color: '#dc2626',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 12px' }}>
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, blankRow()])}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 36,
                padding: '0 12px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 4,
                color: '#2563eb',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <Plus size={14} /> Add another item
            </button>
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
        <button
          type="button"
          onClick={() => leave(existing?.id)}
          disabled={busy}
          style={formSecondaryButton(busy)}
        >
          Cancel
        </button>
      </div>

      {picking?.item && (
        <LineBatchPicker
          key={picking.key}
          orgId={orgId}
          item={picking.item}
          locationId={locationId}
          locationName={locationName}
          line={picking.line}
          adjusted={adjustedOf(picking.line, availableOf(picking.item.id))}
          onClose={() => setPickingKey(null)}
          onSave={(next, overwriteAdjusted) => {
            updateRow(picking.key, (prev) => ({
              ...prev,
              line:
                overwriteAdjusted === null
                  ? next
                  : { ...next, typed: { box: 'adjusted', text: String(overwriteAdjusted) } },
            }));
            setPickingKey(null);
          }}
        />
      )}
    </div>
  );
}
