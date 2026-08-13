import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { CustomFieldsSection } from '../../custom-fields/CustomFieldsSection';
import type { CustomFieldValues } from '../../custom-fields/customFields.schemas';
import { fetchLocations } from '../../configuration/locations/locations.api';
import { itemsApi } from '../../items/items.api';
import { RESPONSIBILITY_OPTIONS, formatQty, toNumber } from '../jobwork.schemas';
import { fetchRejectionReasons } from '../rejection-reasons/rejectionReasons.api';
import type { JobOrder, OverviewStep } from '../job-orders/jobOrders.schemas';
import { createJobReceipt, fetchReceivePrefill } from './jobReceipts.api';
import type { JobReceiptLineData } from './jobReceipts.schemas';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  jobOrder: JobOrder;
  step: OverviewStep;
  onReceived: () => void;
}

/**
 * 🔴 ONE CONSUMED ROW — what this receipt accounts for on the INPUT side.
 *
 * One row per ITEM: "how much of the fabric, how much of the thread". Grouped per
 * item rather than one total, or the allocation would settle a panel receipt by
 * eating the thread, which is simply older.
 *
 * ⚠️ There was a second shape, unit_wise, with one row per taka and a 1:1 mapping
 * back to the roll that went out. It went with package-level tracking on
 * 2026-08-12 — goods come back as a quantity against the batch.
 */
interface Row {
  key: string;
  jobIssueId: string | null;
  jobIssueLineId: string | null;
  itemId: string | null;
  itemName: string;
  unit: string;
  label: string;
  issuedQty: number;
  receivedQty: number;
  acceptedQty: number;
  reworkQty: number;
  scrapQty: number;
  returnedQty: number;
  reasonId: string | null;
  responsibility: string | null;
}

/**
 * 🔴 ONE RETURNED ROW — what came back, per item (§5.7).
 *
 * As many as actually came back: cutting returns panels AND offcuts AND waste,
 * stitching returns shirts AND rejects. The list has nothing to do with the
 * consumed list in length or in unit, so it is typed independently.
 */
interface ReturnedRow {
  key: string;
  itemId: string;
  receivedQty: number;
  acceptedQty: number;
  reworkQty: number;
  scrapQty: number;
  returnedQty: number;
  /** By-products only. The FIRST row takes whatever is left of the pot. */
  valueShare: number | null;
  reasonId: string | null;
  responsibility: string | null;
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#64748b',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  minHeight: 32,
};

const readOnlyStyle: React.CSSProperties = {
  ...inputStyle,
  background: '#f8fafc',
  color: '#64748b',
};

const th: React.CSSProperties = {
  padding: '8px 8px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = { padding: '6px 8px', fontSize: 13, color: '#333' };

const numberCell: React.CSSProperties = {
  width: 88,
  padding: '4px 6px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  minHeight: 28,
};

const sectionHeading: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#111',
  margin: '0 0 10px 0',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

/**
 * The Receive dialog — the second genuinely new screen (§9).
 *
 * TWO THINGS IT DOES THAT ARE NOT OBVIOUS FROM LOOKING AT IT
 *
 * 1. 🔴 THE ROWS ARE GENERATED, NOT ENTERED. They come from what is still out
 *    against the selected challans (§6.2). Re-keying quantities that are already
 *    on the challan is how the two lists stop matching.
 *
 * 2. 🔴 THE SPLIT MUST ADD UP. Accepted + rework + scrap + returned has to equal
 *    received on every row, and the dialog will not save otherwise. That one rule
 *    is what makes a separate "Rejection Note" document unnecessary (§6.4).
 */
export function ReceiveDialog({ isOpen, onClose, jobOrder, step, onReceived }: Props) {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  /**
   * `null` means "everything that is open" — every challan pre-ticked, which is
   * the normal case. Storing the default as null rather than seeding an array in
   * an effect is what lets the prefill arrive without a second render, and what
   * stops a re-fetch from silently re-ticking something the user un-ticked.
   */
  const [pickedIssueIds, setPickedIssueIds] = useState<string[] | null>(null);
  /**
   * 🔴 EDITS ONLY, keyed by row. The rows themselves are DERIVED from the
   * prefill and the ticked challans (see `rows` below) — they are generated, not
   * entered (§6.2), so holding them in state means holding a copy that has to be
   * re-synced every time the selection changes. That sync was an effect, and the
   * effect was the bug: un-ticking a challan left its typed quantities behind in
   * a row that no longer existed.
   */
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  /** `null` until somebody touches the returned grid, so a late prefill cannot
   * wipe typed rows and re-seeding cannot fight the user. */
  const [returnedEdits, setReturnedEdits] = useState<ReturnedRow[] | null>(null);
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [locationId, setLocationId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [customFields, setCustomFields] = useState<CustomFieldValues>({});
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const { data: prefill, isLoading } = useQuery({
    queryKey: ['receive-prefill', orgId, step.id],
    queryFn: () => fetchReceivePrefill(orgId!, step.id),
    enabled: isOpen && Boolean(orgId),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: isOpen && Boolean(orgId),
  });
  const godowns = locations.filter((l) => l.type !== 'processor' && l.type !== 'in_transit');

  const { data: itemsPage } = useQuery({
    queryKey: ['items', orgId, 'receive'],
    queryFn: () => itemsApi.getItems(orgId!, { perPage: 500 }),
    enabled: isOpen && Boolean(orgId),
  });
  const items = itemsPage?.results ?? [];

  const { data: reasonsPage } = useQuery({
    queryKey: ['rejection-reasons', orgId],
    queryFn: () => fetchRejectionReasons(orgId!, { perPage: 200 }),
    enabled: isOpen && Boolean(orgId),
  });
  const reasons = reasonsPage?.results ?? [];

  /* Both units come off the step's two LISTS — primary output and principal
     input. The scalars that mirrored them went with Migration B (2026-08-12). */
  const plannedPrimaryOut =
    prefill?.step.outputs.find((row) => row.isPrimary) ?? prefill?.step.outputs[0];
  const outUnit = plannedPrimaryOut?.uom?.symbol ?? plannedPrimaryOut?.uom?.unitName ?? '';
  const inUom = step.inputs[0]?.uom;
  const inUnit = inUom?.symbol ?? inUom?.unitName ?? '';

  // Every open challan is ticked until the user says otherwise.
  const selectedIssueIds = pickedIssueIds ?? (prefill?.issues ?? []).map((i) => i.id);
  const effectiveLocationId = locationId || (godowns[0]?.id ?? '');
  const itemName = (itemId: string) => items.find((i) => i.id === itemId)?.name ?? 'the item';

  /**
   * The grid, derived from what is still out plus whatever has been typed over
   * it. Everything starts pre-filled as "all of it came back good", so the
   * common case takes no typing at all.
   */
  const rows: Row[] = useMemo(() => {
    if (!prefill) return [];
    const open = prefill.lines.filter((line) => selectedIssueIds.includes(line.jobIssueId));

    // 🔴 One row per ITEM. A single "Total" row across fabric, thread and
    // buttons is a number in no unit at all, and the server refuses a bulk
    // line that does not say which item it accounts for.
    const byItem = new Map<string, Row>();
    for (const line of open) {
      const itemId = line.itemId ?? 'unknown';
      const existing = byItem.get(itemId);
      if (existing) {
        existing.issuedQty += toNumber(line.issuedQty);
        continue;
      }
      byItem.set(itemId, {
        key: `bulk:${itemId}`,
        jobIssueId: null,
        jobIssueLineId: null,
        itemId: line.itemId,
        itemName: line.itemName ?? 'Item',
        unit: line.uomSymbol ?? '',
        label: line.itemName ?? 'Item',
        issuedQty: toNumber(line.issuedQty),
        receivedQty: 0,
        acceptedQty: 0,
        reworkQty: 0,
        scrapQty: 0,
        returnedQty: 0,
        reasonId: null,
        responsibility: null,
      });
    }
    const base: Row[] = [...byItem.values()];

    // Edits for rows that no longer exist are simply never read — un-ticking a
    // challan cannot leave its quantities behind in the totals.
    return base.map((row) => ({ ...row, ...edits[row.key] }));
  }, [prefill, selectedIssueIds, edits]);

  /**
   * 🔴 WHAT CAME BACK, as many items as actually came back (§5.7).
   *
   * Seeded from what the step planned to produce, with NO quantities — what came
   * back is measured at the gate, and pre-filling the expectation is how an
   * expectation gets recorded as a measurement (§6.3). `null` means "not touched
   * yet", so a prefill arriving late cannot wipe what somebody has typed.
   */
  const returnedRows: ReturnedRow[] = useMemo(() => {
    if (returnedEdits) return returnedEdits;
    if (!prefill) return [];
    const planned = prefill.outputs.length
      ? // 🔴 The step's own main output leads the list, because the FIRST row is
        // what carries the cost (see the note on the Value column). Left in seq
        // order, a step whose main output happened to be typed second would put
        // the cost on a by-product.
        [...prefill.outputs].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      : [];
    return planned.map((output) => ({
      key: output.itemId,
      itemId: output.itemId,
      receivedQty: 0,
      acceptedQty: 0,
      reworkQty: 0,
      scrapQty: 0,
      returnedQty: 0,
      valueShare: null,
      reasonId: null,
      responsibility: null,
    }));
  }, [returnedEdits, prefill]);

  // What came back is typed on the returned rows, full stop. Under unit_wise the
  // first returned row used to be DERIVED from the consumed rows' per-taka split;
  // with packages gone there is no per-taka split to derive it from.
  const effectiveReturned: ReturnedRow[] = returnedRows;

  const totals = useMemo(
    () => ({
      issued: rows.reduce((sum, row) => sum + row.issuedQty, 0),
      received: effectiveReturned.reduce((sum, row) => sum + row.receivedQty, 0),
      accepted: effectiveReturned.reduce((sum, row) => sum + row.acceptedQty, 0),
      rework: effectiveReturned.reduce((sum, row) => sum + row.reworkQty, 0),
      scrap: effectiveReturned.reduce((sum, row) => sum + row.scrapQty, 0),
      returned: effectiveReturned.reduce((sum, row) => sum + row.returnedQty, 0),
    }),
    [rows, effectiveReturned],
  );

  /** Returned rows whose split does not add up. The save is blocked while any
   * exist — that one rule is what makes a separate rejection note unnecessary. */
  const brokenRows = effectiveReturned.filter(
    (row) => Math.abs(row.acceptedQty + row.reworkQty + row.scrapQty - row.receivedQty) > 0.00005,
  );

  /** What this receipt consumes, per item — for the preview, which must say what
   * will be written rather than one cross-unit total. */
  const consumedByItem = useMemo(() => {
    const byItem = new Map<string, { itemId: string; name: string; unit: string; qty: number }>();
    for (const row of rows) {
      const key = row.itemId ?? 'unknown';
      const existing = byItem.get(key);
      if (existing) {
        existing.qty += row.issuedQty;
        continue;
      }
      byItem.set(key, {
        itemId: key,
        name: row.itemName || step.inputs[0]?.item?.name || 'the input item',
        unit: row.unit || inUnit,
        qty: row.issuedQty,
      });
    }
    return [...byItem.values()];
  }, [rows, step, inUnit]);

  const actualYield = totals.issued > 0 ? totals.received / totals.issued : null;
  const expectedYield =
    prefill?.step.expectedYield === null || prefill?.step.expectedYield === undefined
      ? null
      : toNumber(prefill.step.expectedYield);

  const update = (key: string, patch: Partial<Row>) => {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const mutation = useMutation({
    mutationFn: () => {
      /**
       * Two independent lists (§5.7): what this receipt consumes, and what came
       * back. The consumed rows carry NO disposition — the returned grid is the
       * only place that is said.
       */
      const lines: JobReceiptLineData[] = rows.map((row) => ({
        itemId: row.itemId,
        jobIssueId: row.jobIssueId,
        jobIssueLineId: row.jobIssueLineId,
        issuedQty: row.issuedQty,
        receivedQty: 0,
        acceptedQty: 0,
        reworkQty: 0,
        scrapQty: 0,
        // ⚠️ "Sent back" is not asked for. Goods refused at the gate never
        // entered stock, so nothing was ever posted for them — the box recorded
        // a number no report reads and one more figure to reconcile. What you
        // did not take simply stays outstanding on the challan, which is the
        // more honest position: the material is still at the processor.
        returnedQty: 0,
        reasonId: row.reasonId,
        responsibility: row.responsibility,
      }));
      return createJobReceipt(orgId!, {
        jobOrderStepId: step.id,
        receiptDate: receiptDate || undefined,
        issueIds: selectedIssueIds,
        locationId: effectiveLocationId,
        lines,
        outputs: effectiveReturned
          .filter((row) => row.itemId)
          .map((row, index) => ({
            itemId: row.itemId,
            receivedQty: row.receivedQty,
            acceptedQty: row.acceptedQty,
            reworkQty: row.reworkQty,
            scrapQty: row.scrapQty,
            returnedQty: 0,
            // 🔴 Position, not a control. The first returned item carries the
            // cost of the operation; every other row takes the value typed for
            // it (§9.2.1). A radio asking which was which decided nothing in the
            // common case — one item back — and was one more thing to get wrong
            // in the uncommon one.
            isPrimary: index === 0,
            /**
             * ⚠️ Not asked for any more — every by-product is recorded at ZERO
             * and the first row absorbs the whole pot.
             *
             * That is the domain's own default and the honest one (§9.2.1):
             * offcuts carry no cost until somebody sells them, and the surviving
             * product should carry the cost of the whole operation. A box for it
             * only earns its place once by-products are actually being sold.
             */
            valueShare: index === 0 ? null : 0,
            reasonId: row.reasonId,
            responsibility: row.responsibility,
          })),
        remarks: remarks.trim() || null,
        customFields,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, jobOrder.id] });
      queryClient.invalidateQueries({ queryKey: ['job-receipts', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-issues', orgId] });
      queryClient.invalidateQueries({ queryKey: ['available-batches', orgId] });
      onReceived();
      onClose();
    },
    onError: (err: AxiosError<{ message?: string }>) => {
      setError(err.response?.data?.message ?? 'Could not post this receipt');
    },
  });

  const canSave =
    rows.length > 0 &&
    selectedIssueIds.length > 0 &&
    /**
     * 🔴 The EFFECTIVE location, not the raw state.
     *
     * The dropdown auto-selects the first godown and displays it, but
     * `locationId` stays empty until somebody actively picks — so Preview sat
     * disabled beside a field that plainly showed a location, with nothing on
     * screen to say what was missing. Checking what is displayed is the whole
     * point of deriving it.
     */
    Boolean(effectiveLocationId) &&
    brokenRows.length === 0 &&
    effectiveReturned.every((row) => Boolean(row.itemId)) &&
    totals.received > 0 &&
    totals.issued > 0 &&
    !mutation.isPending;

  const updateReturned = (key: string, patch: Partial<ReturnedRow>) =>
    setReturnedEdits(returnedRows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Receive goods — step ${step.seq}, ${step.processNameSnapshot}`}
      width={1100}
      footer={
        <>
          {showPreview ? (
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={!canSave}
              style={{
                padding: '6px 20px',
                background: canSave ? '#186337' : '#f1f5f9',
                color: canSave ? '#fff' : '#94a3b8',
                border: 'none',
                borderRadius: 4,
                cursor: canSave ? 'pointer' : 'not-allowed',
                fontWeight: 500,
                fontSize: 13,
              }}
            >
              {mutation.isPending ? 'Posting…' : 'Confirm & post'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              disabled={!canSave}
              style={{
                padding: '6px 20px',
                background: canSave ? '#0062ff' : '#f1f5f9',
                color: canSave ? '#fff' : '#94a3b8',
                border: 'none',
                borderRadius: 4,
                cursor: canSave ? 'pointer' : 'not-allowed',
                fontWeight: 500,
                fontSize: 13,
              }}
            >
              Preview
            </button>
          )}
          <button
            type="button"
            onClick={showPreview ? () => setShowPreview(false) : onClose}
            style={{
              padding: '6px 20px',
              background: '#fff',
              color: '#333',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: 13,
            }}
          >
            {showPreview ? 'Back' : 'Cancel'}
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
            {formatQty(totals.received)} {outUnit} received · {formatQty(totals.accepted)} accepted
          </span>
        </>
      }
    >
      {isLoading && (
        <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          Loading what is still out…
        </div>
      )}

      {error && (
        <p
          style={{
            fontSize: 13,
            color: '#b91c1c',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 4,
            padding: '8px 12px',
            margin: '0 0 16px 0',
          }}
          role="alert"
        >
          {error}
        </p>
      )}

      {prefill && showPreview ? (
        /**
         * 🔴 PREVIEW BEFORE POST (§6.5). Entirely computed — nothing is written
         * until Confirm. A ledger posting cannot be undone by editing, only by a
         * reversing entry, so the consequence is stated in advance.
         */
        <div>
          <h3 style={sectionHeading}>This is what will be posted</h3>
          <ul
            style={{ fontSize: 13, color: '#334155', lineHeight: 1.9, paddingLeft: 18, margin: 0 }}
          >
            {/* Item by item, in each item's own unit — the whole point of the
                preview is that it says exactly what will be written. */}
            {consumedByItem.map((row) => (
              <li key={row.itemId}>
                <strong>
                  {formatQty(row.qty)} {row.unit}
                </strong>{' '}
                of {row.name} is consumed at {step.processorNameSnapshot ?? 'the processor'}.
              </li>
            ))}
            {effectiveReturned
              .map((row, index) => ({ row, isMain: index === 0 }))
              .filter(({ row }) => row.acceptedQty > 0 && row.itemId)
              .map(({ row, isMain }) => (
                <li key={`acc-${row.key}`}>
                  A new batch of{' '}
                  <strong>
                    {formatQty(row.acceptedQty)} {itemName(row.itemId)}
                  </strong>{' '}
                  is created at{' '}
                  {godowns.find((l) => l.id === locationId)?.name ?? 'the selected location'},
                  tracing back to every batch that was consumed
                  {isMain ? ', carrying the cost of the operation' : ''}.
                </li>
              ))}
            {effectiveReturned
              .filter((row) => row.reworkQty > 0 && row.itemId)
              .map((row) => (
                <li key={`rw-${row.key}`}>
                  A <strong>separate</strong> rework batch of {formatQty(row.reworkQty)}{' '}
                  {itemName(row.itemId)} is created — kept apart so the reworked pieces stay
                  countable, and re-issued against this same step.
                </li>
              ))}
            {totals.scrap > 0 && (
              <li>
                {formatQty(totals.scrap)} is scrapped. No batch is created: its cost stays absorbed
                in the good pieces, which is what makes their cost honest.
              </li>
            )}
            <li>
              {selectedIssueIds.length} challan{selectedIssueIds.length === 1 ? '' : 's'} closed or
              partly closed, and the step status recomputed.
            </li>
          </ul>
        </div>
      ) : (
        prefill && (
          <>
            <section style={{ marginBottom: 20 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 14,
                }}
              >
                <div>
                  <label style={labelStyle} htmlFor="receipt-date">
                    Date
                  </label>
                  <input
                    id="receipt-date"
                    type="date"
                    value={receiptDate}
                    onChange={(e) => setReceiptDate(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Received into</label>
                  <Select
                    value={effectiveLocationId}
                    onChange={setLocationId}
                    options={godowns.map((l) => ({ value: l.id, label: l.name }))}
                    ariaLabel="Received into location"
                    fullWidth
                  />
                </div>

                {/* No single "Output item" here any more — a step can return
                    any number of items, and they are listed in the Returned
                    grid below with their own quantities (§5.7). */}
                <div>
                  <label style={labelStyle} htmlFor="receive-processor">
                    From
                  </label>
                  <input
                    id="receive-processor"
                    type="text"
                    value={step.processorNameSnapshot ?? step.workCentre?.name ?? '—'}
                    readOnly
                    style={readOnlyStyle}
                  />
                </div>
              </div>
            </section>

            <section style={{ marginBottom: 20 }}>
              <h3 style={sectionHeading}>Challans being closed</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {prefill.issues.length === 0 && (
                  <span style={{ fontSize: 13, color: '#64748b' }}>
                    Nothing is currently out against this step.
                  </span>
                )}
                {prefill.issues.map((issue) => (
                  <label
                    key={issue.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      padding: '6px 10px',
                      border: '1px solid #e2e8f0',
                      borderRadius: 4,
                      fontSize: 13,
                      color: '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIssueIds.includes(issue.id)}
                      onChange={(e) =>
                        // The first tick materialises the "all open" default
                        // into a real list, and every one after edits it.
                        setPickedIssueIds(
                          e.target.checked
                            ? [...selectedIssueIds, issue.id]
                            : selectedIssueIds.filter((id) => id !== issue.id),
                        )
                      }
                    />
                    {issue.challanNumber}
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {formatQty(issue.totalQty)} {inUnit}
                      {issue.isRework ? ` · rework #${issue.attemptNo}` : ''}
                    </span>
                  </label>
                ))}
              </div>
            </section>

            {/*
              🔴 RETURNED — as many items as actually came back (§5.7).
              Cutting returns panels AND offcuts AND waste; stitching returns
              shirts AND rejects. This list has nothing to do with the consumed
              list in length or in unit, which is why it is typed separately.
            */}
            <section style={{ marginBottom: 20 }}>
              <h3 style={sectionHeading}>What came back</h3>
              <div style={{ overflowX: 'auto', border: '1px solid #eef0f3', borderRadius: 4 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
                      <th style={th} scope="col">
                        Item
                      </th>
                      <th style={th} scope="col">
                        Received
                      </th>
                      <th style={th} scope="col">
                        Good
                      </th>
                      <th style={th} scope="col">
                        Rework
                      </th>
                      <th style={th} scope="col">
                        Scrap
                      </th>
                      {/* 🔴 The disposition lives on THIS grid since 2026-08-12. It used
                          to sit on the consumed rows, per taka; with packages gone the
                          returned row is the only place that says how much was
                          rejected, so it has to be the place that says why. */}
                      <th style={th} scope="col">
                        Reason
                      </th>
                      <th style={th} scope="col">
                        Whose
                      </th>
                      <th style={th} scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveReturned.map((row) => {
                      const cell = (
                        field: 'receivedQty' | 'acceptedQty' | 'reworkQty' | 'scrapQty',
                        label: string,
                      ) => (
                        <td style={td}>
                          <input
                            type="number"
                            onWheel={blurOnWheel}
                            step="0.0001"
                            min="0"
                            aria-label={`${label} for ${row.itemId}`}
                            value={row[field]}
                            onChange={(e) =>
                              updateReturned(row.key, { [field]: Number(e.target.value) || 0 })
                            }
                            style={numberCell}
                          />
                        </td>
                      );
                      return (
                        <tr key={row.key} style={{ borderBottom: '1px solid #f4f5f7' }}>
                          <td style={{ ...td, minWidth: 190 }}>
                            <Select
                              value={row.itemId}
                              onChange={(value) => updateReturned(row.key, { itemId: value })}
                              options={[
                                { value: '', label: 'Select an item…' },
                                ...items.map((i) => ({ value: i.id, label: i.name })),
                              ]}
                              ariaLabel="Returned item"
                              minWidth={0}
                            />
                          </td>
                          {cell('receivedQty', 'Received')}
                          {cell('acceptedQty', 'Good')}
                          {cell('reworkQty', 'Rework')}
                          {cell('scrapQty', 'Scrap')}
                          <td style={{ ...td, minWidth: 170 }}>
                            <Select
                              value={row.reasonId ?? ''}
                              onChange={(value) =>
                                updateReturned(row.key, { reasonId: value || null })
                              }
                              options={[
                                { value: '', label: '—' },
                                ...reasons.map((r) => ({ value: r.id, label: r.name })),
                              ]}
                              ariaLabel="Rejection reason"
                              minWidth={0}
                            />
                          </td>
                          <td style={{ ...td, minWidth: 130 }}>
                            <Select
                              value={row.responsibility ?? ''}
                              onChange={(value) =>
                                updateReturned(row.key, { responsibility: value || null })
                              }
                              options={[{ value: '', label: '—' }, ...RESPONSIBILITY_OPTIONS]}
                              ariaLabel="Who is responsible"
                              minWidth={0}
                            />
                          </td>
                          <td style={td}>
                            <button
                              type="button"
                              onClick={() =>
                                setReturnedEdits(returnedRows.filter((o) => o.key !== row.key))
                              }
                              aria-label="Remove this returned item"
                              style={{
                                border: '1px solid #e2e8f0',
                                borderRadius: 4,
                                background: '#fff',
                                cursor: 'pointer',
                                padding: '2px 8px',
                                color: '#64748b',
                              }}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={() =>
                  setReturnedEdits([
                    ...returnedRows,
                    {
                      key: `new-${returnedRows.length}-${Date.now()}`,
                      itemId: '',
                      receivedQty: 0,
                      acceptedQty: 0,
                      reworkQty: 0,
                      scrapQty: 0,
                      returnedQty: 0,
                      valueShare: null,
                      reasonId: null,
                      responsibility: null,
                    },
                  ])
                }
                style={{
                  marginTop: 10,
                  padding: '5px 12px',
                  fontSize: 13,
                  border: '1px dashed #cbd5e1',
                  borderRadius: 4,
                  background: '#fff',
                  color: '#0062ff',
                  cursor: 'pointer',
                }}
              >
                + Add another item that came back
              </button>

              {brokenRows.length > 0 && (
                <p style={{ fontSize: 12, color: '#b91c1c', margin: '8px 0 0 0' }}>
                  Good + rework + scrap must equal received on every row.
                </p>
              )}
              {/* 🔴 Say what is missing. Preview is disabled until something has
                  actually come back, and a dead button with nothing beside it is
                  how somebody concludes the screen is broken. */}
              {brokenRows.length === 0 && totals.received <= 0 && (
                <p style={{ fontSize: 12, color: '#b45309', margin: '8px 0 0 0' }}>
                  Enter how much came back to continue.
                </p>
              )}
            </section>

            <section style={{ marginBottom: 20 }}>
              <h3 style={sectionHeading}>What this accounts for</h3>

              <div style={{ overflowX: 'auto', border: '1px solid #eef0f3', borderRadius: 4 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
                  <thead>
                    <tr style={{ background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
                      <th style={th} scope="col">
                        Item
                      </th>
                      <th style={th} scope="col">
                        Still out
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const broken = brokenRows.some((r) => r.key === row.key);
                      return (
                        <tr
                          key={row.key}
                          style={{
                            borderBottom: '1px solid #eef0f3',
                            background: broken ? '#fef2f2' : undefined,
                          }}
                        >
                          <td style={{ ...td, fontWeight: 500, color: '#111' }}>{row.label}</td>
                          <td style={td}>
                            {/* Editable: this receipt may close only part of what
                                is still out for this item. */}
                            <input
                              type="number"
                              onWheel={blurOnWheel}
                              step="0.0001"
                              min="0"
                              value={row.issuedQty || ''}
                              onChange={(e) =>
                                update(row.key, { issuedQty: Number(e.target.value) || 0 })
                              }
                              aria-label={`${row.label} quantity accounted for`}
                              style={numberCell}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f9f9fb', fontWeight: 600 }}>
                      <td style={td}>Total</td>
                      <td style={td}>{formatQty(totals.issued)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {brokenRows.length > 0 && (
                <p
                  style={{
                    fontSize: 12,
                    color: '#b91c1c',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: 4,
                    padding: '8px 12px',
                    margin: '10px 0 0 0',
                  }}
                  role="alert"
                >
                  {brokenRows.length} row{brokenRows.length === 1 ? '' : 's'} do not add up.
                  Accepted + rework + scrap + returned must equal what was received — that is what
                  makes a separate rejection note unnecessary.
                </p>
              )}

              {/* Yield strip. 🔴 An OBSERVATION, never a conversion factor — using
                  it as one would invent or destroy stock (§6.3). */}
              <div
                style={{
                  display: 'flex',
                  gap: 20,
                  flexWrap: 'wrap',
                  marginTop: 12,
                  padding: '10px 14px',
                  background: '#f8fafc',
                  borderRadius: 4,
                  fontSize: 12,
                  color: '#475569',
                }}
              >
                <span>
                  Actual yield:{' '}
                  <strong>
                    {actualYield === null ? '—' : actualYield.toFixed(4)}{' '}
                    {outUnit && inUnit ? `${outUnit}/${inUnit}` : ''}
                  </strong>
                </span>
                <span>
                  Expected:{' '}
                  <strong>{expectedYield === null ? '—' : formatQty(expectedYield)}</strong>
                </span>
                {actualYield !== null && expectedYield !== null && expectedYield > 0 && (
                  <span
                    style={{
                      color:
                        Math.abs(actualYield - expectedYield) / expectedYield > 0.05
                          ? '#b45309'
                          : '#475569',
                    }}
                  >
                    Variance:{' '}
                    <strong>
                      {(((actualYield - expectedYield) / expectedYield) * 100).toFixed(2)}%
                    </strong>
                  </span>
                )}
              </div>
            </section>

            <section style={{ marginBottom: 20 }}>
              <label style={labelStyle} htmlFor="receipt-remarks">
                Remarks
              </label>
              <input
                id="receipt-remarks"
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                style={inputStyle}
              />
            </section>

            <section>
              <h3 style={sectionHeading}>Additional fields</h3>
              <CustomFieldsSection
                orgId={orgId!}
                entityType="job_receipt"
                values={customFields}
                onChange={setCustomFields}
                applyDefaults
              />
            </section>
          </>
        )
      )}
    </Modal>
  );
}
