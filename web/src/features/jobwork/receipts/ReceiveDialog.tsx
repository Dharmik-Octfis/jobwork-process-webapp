import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { DateInput } from '../../../components/ui/DateInput';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { fetchLocations } from '../../configuration/locations/locations.api';
import { fetchStockLocations } from '../batches/batches.api';
import { itemsApi } from '../../items/items.api';
import { formatQty, toNumber } from '../jobwork.schemas';
import type { JobOrder, OverviewStep } from '../job-orders/jobOrders.schemas';
import { createJobReceipt, fetchReceiptBatchOptions, fetchReceivePrefill } from './jobReceipts.api';
import type { JobReceiptBatchAllocationData, JobReceiptLineData } from './jobReceipts.schemas';
import { BatchAllocationModal, type BatchAllocation } from './BatchAllocationModal';

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
 * 🔴 ONE RETURNED ROW — one per item the step PLANS to produce (§5.7).
 *
 * As many as the step produces: cutting produces panels AND offcuts AND waste,
 * stitching produces shirts AND rejects. The list has nothing to do with the
 * consumed list in length or in unit, so it is typed independently.
 *
 * 🔴 THE SET IS THE STEP'S PRODUCES LIST, never a free item picker and never
 * what happened to go out on a challan. An item received here that the step was
 * never planned to produce is stock with no plan behind it and a yield measured
 * against something that was never expected — see `returnedRows`.
 */
interface ReturnedRow {
  key: string;
  itemId: string;
  /** From the step's plan — this row's item is fixed and cannot be changed here. */
  itemName: string;
  unit: string;
  receivedQty: number;
  /** Derived: received less rework. Never typed. */
  acceptedQty: number;
  reworkQty: number;
  returnedQty: number;
  /** By-products only. The FIRST row takes whatever is left of the pot. */
  valueShare: number | null;
  /**
   * 🔴 FREE TEXT, not the rejection-reason list (2026-08-21) — it posts as the
   * row's `remarks`.
   *
   * The dropdown was a separate module behind a separate permission that nothing
   * seeds, so on a fresh org it was an empty list beside a rework quantity
   * somebody had to explain, with no way to explain it. And it only appeared once
   * rework was typed, which made the commonest note — something about the
   * delivery itself — impossible to record at all. What the gate has to say is a
   * sentence; a sentence needs a box.
   */
  remarks: string;
  /**
   * 🔴 WHERE THE ACCEPTED GOODS LAND — one entry per batch (2026-08-21).
   *
   * Was a single typed label until a delivery could only ever be one batch. A
   * dyer returning three dye lots in one consignment is three batches, and the
   * second half of a split delivery belongs in the batch the first half made —
   * neither of which one text box can say.
   *
   * Empty is legitimate and means "not allocated yet"; the save is blocked while
   * a batch-tracked item has accepted quantity and no allocation.
   */
  batches: BatchAllocation[];
  /** Rework becomes its own batch, always, so it allocates separately and may
   * never share a batch with the accepted goods. */
  reworkBatches: BatchAllocation[];
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
  // 100%, not a pixel width: the grids are `table-layout: fixed` with columns
  // that add up to 100%, so an input with its own width is the one thing that
  // can still push the table past the dialog and grow a horizontal scrollbar.
  width: '100%',
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
 * 2. 🔴 TWO BOXES, AND THE REST IS ARITHMETIC. The operator types what arrived
 *    and how much of it has to go back for rework; Good is the difference, and
 *    SCRAP IS NOT ASKED FOR AT ALL — process loss is what was sent less what came
 *    back, which the documents already know (see the loss strip below). A typed
 *    scrap box was a third number that could contradict the other two.
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
  /** `null` until somebody touches the returned grid, so a late prefill cannot
   * wipe typed rows and re-seeding cannot fight the user. */
  const [returnedEdits, setReturnedEdits] = useState<ReturnedRow[] | null>(null);
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [locationId, setLocationId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Which returned row's batches are being allocated, and for which side. Null
   * closes the grid — and unmounts it, which is what lets it seed itself once. */
  const [allocating, setAllocating] = useState<{
    key: string;
    kind: 'accepted' | 'rework';
  } | null>(null);
  /** The picker's search box. Server-backed, so it lives out here with the query
   * rather than inside the modal that is remounted per row. */
  const [batchSearch, setBatchSearch] = useState('');
  /**
   * 🔴 Debounced before it reaches the query key, at the same 300ms the issue
   * dialog uses. The term goes into a `contains … insensitive` — an `ILIKE
   * '%…%'` no b-tree can serve — and since 2026-08-22 that query also runs on
   * every plain open of the dropdown, not only once somebody has typed. Keyed on
   * the raw value it was a request per keystroke; `staleTime` does not help,
   * because a term nobody has typed before is never in the cache.
   */
  const [debouncedBatchSearch, setDebouncedBatchSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedBatchSearch(batchSearch), 300);
    return () => clearTimeout(timer);
  }, [batchSearch]);

  const { data: prefill, isLoading } = useQuery({
    queryKey: ['receive-prefill', orgId, step.id],
    queryFn: () => fetchReceivePrefill(orgId!, step.id),
    enabled: isOpen && Boolean(orgId),
  });

  const {
    data: locations = [],
    isLoading: isLoadingLocations,
    error: locationsError,
  } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: isOpen && Boolean(orgId),
  });

  /**
   * 🔴 THE SECOND SOURCE, and the reason there are two.
   *
   * `fetchLocations` is the configuration list and needs `location:read`. The
   * Issue dialog does not depend on it — it reads locations off the LEDGER
   * (`batch:read`, which anybody doing jobwork already holds) and only falls back
   * to the configuration list. So a user with jobwork permissions but not
   * Locations sees godowns on Issue and an empty dropdown here, which is exactly
   * the report that sent us looking.
   *
   * Reading both and taking the union means this dialog can never offer less than
   * the Issue dialog did.
   */
  const stepItemIds = useMemo(
    () => [...new Set(step.inputs.map((row) => row.itemId).filter(Boolean))] as string[],
    [step],
  );
  const { data: stockLocations = [] } = useQuery({
    queryKey: ['stock-locations', orgId, stepItemIds, jobOrder.ownership],
    queryFn: () =>
      fetchStockLocations(orgId!, { itemIds: stepItemIds, ownership: jobOrder.ownership }),
    enabled: isOpen && Boolean(orgId) && stepItemIds.length > 0,
  });

  /**
   * 🔴 Goods come back into a place WE hold, so a processor's own location, the
   * in-transit bucket and a customer's site are all out — receiving into any of
   * them posts the stock as still away from us, and "what is lying with
   * processors" then reads as if the delivery never arrived.
   *
   * Deliberately NOT widened to every location when this comes back empty: the
   * honest answer is to say which of the two reasons it is (see the note under
   * the field) rather than to offer the dyer's own shed as somewhere to receive
   * into.
   */
  const OFF_PREMISES = ['processor', 'in_transit', 'customer_site'];
  const knownLocations = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; type: string }>();
    for (const l of locations) byId.set(l.id, { id: l.id, name: l.name, type: l.type });
    for (const l of stockLocations) {
      if (!byId.has(l.id)) byId.set(l.id, { id: l.id, name: l.name, type: l.type });
    }
    return [...byId.values()];
  }, [locations, stockLocations]);
  const godowns = knownLocations.filter((l) => !OFF_PREMISES.includes(l.type));

  const { data: itemsPage } = useQuery({
    queryKey: ['items', orgId, 'receive'],
    queryFn: () => itemsApi.getItems(orgId!, { perPage: 500 }),
    enabled: isOpen && Boolean(orgId),
  });
  const items = itemsPage?.results ?? [];

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

  /**
   * WHAT IS STILL OUT, per item — the raw figure, before this receipt decides
   * how much of it to account for. `rows` below turns it into a consumption.
   */
  const outstandingRows: Row[] = useMemo(() => {
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
    return [...byItem.values()];
  }, [prefill, selectedIssueIds]);

  /**
   * 🔴 WHAT CAME BACK — the step's Produces list, and nothing else (2026-08-21).
   *
   * Items that were merely SENT to this step used to be offered here too, marked
   * as unplanned. They filled the grid with rows nobody ever typed into on the
   * ordinary step, where everything issued comes back under the output's own
   * name. If something genuinely comes back that the step never planned to
   * produce, the fix is to name it under Produces — which is where the rest of
   * the app already reads the answer from.
   *
   * Rows are seeded with NO quantities: what came back is measured at the gate,
   * and pre-filling the expectation is how an expectation gets recorded as a
   * measurement (§6.3). `null` means "not touched yet", so a prefill arriving
   * late cannot wipe what somebody has typed.
   */
  const returnedRows: ReturnedRow[] = useMemo(() => {
    if (returnedEdits) return returnedEdits;
    if (!prefill) return [];
    // 🔴 The step's own main output leads the list, because the FIRST row is what
    // carries the cost (see the note on the Value column). Left in seq order, a
    // step whose main output happened to be typed second would put the cost on a
    // by-product.
    const planned = [...prefill.outputs].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

    const blank = {
      receivedQty: 0,
      acceptedQty: 0,
      reworkQty: 0,
      returnedQty: 0,
      valueShare: null,
      remarks: '',
      batches: [] as BatchAllocation[],
      reworkBatches: [] as BatchAllocation[],
    };
    return planned.map((output) => ({
      key: output.itemId,
      itemId: output.itemId,
      itemName: output.itemName,
      unit: output.uomSymbol ?? '',
      ...blank,
    }));
  }, [returnedEdits, prefill]);

  // What came back is typed on the returned rows, full stop. Under unit_wise the
  // first returned row used to be DERIVED from the consumed rows' per-taka split;
  // with packages gone there is no per-taka split to derive it from.
  const effectiveReturned: ReturnedRow[] = returnedRows;

  /**
   * 🔴 HOW MUCH OF WHAT WAS SENT THIS RECEIPT ACCOUNTS FOR — derived wherever it
   * can be, asked for only where it cannot.
   *
   * There used to be a whole grid for this. For the ordinary jobwork step it was
   * a grid of numbers the screen already knew: when the item that went out is the
   * item that comes back — washing, dyeing, checking, packing — what this receipt
   * consumes IS what came back, and typing it again is a second chance to get it
   * wrong.
   *
   * 🔴 A receipt settles the challans it names, in full — what was sent and did
   * not come back is process loss (see `lossByItem`). The alternative, leaving
   * the remainder outstanding at the processor, was a checkbox, and on a
   * transforming step it pulled a second grid of quantities onto a dialog that
   * already carries three. Splitting one delivery over two receipts is done by
   * un-ticking the challan that is not settled yet, which the section above
   * already offers.
   */
  const rows: Row[] = outstandingRows;

  const totals = useMemo(
    () => ({
      issued: rows.reduce((sum, row) => sum + row.issuedQty, 0),
      received: effectiveReturned.reduce((sum, row) => sum + row.receivedQty, 0),
      accepted: effectiveReturned.reduce((sum, row) => sum + row.acceptedQty, 0),
      rework: effectiveReturned.reduce((sum, row) => sum + row.reworkQty, 0),
      returned: effectiveReturned.reduce((sum, row) => sum + row.returnedQty, 0),
    }),
    [rows, effectiveReturned],
  );

  const allocatingRow = allocating
    ? (effectiveReturned.find((row) => row.key === allocating.key) ?? null)
    : null;

  /**
   * The batches the open grid may add to.
   *
   * 🔴 Keyed on the ITEM, not the row: the answer is a property of what came
   * back. `orgId` is in the key because switching organisation must never serve
   * the previous tenant's batches, and `batchSearch` because the second group of
   * the answer is search-driven.
   */
  const {
    data: batchPages,
    isLoading: isLoadingBatches,
    fetchNextPage: fetchMoreBatches,
    hasNextPage: hasMoreBatches,
    isFetchingNextPage: isLoadingMoreBatches,
  } = useInfiniteQuery({
    queryKey: [
      'receipt-batch-options',
      orgId,
      step.id,
      allocatingRow?.itemId,
      debouncedBatchSearch,
    ],
    queryFn: ({ pageParam }) =>
      fetchReceiptBatchOptions(orgId!, {
        stepId: step.id,
        itemId: allocatingRow!.itemId,
        search: debouncedBatchSearch || undefined,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.otherNextCursor,
    enabled: Boolean(orgId) && Boolean(allocatingRow?.itemId),
    // A picker, not a report: a few seconds of staleness beats a spinner between
    // every keystroke.
    staleTime: 15_000,
  });

  /* Only page one carries the first group — the server sends `[]` on the rest
     rather than re-costing a balance query for rows already on screen. */
  const jobOrderBatchOptions = batchPages?.pages[0]?.jobOrderBatches ?? [];
  const otherBatchOptions = useMemo(
    () => batchPages?.pages.flatMap((page) => page.otherBatches) ?? [],
    [batchPages],
  );

  /**
   * 🔴 Rows sending back more for rework than came back at all.
   *
   * This used to be "the four boxes do not add up", checked against a Good box
   * the operator typed. Good is DERIVED and scrap is not typed, so the split
   * balances by construction and this is the only way left to break it.
   */
  const brokenRows = effectiveReturned.filter((row) => row.reworkQty - row.receivedQty > 0.00005);

  /**
   * 🔴 A batch-tracked item's new batch must be named here or nowhere. The server
   * refuses it in `createBatch`; this is the same rule on the near side, so the
   * refusal arrives while the box is still on screen rather than at save.
   *
   * Only for `inventoryTracking = 'batch'` — an untracked item's batch is ledger
   * plumbing nobody ever sees, so a label for it would be a question with no
   * purpose. Same line Zoho draws.
   */
  const batchRefRequired = (row: ReturnedRow) =>
    Boolean(row.itemId && items.find((i) => i.id === row.itemId)?.inventoryTracking === 'batch');

  /** What a side's batches add up to. */
  const allocatedQty = (rows: readonly BatchAllocation[]) =>
    rows.reduce((sum, row) => sum + row.qty, 0);

  /**
   * 🔴 A SIDE IS DONE WHEN ITS BATCHES ADD UP TO ITS QUANTITY, not when a box has
   * text in it.
   *
   * Under-allocating posts less stock than the receipt claims came back;
   * over-allocating posts stock nobody received. Neither is recoverable from the
   * document afterwards, because the ledger would be right about itself and wrong
   * about the paperwork. The server enforces the same rule — this is the near
   * side of it, so the refusal arrives while the grid is still on screen.
   *
   * An untracked item is exempt: its batches are ledger plumbing nobody sees, so
   * the server creates one silently and there is no question to ask. Same line
   * Zoho draws.
   */
  const sideIncomplete = (qty: number, rows: readonly BatchAllocation[]) =>
    qty > 0 && Math.abs(allocatedQty(rows) - qty) > 0.00005;

  const unallocatedRows = effectiveReturned.filter(
    (row) =>
      batchRefRequired(row) &&
      (sideIncomplete(row.acceptedQty, row.batches) ||
        sideIncomplete(row.reworkQty, row.reworkBatches)),
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

  /**
   * 🔴 PROCESS LOSS — what was sent, less what came back. Computed, never typed.
   *
   * This is what the Scrap box used to ask for, and the box could contradict it:
   * three numbers where the documents already fix two. A dyer given 500 m who
   * hands back 480 m lost 20 m in the bath, and nobody has to declare that.
   *
   * 🔴 PER ITEM, AND ONLY FOR AN ITEM ON BOTH SIDES. Quantities never subtract
   * across items or units (§6.5) — 500 m of fabric less 300 shirts is a number in
   * no unit at all. So a transforming step shows no loss here, correctly: its
   * yield is the yield strip's job, and the two are not the same question.
   *
   * ⚠️ It is THIS RECEIPT's loss. `rows` carries what is still out and being
   * accounted for now, so a partial receipt reports its own shortfall, and the
   * step's lifetime figure only settles once everything sent has been received.
   */
  const lossByItem = useMemo(() => {
    const receivedByItem = new Map<string, number>();
    for (const row of effectiveReturned) {
      receivedByItem.set(row.itemId, (receivedByItem.get(row.itemId) ?? 0) + row.receivedQty);
    }
    return (
      consumedByItem
        .map((row) => ({
          ...row,
          qty: Number((row.qty - (receivedByItem.get(row.itemId) ?? 0)).toFixed(4)),
        }))
        /* 🔴 A POSITIVE received quantity, not merely a row: a row exists for
           every item sent to the step, sitting at zero until somebody types into
           it, and reading those as loss turns a cutting step's whole fabric
           issue into process loss because none of the fabric "came back". */
        .filter((row) => (receivedByItem.get(row.itemId) ?? 0) > 0 && row.qty > 0.00005)
    );
  }, [consumedByItem, effectiveReturned]);

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
            // 🔴 Always zero. Scrap is not a disposition anyone declares here —
            // it is what was sent less what came back, and the challan and this
            // receipt already say both. A typed box would be a third number free
            // to disagree with the two that are actually measured.
            scrapQty: 0,
            returnedQty: 0,
            /**
             * 🔴 One entry per batch, each either an existing batch to add to or
             * a label to create one under — never both, which the server refuses.
             * Sent only when there is something to send: an untracked item still
             * allocates nothing and the server creates its single silent batch,
             * which is the pre-2026-08-21 path and the reason it still works.
             */
            batches: row.batches.length ? row.batches.map(toBatchPayload) : undefined,
            reworkBatches: row.reworkBatches.length
              ? row.reworkBatches.map(toBatchPayload)
              : undefined,
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
            // The gate's own words. `reasonId` is not sent at all any more — see
            // the note on `ReturnedRow.remarks`.
            remarks: row.remarks.trim() || null,
            // ⚠️ "Whose fault" is not asked for. Nothing read it — no report, no
            // costing, no debit note — so the dialog was asking for a fact that
            // was consumed nowhere. When a debit note exists, it can be asked for
            // then.
            responsibility: null,
          })),
        remarks: remarks.trim() || null,
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
    unallocatedRows.length === 0 &&
    effectiveReturned.every((row) => Boolean(row.itemId)) &&
    totals.received > 0 &&
    totals.issued > 0 &&
    !mutation.isPending;

  const updateReturned = (key: string, patch: Partial<ReturnedRow>) =>
    setReturnedEdits(
      returnedRows.map((row) => {
        if (row.key !== key) return row;
        // The item is fixed by the step, so a row's batches can never be left
        // holding a different item than the one they were picked against.
        const next = { ...row, ...patch };
        /**
         * 🔴 GOOD IS DERIVED, ALWAYS — received less rework.
         *
         * The operator counts what arrived and counts what has to go back; "how
         * many are fine" is arithmetic, and asking for it is asking someone to do
         * a subtraction the screen can do. It was also the whole source of the
         * "these do not add up" error, which is now unreachable.
         */
        next.acceptedQty = Number(Math.max(0, next.receivedQty - next.reworkQty).toFixed(4));
        /**
         * 🔴 A side dropped to zero throws its batches away. The link that opens
         * the grid disappears at zero — so an allocation left behind by an edit
         * would be unreachable AND unremovable, and the save would then fail on a
         * server rule ("no accepted quantity cannot name accepted batches")
         * pointing at a grid the operator cannot open.
         */
        if (next.acceptedQty <= 0) next.batches = [];
        if (next.reworkQty <= 0) next.reworkBatches = [];
        // 🔴 The note is NOT cleared with the rework. It is free text on the row
        // and stays on screen whatever the quantities do, so nothing can be left
        // behind where nobody can reach it — which is why the old reason had to
        // be wiped here.
        return next;
      }),
    );

  /**
   * 🔴 SAVING THE ACCEPTED ALLOCATION CAN SET THE QUANTITY, not only be checked
   * against it.
   *
   * The same contract the issue dialog's Add Batches carries: if nothing has been
   * typed on the row yet, the batches you name ARE how much came back, and
   * Received fills in behind you. If a quantity is already there it wins and the
   * grid has to match it. Without this the link opens on a row reading zero and
   * there is nothing the grid can save.
   *
   * Rework is not in that position and must not be: its link only appears once
   * Rework has been typed, so its target is never zero — and inferring it from
   * the batches would silently move pieces out of the good count the operator
   * just made.
   */
  const saveAllocation = (
    key: string,
    kind: 'accepted' | 'rework',
    allocation: BatchAllocation[],
  ) => {
    if (kind === 'rework') {
      updateReturned(key, { reworkBatches: allocation });
      return;
    }
    const row = effectiveReturned.find((r) => r.key === key);
    if (!row) return;
    const total = Number(allocation.reduce((sum, r) => sum + r.qty, 0).toFixed(4));
    updateReturned(key, {
      batches: allocation,
      ...(row.receivedQty <= 0 && total > 0
        ? { receivedQty: Number((total + row.reworkQty).toFixed(4)) }
        : {}),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Receive goods — step ${step.seq}, ${step.processNameSnapshot}`}
      /* Who it came back from is a FACT, not a field — it is the step's
         processor and nothing on this dialog can change it. It sat in the header
         grid as a read-only box, which reads as an input that has stopped
         working; the issue dialog puts the same kind of context here. */
      subtitle={
        <>
          {jobOrder.jobOrderNumber} · from{' '}
          {step.processorNameSnapshot ?? step.workCentre?.name ?? 'the processor'}
        </>
      }
      width={1100}
      footer={
        <>
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
            {mutation.isPending ? 'Receiving…' : 'Receive goods'}
          </button>
          <button
            type="button"
            onClick={onClose}
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
            Cancel
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

      {prefill && (
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
                  <DateInput
                    id="receipt-date"
                    value={receiptDate}
                    onChange={setReceiptDate}
                    style={inputStyle}
                    portal
                  />
                </div>

                <div>
                  <label style={labelStyle}>Received into</label>
                  <Select
                    value={effectiveLocationId}
                    onChange={setLocationId}
                    options={godowns.map((l) => ({ value: l.id, label: l.name }))}
                    placeholder={isLoadingLocations ? 'Loading…' : 'Select a location…'}
                    disabled={godowns.length === 0}
                    ariaLabel="Received into location"
                    fullWidth
                    portal
                  />
                  {/* 🔴 SAY WHY IT IS EMPTY. A dropdown with nothing in it and no
                      note beside it is indistinguishable from a broken screen, and
                      it blocks the save — so each reason it can be empty is spelled
                      out where the operator is looking, and they are different
                      problems with different fixes. */}
                  {!isLoadingLocations && godowns.length === 0 && (
                    <p style={{ fontSize: 11.5, color: '#b91c1c', margin: '5px 0 0 0' }}>
                      {knownLocations.length > 0
                        ? 'Every location set up is a processor, in-transit or customer site. Goods cannot be received into any of those — add a warehouse under Configuration → Locations.'
                        : locationsError
                          ? 'Locations could not be loaded — this needs the Locations read permission.'
                          : 'No location has been set up yet. Add one under Configuration → Locations.'}
                    </p>
                  )}
                </div>

                {/* No single "Output item" here any more — a step can return
                    any number of items, and they are listed in the Returned
                    grid below with their own quantities (§5.7). No "From"
                    either: it is in the subtitle, where a read-only fact belongs. */}

                {/* Beside the other header facts, exactly where the issue dialog
                    puts it. It is the one free-text note on the document, not a
                    footnote to the grids — sitting under three tables it read as
                    a comment on the last of them. */}
                <div>
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
              🔴 RETURNED — the step's Produces list plus whatever was actually
              sent to this step (§5.7, and see `returnedRows`). Cutting produces
              panels AND offcuts AND waste; stitching produces shirts AND rejects.
              There is no free item picker: every row here is an item this step
              already has a reason to be holding.

              Type what arrived and what is wrong with it; Good is the arithmetic
              and the screen does it.
            */}
            <section style={{ marginBottom: 20 }}>
              <h3 style={sectionHeading}>What came back</h3>
              <p style={{ fontSize: 12, color: '#64748b', margin: '-4px 0 10px 0' }}>
                Type what arrived and what goes back for rework. Everything else is worked out.
              </p>
              <div style={{ border: '1px solid #eef0f3', borderRadius: 4 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  {/* 🔴 Fixed widths that ADD UP TO 100%, so the grid can never be
                      wider than the dialog. Content-sized columns plus a `minWidth`
                      floor is what put a horizontal scrollbar under a dialog that
                      is already 1100px wide. */}
                  <colgroup>
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '21%' }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
                      <th style={th} scope="col">
                        Item
                      </th>
                      <th style={th} scope="col">
                        Received
                      </th>
                      <th style={th} scope="col">
                        Rework
                      </th>
                      <th style={th} scope="col">
                        Good
                      </th>
                      <th style={th} scope="col">
                        Batches
                      </th>
                      {/* 🔴 The disposition lives on THIS grid since 2026-08-12. It used
                          to sit on the consumed rows, per taka; with packages gone the
                          returned row is the only place that says how much was
                          rejected, so it has to be the place that says why. */}
                      <th style={{ ...th, minWidth: 200 }} scope="col">
                        Reason
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveReturned.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          style={{
                            padding: 24,
                            textAlign: 'center',
                            fontSize: 13,
                            color: '#64748b',
                          }}
                        >
                          Nothing has been sent to this step yet, and it lists nothing it produces.
                        </td>
                      </tr>
                    )}
                    {effectiveReturned.map((row) => {
                      const cell = (field: 'receivedQty' | 'reworkQty', label: string) => (
                        <td style={td}>
                          <input
                            type="number"
                            onWheel={blurOnWheel}
                            step="0.0001"
                            min="0"
                            aria-label={`${label} for ${row.itemName}`}
                            value={row[field] || ''}
                            placeholder="0"
                            onChange={(e) =>
                              updateReturned(row.key, { [field]: Number(e.target.value) || 0 })
                            }
                            style={numberCell}
                          />
                        </td>
                      );
                      const tracked = batchRefRequired(row);
                      return (
                        <tr key={row.key} style={{ borderBottom: '1px solid #f4f5f7' }}>
                          {/* 🔴 Read-only. The step says which items come back; see
                              the note on `ReturnedRow`. */}
                          <td style={td}>
                            <div style={{ fontWeight: 600, color: '#111' }}>{row.itemName}</div>
                            <div
                              style={{
                                display: 'flex',
                                gap: 6,
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                marginTop: 3,
                              }}
                            >
                              {row.unit && (
                                <span style={{ fontSize: 11, color: '#94a3b8' }}>{row.unit}</span>
                              )}
                              {tracked && (
                                <span
                                  style={{
                                    padding: '1px 6px',
                                    borderRadius: 9,
                                    fontSize: 10,
                                    fontWeight: 600,
                                    background: '#fef3c7',
                                    color: '#92400e',
                                  }}
                                  title="This item is batch-tracked, so the batches it lands in have to be named."
                                >
                                  Batch required
                                </span>
                              )}
                            </div>
                          </td>
                          {cell('receivedQty', 'Received')}
                          {cell('reworkQty', 'Rework')}
                          {/* 🔴 Derived, not typed — received less rework. Placed
                              AFTER the two boxes it is computed from, so it reads
                              as their answer rather than a third thing to fill. */}
                          <td style={{ ...td, fontWeight: 600, color: '#111' }}>
                            {row.receivedQty > 0 ? formatQty(row.acceptedQty) : '—'}
                          </td>
                          {/* 🔴 WHERE THESE GOODS WILL LIVE. What a processor hands
                              back is physically new and has no number of its own,
                              and `batchNumber` is internal and never shown — so a
                              batch-tracked item with nothing allocated here lands
                              in the next step's picker as a blank row.

                              Two links, because rework becomes its OWN batch and
                              may never share one with the accepted goods. */}
                          <td style={td}>
                            <AllocationButton
                              label="Add Batches"
                              qty={row.acceptedQty}
                              rows={row.batches}
                              tracked={tracked}
                              onClick={() => setAllocating({ key: row.key, kind: 'accepted' })}
                            />
                            {row.reworkQty > 0 && (
                              <div style={{ marginTop: 4 }}>
                                <AllocationButton
                                  label="Add Rework Batches"
                                  qty={row.reworkQty}
                                  rows={row.reworkBatches}
                                  tracked={tracked}
                                  onClick={() => setAllocating({ key: row.key, kind: 'rework' })}
                                />
                              </div>
                            )}
                          </td>
                          {/* 🔴 ALWAYS TYPEABLE, and free text. It used to be a
                              dropdown that appeared only once rework was typed —
                              so a note about the delivery itself had nowhere to
                              go, and on an org with no rejection reasons set up
                              there was nothing to pick even when there was
                              something to explain. */}
                          <td style={td}>
                            <input
                              type="text"
                              aria-label={`Reason for ${row.itemName}`}
                              value={row.remarks}
                              placeholder="Reason"
                              maxLength={2000}
                              onChange={(e) => updateReturned(row.key, { remarks: e.target.value })}
                              style={{ ...numberCell, textAlign: 'left' }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {brokenRows.length > 0 && (
                <p style={{ fontSize: 12, color: '#b91c1c', margin: '8px 0 0 0' }}>
                  Rework cannot be more than what came back.
                </p>
              )}
              {/* Allocated here or nowhere — the batches have no other label, and
                  they are the rows somebody has to find in the next step's picker. */}
              {unallocatedRows.length > 0 && (
                <p style={{ fontSize: 12, color: '#b91c1c', margin: '8px 0 0 0' }}>
                  {unallocatedRows.length === 1
                    ? 'One batch-tracked item still needs its batches named — use Add Batches on that row.'
                    : `${unallocatedRows.length} batch-tracked items still need their batches named — use Add Batches on those rows.`}
                </p>
              )}
            </section>

            {/*
              🔴 WHAT THIS RECEIPT CONSUMES — nothing here asks for it.

              On the ordinary step the item that went out is the item that comes
              back, so the answer IS what came back and a grid for it was a screen
              full of numbers the dialog already had.

              🔴 And the "nothing more is coming back for this step" checkbox went
              with it (2026-08-21). A receipt settles the challans it names in
              full; the shortfall is process loss, which the strip below states as
              a consequence of the two figures above it rather than asking for it
              as a third. A delivery that only settles part of what is out is two
              receipts, each naming its own challan — which the section above
              already offers. The typed consumption grid for a TRANSFORMING step
              only ever appeared behind that checkbox, so it went too.
            */}
            {/* 🔴 PROCESS LOSS ONLY — where the Scrap box went. Stated as a
                consequence of the two typed numbers rather than as a question, so
                it can never disagree with them.

                🔴 Actual yield / Expected / Variance went with the checkbox
                (2026-08-21). They changed no decision at the gate — nobody
                refuses a delivery because the yield is 2% off — and yield is a
                report, measured over a step's whole life, not over the one
                consignment standing in front of the operator. It is on the job
                order overview, where it can be read against every receipt. */}
            {lossByItem.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  gap: 20,
                  flexWrap: 'wrap',
                  marginBottom: 20,
                  padding: '10px 14px',
                  background: '#f8fafc',
                  borderRadius: 4,
                  fontSize: 12,
                  color: '#475569',
                }}
              >
                {lossByItem.map((row) => (
                  <span key={`loss-strip-${row.itemId}`}>
                    Process loss ({row.name}):{' '}
                    <strong style={{ color: '#b45309' }}>
                      {formatQty(row.qty)} {row.unit}
                    </strong>
                  </span>
                ))}
              </div>
            )}

            {/* No "Additional fields" block here. The gate is the wrong place for
                per-org custom fields: this dialog is already two grids deep and
                the operator is standing at a delivery. `job_receipt` keeps its
                `custom_fields` column and its definitions — they belong on the
                receipt's detail screen, not between the goods and the ledger.
                Remarks is a header field and sits with the other header facts. */}
          </>
      )}

      {/**
       * 🔴 Mounted only while open, and KEYED on the row and side. The grid seeds
       * itself from its props once, on mount — the same contract the issue-side
       * grid carries — so a shared instance would show the first row's batches
       * against the second row's item, and saving would then wipe an allocation
       * the user could still see a moment ago.
       */}
      {allocating && allocatingRow && (
        <BatchAllocationModal
          key={`${allocating.key}-${allocating.kind}`}
          isOpen
          onClose={() => {
            setAllocating(null);
            // Both, or the next row opens on the previous row's results for the
            // 300ms it takes the debounce to catch up.
            setBatchSearch('');
            setDebouncedBatchSearch('');
          }}
          kind={allocating.kind}
          itemName={items.find((i) => i.id === allocatingRow.itemId)?.name ?? 'Item'}
          uomLabel={outUnit}
          locationName={godowns.find((l) => l.id === effectiveLocationId)?.name ?? null}
          targetQty={
            allocating.kind === 'accepted' ? allocatingRow.acceptedQty : allocatingRow.reworkQty
          }
          requiresReference={batchRefRequired(allocatingRow)}
          rows={
            allocating.kind === 'accepted' ? allocatingRow.batches : allocatingRow.reworkBatches
          }
          /* Accepted and rework may never land in the same batch — the server
             refuses it, and this is the same rule on the near side. */
          blockedBatchIds={(allocating.kind === 'accepted'
            ? allocatingRow.reworkBatches
            : allocatingRow.batches
          )
            .map((row) => row.batchId)
            .filter((id): id is string => id !== null)}
          options={jobOrderBatchOptions}
          otherOptions={otherBatchOptions}
          hasMore={hasMoreBatches}
          onLoadMore={() => void fetchMoreBatches()}
          isLoadingMore={isLoadingMoreBatches}
          search={batchSearch}
          onSearchChange={setBatchSearch}
          isLoading={isLoadingBatches}
          onSave={(rows) => saveAllocation(allocating.key, allocating.kind, rows)}
        />
      )}
    </Modal>
  );
}

/**
 * 🔴 ONE ALLOCATION ROW, ON THE WIRE. Either an existing batch or a new one,
 * never both — and the five attributes ride ONLY with a new one.
 *
 * The server refuses them beside a `batchId` (a 400, deliberately, not a silent
 * drop): a receipt adds to an existing batch, it never restamps the dates or the
 * prices of one an earlier delivery created and that may already have been issued
 * onward. Sending them anyway would turn a legitimate split delivery into a
 * rejected save.
 *
 * 🔴 An empty box is `null`, NOT zero. The columns are nullable exactly so "no
 * price stated" and "free" can be told apart, and `Number('')` is 0 — so the
 * emptiness is tested before the conversion, never after.
 */
function toBatchPayload(batch: BatchAllocation): JobReceiptBatchAllocationData {
  if (batch.batchId) {
    return { batchId: batch.batchId, batchReference: null, qty: batch.qty };
  }
  const price = (value: string) => (value.trim() === '' ? null : Number(value));
  return {
    batchId: null,
    batchReference: batch.batchReference || null,
    qty: batch.qty,
    manufacturerBatch: batch.manufacturerBatch.trim() || null,
    manufacturedDate: batch.manufacturedDate || null,
    expiryDate: batch.expiryDate || null,
    sellingPrice: price(batch.sellingPrice),
    mrp: price(batch.mrp),
  };
}

/**
 * The link that opens the allocation grid, and says at a glance whether the side
 * is settled.
 *
 * 🔴 Same control, same words as the issue dialog's — "Add Batches" until rows
 * exist, then "N batches". The two dialogs are the same job from opposite ends
 * and an operator does both all day; giving one of them its own vocabulary is how
 * a screen stops being recognisable.
 *
 * 🔴 AND IT IS OFFERED BEFORE A QUANTITY IS TYPED, which is the whole reason the
 * text was never seen: gated on `qty > 0`, every row opened reading "—" and the
 * operator had to guess that a number somewhere else would reveal it. The grid
 * fills the quantity in when the box is still empty (`saveAllocation`), exactly
 * like Add Batches on the issue side.
 *
 * A `<button>`, not a styled div: Tab reaches it, Enter opens it, and `disabled`
 * means something.
 *
 * 🔴 ALWAYS BLUE, like the issue dialog's. It used to turn red on a shortfall,
 * which made the same control read as two different things on two screens an
 * operator does back to back. The shortfall is said in words underneath, where
 * the issue dialog says its own.
 */
function AllocationButton({
  label,
  qty,
  rows,
  tracked,
  onClick,
}: {
  /** The call to action while nothing is allocated — "Add Batches". */
  label: string;
  qty: number;
  rows: readonly BatchAllocation[];
  /** Batch-tracked item. An untracked one's batches are ledger plumbing the
   * server creates silently, so there is nothing to ask and nothing to show. */
  tracked: boolean;
  onClick: () => void;
}) {
  if (!tracked) {
    return (
      <span style={{ fontSize: 12, color: '#94a3b8' }} title="This item is not batch-tracked.">
        Not tracked
      </span>
    );
  }

  const allocated = rows.reduce((sum, row) => sum + row.qty, 0);
  const short = Number((qty - allocated).toFixed(4));

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        aria-label={rows.length > 0 ? `Edit batches — ${rows.length} allocated` : label}
        style={{
          padding: 0,
          border: 'none',
          background: 'none',
          fontSize: 12.5,
          fontWeight: 500,
          textAlign: 'left',
          cursor: 'pointer',
          color: '#0062ff',
        }}
      >
        {rows.length === 0 ? label : `${rows.length} ${rows.length === 1 ? 'batch' : 'batches'}`}
      </button>
      {/* Why this row is holding the receipt up, beside the control that fixes
          it — the same place the issue dialog puts it. Only ever a shortfall:
          over-allocating is refused inside the grid, so it cannot reach here. */}
      {short > 0.00005 && rows.length > 0 && (
        <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 3, lineHeight: 1.4 }}>
          {formatQty(short)} still to allocate
        </div>
      )}
    </>
  );
}
