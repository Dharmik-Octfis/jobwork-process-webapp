import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { DateInput } from '../../../components/ui/DateInput';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { fetchVendors } from '../../purchases/vendors/vendors.api';
import { fetchCustomers } from '../../sales/customers/customers.api';
import { fetchLocations } from '../../configuration/locations/locations.api';
import { fetchAvailableBatches, fetchStockLocations } from '../batches/batches.api';
import { formatQty, toNumber } from '../jobwork.schemas';
import type { JobOrder, OverviewStep } from '../job-orders/jobOrders.schemas';
import { createJobIssue } from './jobIssues.api';
import type { JobIssueLineData } from './jobIssues.schemas';
import { AddBatchesModal } from './AddBatchesModal';
import { rowKey, type BatchSelection } from './batchSelection';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  jobOrder: JobOrder;
  step: OverviewStep;
  onIssued: () => void;
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

const sectionHeading: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#111',
  margin: '0 0 10px 0',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

/** The line-items grid. Fixed columns are the point — see the note above the table. */
const lineTh: React.CSSProperties = {
  padding: '8px 12px',
  fontWeight: 600,
  fontSize: 10.5,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const lineTd: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 13,
  color: '#334155',
  whiteSpace: 'nowrap',
  verticalAlign: 'top',
};

/* The Quantity cell holds a 32px-tall input; every other cell holds a ~19px line box,
   and `verticalAlign: 'top'` lands the two at different heights — the input reads as
   sitting below its own row. So each cell's FIRST line gets the input's height and
   centres in it, giving the row one baseline across all six columns. Anything the
   cell stacks underneath (badges, warnings) still flows below that band. */
const lineCell: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minHeight: 32,
};

const lineCellRight: React.CSSProperties = { ...lineCell, justifyContent: 'flex-end' };

/** How many batches one picker asks for. The server caps at this too; the picker
 * says so when it hits the ceiling rather than showing a slice as if it were all. */
const BATCH_LIMIT = 200;

/** Why the job order's planned batches did not all seed — see `planUnmatched`. */
interface PlanGap {
  /** Planned at THIS location, but drained or already issued since. */
  gone: number;
  /** Planned at a godown this challan does not go out of, counted per godown. */
  elsewhere: { name: string; count: number }[];
}

/**
 * The Issue dialog — one of the two genuinely new screens in this plan (§9).
 *
 * WHAT IS LOCKED HERE AND WHY
 *
 * The job order, the step, the item and the unit are all display-only. They come
 * from the step, and changing any of them would break the chain the job order
 * validated at save — with the failure surfacing days later as an empty picker at
 * the next step, long after anyone connects it to this dialog (§5.1).
 *
 * WHAT THE USER ACTUALLY DECIDES: where it goes out from, who it goes to, which
 * batches, and a free-text remark.
 *
 * ⚠️ Transport (vehicle / LR / e-way bill) and per-org custom fields were both
 * removed on 2026-08-10 — the columns are gone from `job_issues` and `job_issue`
 * is no longer a custom-field module, so there is nowhere left for either to go.
 *
 * The destination is not asked at all. It is the processor's own location, and
 * it is created on first use — making someone set up a location for a dyer
 * before they can send anything to that dyer is a gate with no purpose.
 */
export function IssueDialog({ isOpen, onClose, jobOrder, step, onIssued }: Props) {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  const [sourceLocationId, setSourceLocationId] = useState('');
  const [processorType, setProcessorType] = useState<string>(step.processorType);
  const [processorId, setProcessorId] = useState<string | null>(step.processorId);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  /** 🔴 Keyed by batchId and carrying the batch ROW, not just its id — the picker
   * is a search now and a picked batch can leave the result set (see
   * `BatchSelection`). */
  const [selection, setSelection] = useState<Record<string, BatchSelection>>({});
  /** Quantities typed on an UNTRACKED item's line — no picker, no named batch, the
   * server allocates FIFO out of what the ledger already holds. See `lines`. */
  const [unstocked, setUnstocked] = useState<Record<string, number>>({});
  /**
   * 🔴 What was typed on a BATCH-TRACKED line — the target, not the allocation.
   * `selection` says which batches cover it. The two are separate facts on purpose:
   * the user states how much is going out, then says where it comes from, and Add
   * Batches pre-fills each batch from this. The challan will not save while they
   * disagree — see `unallocated`.
   */
  const [trackedQty, setTrackedQty] = useState<Record<string, number>>({});
  const [searchByItem, setSearchByItem] = useState<Record<string, string>>({});
  const [debouncedSearch, setDebouncedSearch] = useState<Record<string, string>>({});
  /** Which item section opened Add Batches. Null when it is closed. */
  const [addBatchesFor, setAddBatchesFor] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [needsOverride, setNeedsOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * 🔴 A LOCATION CHANGE WITH WORK ON THE SCREEN IS ASKED FIRST, NOT UNDONE
   * AFTER (2026-08-19).
   *
   * Batches are per location, so switching godown invalidates every allocation
   * on the dialog — the server refuses a batch that is not at the header's
   * location, which is the guarantee under this. Applying that silently threw
   * away work the user could still see a moment ago; a confirm costs one click
   * and the alternative — locking the dropdown once a batch is picked — makes
   * them clear every row by hand to correct a wrong first choice.
   *
   * Null when nothing is pending. Holds the location the user is moving TO.
   */
  const [pendingLocationId, setPendingLocationId] = useState<string | null>(null);

  /**
   * 🔴 WHAT THIS CHALLAN COULD NOT CARRY, AFTER IT HAS BEEN RAISED (2026-08-19).
   *
   * One challan goes out of one location, so a step whose items are split across
   * godowns genuinely needs more than one. That is correct, but a user who is not
   * told discovers it by reopening the dialog, re-reading the rows, and working
   * out for themselves which item is still outstanding — three times over, for a
   * step with three godowns.
   *
   * So the dialog does not close on those saves. It says what is left, names the
   * godown holding it, and offers to carry straight on there with the form
   * already cleared for the next document.
   */
  const [continuation, setContinuation] = useState<{
    itemNames: string[];
    locationId: string;
    locationName: string;
  } | null>(null);

  // A query per keystroke would be one round trip per letter of a batch number.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchByItem), 300);
    return () => clearTimeout(timer);
  }, [searchByItem]);

  /**
   * 🔴 ONE SECTION PER INPUT ITEM (domain §5.7). A challan carries fabric, thread
   * and buttons — one physical movement to one processor, so one document — and
   * each of them has its own batches, its own unit and its own picker.
   *
   * The CONSUMES list is the only source. The fallback to the step's scalar item
   * went with Migration B (2026-08-12); a step that lists nothing has nothing to
   * issue, and the dialog says so rather than inventing a row.
   */
  const inputItems = useMemo(
    () =>
      step.inputs.map((row) => ({
        itemId: row.itemId,
        name: row.item?.name ?? 'Item',
        sku: row.item?.sku ?? null,
        uomLabel: row.uom ? (row.uom.symbol ?? row.uom.unitName) : '',
        plannedQty: row.plannedQty === null ? null : toNumber(row.plannedQty),
        fromStock: row.fromStock ?? true,
        /** 🔴 `Item.inventoryTracking = 'batch'` is a promise that every metre is
         * traceable to its roll, and an issue is where that trace is created. The
         * server refuses a batch-less line for such an item; this is the same rule
         * on the near side, so the dialog never offers a path that will be
         * rejected. */
        isBatchTracked: row.item?.inventoryTracking === 'batch',
        /** What the job order PLANNED this row to come out of. A note, not a hold
         * — the stock may well have moved since. See `JobOrderStepInputBatch`. */
        plannedBatches: row.plannedBatches ?? [],
      })),
    [step],
  );

  /** The principal input — what the step is fundamentally about. The tolerance
   * strip is its, because the header figures are in one unit. The LOCATION list
   * is no longer its: see the query below. */
  const principal = inputItems[0] ?? null;
  const uomLabel = principal?.uomLabel ?? '';

  /**
   * 🔴 A ledger query, over EVERY item on this challan (2026-08-19).
   *
   * It used to ask about the principal item alone and then apply that answer to
   * all of them. On a fabric + thread + buttons challan the dropdown listed the
   * godowns holding FABRIC, and if the thread lived elsewhere its picker came
   * back empty with nothing on screen to say why.
   *
   * Each row now carries `items` — which of the asked-for items it holds, and how
   * much — which is what the coverage label, the per-item blocked state and the
   * "it is over at Godown B" line are all read from.
   */
  const inputItemIds = useMemo(() => inputItems.map((input) => input.itemId), [inputItems]);

  const { data: locations = [] } = useQuery({
    queryKey: ['stock-locations', orgId, inputItemIds, jobOrder.ownership],
    queryFn: () =>
      fetchStockLocations(orgId!, { itemIds: inputItemIds, ownership: jobOrder.ownership }),
    enabled: isOpen && Boolean(orgId) && inputItemIds.length > 0,
  });

  /**
   * Auto-selected when only one location qualifies — which is the usual case,
   * and asking a question whose answer never changes is a click for nothing.
   *
   * DERIVED, not synced into state by an effect. An effect that calls setState
   * renders twice and, worse, briefly shows the dialog with no location picked
   * — long enough for the batch query underneath to fire with an empty location
   * and come back with nothing.
   */
  /**
   * ⚠️ TEMPORARY — every godown, for when NO location holds the item.
   *
   * The list above is a ledger query and returns nothing while the ledger is
   * empty, which would leave the challan with nowhere to go out from. Falls back
   * to the plain location list so the flow can be walked before Purchase
   * Received exists.
   */
  const { data: allLocations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: isOpen && Boolean(orgId),
  });
  /**
   * 🔴 NEVER OFFER THE PLACE THE GOODS ARE GOING.
   *
   * Goods at a processor are our stock at their location (§5.4), so the moment
   * anything has been sent to Global Inc their location holds the item and the
   * ledger query returns it as a perfectly valid source. Issuing from it to
   * Global Inc is then one careless click away, and the server refuses it —
   * correctly, but only after the dialog has already offered it.
   *
   * Only the destination is dropped, not every processor: sending goods from one
   * processor straight to the next is a real move, and the domain treats every
   * location-to-location transfer the same way.
   */
  const excludedSourceId =
    step.processorType === 'internal'
      ? step.workCentreLocationId
      : (locations.find((l) => l.vendorId && l.vendorId === processorId)?.id ?? null);

  /**
   * 🔴 The fallback keys off the list AFTER the destination is dropped, not
   * before it.
   *
   * Keying it off the raw list was a real defect: when the only place holding
   * the item is the processor's own — the normal state once anything has been
   * sent there — the ledger list had one entry, the exclusion emptied it, and
   * the fallback never fired. The dropdown then offered nothing, the source
   * stayed blank, and both the batch queries and the save button died with no
   * explanation anywhere on screen.
   */
  /**
   * 🔴 THE LABEL IS COVERAGE, NOT A QUANTITY (2026-08-19).
   *
   * A challan goes out of ONE location, so the question the user is really
   * answering is "which godown can fill this step" — and a single quantity in the
   * principal item's unit cannot say that. `2 of 3 items` can, and it is what
   * makes the trip to a second challan visible BEFORE the picker is filled in
   * rather than at save.
   *
   * A single-item challan keeps the quantity, because there coverage is a
   * tautology and the balance is the useful fact.
   */
  const ledgerOptions = locations
    .filter((l) => l.id !== excludedSourceId)
    .map((l) => ({
      value: l.id,
      label:
        inputItems.length > 1
          ? `${l.name} — ${l.items.length} of ${inputItems.length} items`
          : `${l.name} — ${formatQty(l.availableQty)} ${uomLabel}`,
    }));

  const sourceOptions = ledgerOptions.length
    ? ledgerOptions
    : allLocations
        .filter(
          (l) => l.type !== 'processor' && l.type !== 'in_transit' && l.id !== excludedSourceId,
        )
        .map((l) => ({ value: l.id, label: `${l.name} — no stock on record` }));

  const effectiveSourceId = sourceLocationId || (sourceOptions[0]?.value ?? '');
  const sourceLocationName =
    allLocations.find((l) => l.id === effectiveSourceId)?.name ??
    locations.find((l) => l.id === effectiveSourceId)?.name ??
    'the selected location';

  /**
   * 🔴 …AND WHERE THE REST OF IT IS.
   *
   * A disabled Add Batches button with no reason is the worst thing this dialog
   * can do: the user sees an item they know they have and a control that will not
   * open. Naming the godown turns that dead end into a decision — switch the
   * location, or raise the second challan.
   */
  const elsewhereByItem = useMemo(() => {
    const out = new Map<string, { id: string; name: string; qty: string }[]>();
    for (const location of locations) {
      if (location.id === effectiveSourceId) continue;
      for (const held of location.items) {
        out.set(held.itemId, [
          ...(out.get(held.itemId) ?? []),
          // The id, not just the name: two godowns may share a name, and the
          // continuation below switches the form to one of these by identity.
          { id: location.id, name: location.name, qty: held.availableQty },
        ]);
      }
    }
    return out;
  }, [locations, effectiveSourceId]);

  /**
   * One availability query PER ITEM, at the challan's single source location.
   *
   * `useQueries` rather than a loop of `useQuery`, because the number of inputs
   * is data — a step can have one or seven — and hooks cannot be called in a
   * loop whose length changes between renders.
   *
   * `search` is part of the key: an item with hundreds of live batches is normal
   * in a mill, so the picker narrows on the server rather than shipping the lot
   * and filtering in the browser.
   */
  const batchQueries = useQueries({
    queries: inputItems.map((input) => ({
      queryKey: [
        'available-batches',
        orgId,
        input.itemId,
        effectiveSourceId,
        jobOrder.ownership,
        debouncedSearch[input.itemId] ?? '',
      ],
      queryFn: () =>
        fetchAvailableBatches(orgId!, {
          itemId: input.itemId,
          locationId: effectiveSourceId,
          // 🔴 Not optional. Without it one customer's goods can be issued into
          // another customer's job order (§5.2).
          ownership: jobOrder.ownership,
          search: debouncedSearch[input.itemId] || undefined,
          limit: BATCH_LIMIT,
        }),
      enabled: isOpen && Boolean(orgId && effectiveSourceId),
    })),
  });

  /**
   * 🔴 SEED FROM THE JOB ORDER'S PLAN, ONCE PER ITEM.
   *
   * The whole reason the plan is stored: the planner already said which rolls this
   * step should come off, and asking again is asking the same question twice.
   *
   * What it deliberately does NOT do is trust the plan. A plan is a note taken days
   * ago and nothing was reserved — the batch may have been issued elsewhere, drained,
   * or be sitting in a different godown from the one this challan goes out of. So a
   * planned row is seeded ONLY if the availability query is offering it right now,
   * at this location, and whatever could not be matched is COUNTED and said out
   * loud rather than dropped in silence.
   *
   * Guarded by a ref rather than by state: `batchQueries` is a new array on every
   * render, and the seed must not fight the user's own edits afterwards.
   */
  const seededItems = useRef<Set<string>>(new Set());
  /**
   * 🔴 WHY a planned batch did not seed, not just how many did not (2026-08-19).
   *
   * Under the one-location rule these are two different problems with two
   * different fixes, and lumping them together told the user neither:
   *
   *   `elsewhere` — the plan names a batch in ANOTHER godown. Nothing is wrong
   *                 with the stock; this challan simply cannot reach it. The fix
   *                 is to switch location or raise a second challan, so the
   *                 godown has to be named.
   *   `gone`      — the batch is at this location but drained or already issued.
   *                 Nothing was ever reserved, so this is expected. Pick a
   *                 replacement.
   */
  const [planUnmatched, setPlanUnmatched] = useState<Record<string, PlanGap>>({});

  useEffect(() => {
    if (!isOpen) return;
    inputItems.forEach((input, index) => {
      if (!input.isBatchTracked || input.plannedBatches.length === 0) return;
      if (seededItems.current.has(input.itemId)) return;
      const offered = batchQueries[index]?.data;
      if (!offered) return; // still loading — try again next render
      seededItems.current.add(input.itemId);

      const seeded: Record<string, BatchSelection> = {};
      let matchedQty = 0;
      let gone = 0;
      const elsewhere = new Map<string, number>();

      for (const planned of input.plannedBatches) {
        /* Planned somewhere this challan does not go out of. Counted BEFORE the
           availability lookup, which would only report it as missing stock and
           send the user hunting for a problem that does not exist. */
        if (planned.locationId !== effectiveSourceId) {
          const name =
            allLocations.find((l) => l.id === planned.locationId)?.name ?? 'another godown';
          elsewhere.set(name, (elsewhere.get(name) ?? 0) + 1);
          continue;
        }

        const batch = offered.find(
          (row) => row.batchId === planned.batchId && row.locationId === planned.locationId,
        );
        if (!batch) {
          gone += 1;
          continue;
        }
        // Never seed more than the batch actually still holds — the plan is old
        // and the ceiling is now.
        const qty = Math.min(Number(planned.qty), toNumber(batch.availableQty));
        if (qty <= 0) {
          gone += 1;
          continue;
        }
        seeded[rowKey(batch)] = { batch, qty };
        matchedQty += qty;
      }

      if (Object.keys(seeded).length > 0) {
        setSelection((prev) => ({ ...prev, ...seeded }));
        setTrackedQty((prev) => ({ ...prev, [input.itemId]: matchedQty }));
      }
      if (gone > 0 || elsewhere.size > 0) {
        setPlanUnmatched((prev) => ({
          ...prev,
          [input.itemId]: {
            gone,
            elsewhere: [...elsewhere].map(([name, count]) => ({ name, count })),
          },
        }));
      }
    });
  }, [isOpen, inputItems, batchQueries, allLocations, effectiveSourceId]);

  const { data: vendorsPage } = useQuery({
    queryKey: ['vendors', orgId, 'processors'],
    queryFn: () => fetchVendors(orgId!, { perPage: 500 }),
    enabled: isOpen && Boolean(orgId) && processorType === 'vendor',
  });
  const { data: customersPage } = useQuery({
    queryKey: ['customers', orgId],
    queryFn: () => fetchCustomers(orgId!, { perPage: 500 }),
    enabled: isOpen && Boolean(orgId) && processorType === 'customer',
  });
  const processors = processorType === 'customer'
    ? (customersPage?.results ?? [])
    : (vendorsPage?.results ?? []).filter(
        (v) => !v.vendorTypes?.length || v.vendorTypes.includes('job_worker'),
      );

  /**
   * 🔴 WHETHER A PICKER APPEARS IS THE ITEM'S DECISION (2026-08-14).
   *
   * `inventoryTracking = 'batch'` gets the picker; everything else gets a plain
   * quantity box and the server allocates FIFO. Nothing about the query's
   * results is consulted, which is the whole change.
   *
   * ⚠️ It used to key off "this item happens to have zero batches right now", so
   * the moment one internal batch existed the item flipped back to a picker full
   * of rows nobody had named — the complaint that started all of this. Worse, the
   * batch-less path used to INVENT stock rather than consume it, so gating on the
   * item without the FIFO allocator underneath would have made every issue mint a
   * phantom batch and leave the real balance untouched. The two are one change.
   */
  const batchlessItemIds = useMemo(
    () => new Set(inputItems.filter((input) => !input.isBatchTracked).map((i) => i.itemId)),
    [inputItems],
  );

  /**
   * What the ledger holds for each untracked item at this location — the ceiling
   * on what can be typed, shown because the user has no picker to read it off.
   *
   * Free: it is the sum of the availability query already fetched for the picker.
   */
  const availableByItem = useMemo(() => {
    const totals = new Map<string, number>();
    inputItems.forEach((input, index) => {
      const rows = batchQueries[index]?.data ?? [];
      totals.set(
        input.itemId,
        rows.reduce((sum, row) => sum + toNumber(row.availableQty), 0),
      );
    });
    return totals;
  }, [inputItems, batchQueries]);

  /**
   * 🔴 EVERY LINE CARRIES ITS OWN ITEM (§5.7). The server refuses a line naming
   * an item the step does not consume, and stamps `job_issue_lines.itemId` from
   * this — which is what every per-item total downstream reads.
   *
   * Built from the SELECTION, not from the query results: what was picked stays
   * picked while the search narrows underneath it.
   */
  const lines: JobIssueLineData[] = useMemo(() => {
    const out: JobIssueLineData[] = [];

    for (const sel of Object.values(selection)) {
      if (sel.qty > 0) {
        out.push({
          itemId: sel.batch.itemId,
          batchId: sel.batch.batchId,
          // 🔴 Which godown this row was picked from. The same batch can be
          // offered twice within a dispatch site, and without this the server
          // cannot tell which of the two the goods actually left.
          sourceLocationId: sel.batch.locationId,
          qty: sel.qty,
        });
      }
    }

    /**
     * 🔴 An untracked item goes out as a plain quantity and the server allocates it
     * FIFO out of existing stock.
     *
     * It does NOT invent a batch to cover a shortfall. That scaffold is gone from
     * `jobIssues.service` — every issue of an untracked item used to mint a phantom
     * batch and leave the real balance untouched — and a line asking for more than
     * the ledger holds is now refused outright. `overDrawn` applies the same ceiling
     * here so the refusal arrives while the box is still on screen.
     *
     * 🔴 NOT for a batch-tracked item. `inventoryTracking = 'batch'` says every
     * metre is traceable to its roll; a batch invented at the moment of issue
     * traces to nothing, and the trace can never be reconstructed afterwards. The
     * server refuses those lines, and this input is not rendered for them — they
     * allocate named batches through Add Batches instead.
     */
    for (const itemId of batchlessItemIds) {
      const typed = unstocked[itemId] ?? 0;
      if (typed > 0) out.push({ itemId, qty: typed });
    }

    return out;
  }, [batchlessItemIds, selection, unstocked]);

  /** Quantities NEVER add up across items — 100 PCS + 5 CONE is 105 of nothing
   * (§6.5) — so the running figures are per item and the footer counts rows. */
  const qtyByItem = useMemo(() => {
    const totals = new Map<string, number>();
    for (const line of lines) {
      totals.set(line.itemId ?? '', (totals.get(line.itemId ?? '') ?? 0) + line.qty);
    }
    return totals;
  }, [lines]);

  const mutation = useMutation({
    mutationFn: () =>
      createJobIssue(orgId!, {
        jobOrderStepId: step.id,
        issueDate: issueDate || undefined,
        processorType,
        processorId,
        sourceLocationId: effectiveSourceId,
        lines,
        toleranceOverrideReason: overrideReason.trim() || null,
        remarks: remarks.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, jobOrder.id] });
      queryClient.invalidateQueries({ queryKey: ['job-issues', orgId] });
      queryClient.invalidateQueries({ queryKey: ['available-batches', orgId] });
      // Balances at every location just moved, and the coverage labels are read
      // off them — without this the next challan is planned against stale figures.
      queryClient.invalidateQueries({ queryKey: ['stock-locations', orgId] });
      onIssued();

      /* Items this challan carried nothing of. Read off `qtyByItem`, which is the
         allocation that was actually sent, not what was typed. */
      const left = inputItems.filter((input) => (qtyByItem.get(input.itemId) ?? 0) <= 0);

      /* The godown that covers most of what is left — the one worth offering. An
         item with stock nowhere is not a continuation, it is a receipt problem,
         and it drops out of this by having no entry in `elsewhereByItem`. */
      const coverage = new Map<string, { id: string; name: string; items: string[] }>();
      for (const input of left) {
        for (const at of elsewhereByItem.get(input.itemId) ?? []) {
          const entry = coverage.get(at.id) ?? { id: at.id, name: at.name, items: [] };
          entry.items.push(input.name);
          coverage.set(at.id, entry);
        }
      }
      const best = [...coverage.values()].sort((a, b) => b.items.length - a.items.length)[0];

      if (best) {
        resetAllocations(best.id);
        setContinuation({ itemNames: best.items, locationId: best.id, locationName: best.name });
        return;
      }

      onClose();
    },
    onError: (err: AxiosError<{ message?: string; details?: Record<string, string> }>) => {
      const message = err.response?.data?.message ?? 'Could not issue this material';
      // The server decides whether the tolerance ceiling was breached — it is the
      // only side that knows what has already been issued. When it says so, the
      // reason box appears rather than the save just failing again.
      if (err.response?.data?.details?.toleranceOverrideReason) setNeedsOverride(true);
      setError(message);
    },
  });

  /**
   * Untracked items typed past what the ledger holds. The server refuses these
   * outright (no shortfall is ever invented any more), so the same rule runs here
   * and the refusal arrives while the box is still on screen.
   *
   * Batch-tracked items are not checked here — their quantities are already
   * capped per batch by the picker's own `max`.
   */
  const overDrawn = useMemo(() => {
    const ids = new Set<string>();
    for (const itemId of batchlessItemIds) {
      const typed = unstocked[itemId] ?? 0;
      if (typed > 0 && typed > (availableByItem.get(itemId) ?? 0) + 0.00005) ids.add(itemId);
    }
    return ids;
  }, [batchlessItemIds, unstocked, availableByItem]);

  /**
   * 🔴 Batch-tracked lines that cannot go out as they stand, and why.
   *
   * Two failures, one rule. `'batches'` — a quantity was typed and no batch names
   * where it comes from; batch selection is COMPULSORY for these items, because
   * `inventoryTracking = 'batch'` promises every metre traces to its roll and the
   * server refuses a batch-less line anyway. `'mismatch'` — batches were chosen but
   * do not add up to the quantity, so the number on the challan is not the number
   * leaving the godown.
   *
   * An item with neither a quantity nor an allocation is simply not on this challan
   * and never appears here.
   */
  const blockedLines = useMemo(() => {
    const out = new Map<string, 'batches' | 'mismatch'>();
    for (const input of inputItems) {
      if (!input.isBatchTracked) continue;
      const typed = trackedQty[input.itemId] ?? 0;
      const allocated = qtyByItem.get(input.itemId) ?? 0;
      if (typed <= 0 && allocated <= 0) continue;
      if (allocated <= 0) out.set(input.itemId, 'batches');
      else if (Math.abs(typed - allocated) > 0.00005) out.set(input.itemId, 'mismatch');
    }
    return out;
  }, [inputItems, trackedQty, qtyByItem]);

  /** Items that actually carry a quantity — what the footer counts. */
  const readyCount = inputItems.filter((input) => (qtyByItem.get(input.itemId) ?? 0) > 0).length;

  const addBatchesIndex = inputItems.findIndex((input) => input.itemId === addBatchesFor);
  const addBatchesItem = addBatchesIndex === -1 ? null : inputItems[addBatchesIndex]!;

  /**
   * 🔴 THIS DIALOG NO LONGER PUTS STOCK ON THE BOOKS (2026-08-17).
   *
   * It used to open the Item screen's opening-stock editor, for either kind of
   * item, because Material In was retired before Purchase Received existed and
   * this was the only way in. That escape hatch is gone: an issue SPENDS stock,
   * and a screen that can also create it can cover a shortage by inventing one —
   * which reads on every report afterwards as material that was always there.
   *
   * The consequence is deliberate and worth stating: an item whose ledger is empty
   * at the chosen godown cannot be issued from it at all, tracked or not. Each
   * branch says so on the line rather than offering a button that papers over it.
   * Stock arrives through a receipt, and until Purchase Received lands that means
   * the Item page's own opening-stock grid.
   */

  /** The batches on offer are the ones at the godown this challan goes out of, so
   * there is nothing to choose from until that is settled. */
  /** Everything the user has typed or picked. What a location change destroys,
   * and what decides whether the change needs asking about at all. */
  const allocatedCount =
    Object.keys(selection).length +
    Object.values(trackedQty).filter((q) => q > 0).length +
    Object.values(unstocked).filter((q) => q > 0).length;

  /**
   * The clearing itself. Batches, the typed targets, and the plan seed — a new
   * godown is a different set of batches, so the job order's plan has to be
   * re-matched against it.
   *
   * Split from `applyLocation` because the continuation after a save moves to a
   * new location AND sets a banner: sharing one function would mean clearing the
   * banner and setting it in the same tick and relying on the order of two
   * setState calls to land the right way round.
   */
  const resetAllocations = (value: string) => {
    setSourceLocationId(value);
    setSelection({});
    setTrackedQty({});
    setUnstocked({});
    seededItems.current = new Set();
    setPlanUnmatched({});
    setPendingLocationId(null);
    setError(null);
    setNotice(null);
  };

  /** A location change the USER made — so anything left over from the last save
   * no longer describes the screen. */
  const applyLocation = (value: string) => {
    resetAllocations(value);
    setContinuation(null);
  };

  const openAddBatches = (id: string) => {
    if (!effectiveSourceId) {
      setNotice('Pick the godown this material goes out of first — batches are per godown.');
      return;
    }
    setNotice(null);
    setError(null);
    setAddBatchesFor(id);
  };

  const canSave =
    lines.length > 0 &&
    Boolean(effectiveSourceId) &&
    overDrawn.size === 0 &&
    blockedLines.size === 0 &&
    !mutation.isPending;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Issue material — step ${step.seq}, ${step.processNameSnapshot}`}
      subtitle={
        <>
          {jobOrder.jobOrderNumber} ·{' '}
          {inputItems.length === 1
            ? `${inputItems[0]!.name}${inputItems[0]!.uomLabel ? ` (${inputItems[0]!.uomLabel})` : ''}`
            : `${inputItems.length} items`}
        </>
      }
      width={1000}
      footer={
        <>
          <button
            type="button"
            onClick={() => mutation.mutate()}
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
            {mutation.isPending ? 'Issuing…' : 'Issue & create challan'}
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
          {/*
            🔴 A COUNT, never one summed total — 100 PCS + 5 CONE is 105 of nothing
            (§6.5). It used to spell out every item and its quantity here, which on a
            ten-input step was a paragraph in the footer restating the grid directly
            above it. The per-item figures now live in that grid's own columns, so
            this only has to say how much of the challan is filled in.
          */}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
            {readyCount === 0
              ? 'nothing selected yet'
              : `${readyCount} of ${inputItems.length} ${
                  inputItems.length === 1 ? 'item' : 'items'
                } on this challan`}
          </span>
        </>
      }
    >
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
      {/* 🔴 THE CHALLAN WENT; THE STEP IS NOT DONE.
          Green, because nothing failed — this is a receipt for what just happened
          plus the one next action, with the form already cleared and pointed at
          the godown holding the rest. */}
      {continuation && (
        <div
          style={{
            fontSize: 13,
            color: '#065f46',
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: 4,
            padding: '10px 12px',
            margin: '0 0 16px 0',
          }}
          role="status"
        >
          <p style={{ margin: '0 0 8px 0', lineHeight: 1.5 }}>
            Challan raised. {continuation.itemNames.join(', ')}{' '}
            {continuation.itemNames.length === 1 ? 'was' : 'were'} not on it — a challan goes out of
            one location, and {continuation.itemNames.length === 1 ? 'it is' : 'they are'} at{' '}
            <strong>{continuation.locationName}</strong>. This form is now set to{' '}
            {continuation.locationName} for the next one.
          </p>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '5px 14px',
              background: '#fff',
              color: '#334155',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: 12.5,
            }}
          >
            Not now — close
          </button>
        </div>
      )}

      {/* 🔴 THE CONFIRM, INLINE — not a nested dialog.
          A Modal inside a Modal fights over the focus trap and Esc, and this
          question is about the field three rows below it, so it belongs on the
          same surface. The Select keeps showing the CURRENT location until this
          is answered, so nothing has changed behind the question. */}
      {pendingLocationId && (
        <div
          style={{
            fontSize: 13,
            color: '#92400e',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 4,
            padding: '10px 12px',
            margin: '0 0 16px 0',
          }}
          role="alert"
        >
          <p style={{ margin: '0 0 8px 0', lineHeight: 1.5 }}>
            Move this challan to{' '}
            <strong>
              {locations.find((l) => l.id === pendingLocationId)?.name ??
                allLocations.find((l) => l.id === pendingLocationId)?.name ??
                'that location'}
            </strong>
            ? Batches are held per location, so the {allocatedCount}{' '}
            {allocatedCount === 1 ? 'entry' : 'entries'} allocated here will be cleared.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => applyLocation(pendingLocationId)}
              style={{
                padding: '5px 14px',
                background: '#b45309',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: 12.5,
              }}
            >
              Change and clear
            </button>
            <button
              type="button"
              onClick={() => setPendingLocationId(null)}
              style={{
                padding: '5px 14px',
                background: '#fff',
                color: '#334155',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: 12.5,
              }}
            >
              Keep this location
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p
          style={{
            fontSize: 13,
            color: '#92400e',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 4,
            padding: '8px 12px',
            margin: '0 0 16px 0',
          }}
          role="status"
        >
          {notice}
        </p>
      )}

      <section style={{ marginBottom: 20 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 14,
          }}
        >
          <div>
            <label style={labelStyle} htmlFor="issue-date">
              Date
            </label>
            <DateInput
              id="issue-date"
              value={issueDate}
              onChange={setIssueDate}
              style={inputStyle}
              portal
            />
          </div>

          <div>
            <label style={labelStyle}>Issue from</label>
            <Select
              value={effectiveSourceId}
              onChange={(value) => {
                if (value === effectiveSourceId) return;
                /* Ask only when there is something to lose. Changing the godown
                   before anything is picked is the ordinary first action on this
                   dialog and must not cost a confirm. */
                if (allocatedCount > 0) setPendingLocationId(value);
                else applyLocation(value);
              }}
              options={
                sourceOptions.length === 0
                  ? [{ value: '', label: 'No godown set up yet' }]
                  : sourceOptions
              }
              ariaLabel="Issue from location"
              fullWidth
            />
          </div>

          <div>
            <label style={labelStyle}>Done By</label>
            <Select
              value={processorType}
              onChange={(value) => {
                setProcessorType(value);
                if (value === 'internal') {
                  setProcessorId(null);
                } else if (value === step.processorType) {
                  setProcessorId(step.processorId);
                } else {
                  setProcessorId(null);
                }
              }}
              options={[
                { value: 'vendor', label: 'Vendor (jobworker)' },
                { value: 'customer', label: 'Customer' },
                { value: 'internal', label: 'In-house' },
              ]}
              ariaLabel="Done By"
              fullWidth
            />
          </div>

          {processorType === 'internal' ? (
            <div>
              <label style={labelStyle} htmlFor="issue-workcentre">
                Work centre
              </label>
              <input
                id="issue-workcentre"
                type="text"
                value={step.workCentre?.name ?? '—'}
                readOnly
                style={readOnlyStyle}
              />
            </div>
          ) : (
            <div>
              <label style={labelStyle}>Processor</label>
              <Select
                value={processorId ?? ''}
                onChange={(value) => setProcessorId(value || null)}
                options={[
                  { value: '', label: 'Select a processor…' },
                  ...processors.map((v) => ({
                    value: v.id,
                    label: v.companyName || v.contactName,
                  })),
                ]}
                ariaLabel="Processor"
                fullWidth
              />
            </div>
          )}

          {/* Remarks sat in the Transport section until that section was removed
              (2026-08-10). It is not a transport field — it is the one free-text
              note the challan prints — so it moved up here rather than going with
              vehicle / LR / e-way bill. */}
          <div>
            <label style={labelStyle} htmlFor="issue-remarks">
              Remarks
            </label>
            <input
              id="issue-remarks"
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 20 }}>
        <h3 style={sectionHeading}>Pick the material</h3>

        {/*
          🔴 ONE ROW PER INPUT ITEM (§5.7). Issuing all seven of a step's items on
          one challan, or two of them today and the rest tomorrow, are both normal —
          nothing here forces a row to be filled in, so a challan carries whatever
          was actually loaded onto the vehicle.

          🔴 A TABLE, NOT A CARD PER ITEM (2026-08-17). Each item used to be its own
          bordered strip with the figures pushed right by `margin-left: auto`, so
          every quantity, unit and link landed at whatever x the item's name and
          badges happened to end at — no two rows aligned, and a step with ten
          inputs was a staircase. Columns are the whole point of a line-items grid:
          the eye reads DOWN a column to compare, and that only works if the column
          is in the same place on every row.
        */}
        <div style={{ border: '1px solid #eef0f3', borderRadius: 6, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr style={{ background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
                <th style={lineTh} scope="col">
                  Item
                </th>
                <th style={{ ...lineTh, textAlign: 'right', width: 110 }} scope="col">
                  Planned
                </th>
                <th style={{ ...lineTh, textAlign: 'right', width: 110 }} scope="col">
                  Available
                </th>
                <th style={{ ...lineTh, textAlign: 'right', width: 140 }} scope="col">
                  Quantity
                </th>
                <th style={{ ...lineTh, width: 70 }} scope="col">
                  Unit
                </th>
                <th style={{ ...lineTh, width: 200 }} scope="col">
                  Batches
                </th>
              </tr>
            </thead>
            <tbody>
              {inputItems.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#64748b' }}
                  >
                    This step lists nothing to issue.
                  </td>
                </tr>
              )}
              {inputItems.map((input, index) => {
                const query = batchQueries[index];
                const search = searchByItem[input.itemId] ?? '';
                const picked = qtyByItem.get(input.itemId) ?? 0;
                /* 🔴 A SEARCH-FILTERED SUM. `availableByItem` adds up whatever the
                   availability query last returned, and that query carries the Add
                   Batches search — so while a search is live this is a subset, not
                   the balance. The search is cleared when that dialog closes, and
                   `search` is checked here too so the 300ms debounce window cannot
                   flash a false "nothing on the books". */
                const available = availableByItem.get(input.itemId) ?? 0;
                /** How many batch rows this item carries — "…added to N batches". */
                const pickedBatchCount = Object.values(selection).filter(
                  (sel) => sel.batch.itemId === input.itemId && sel.qty > 0,
                ).length;
                /* ⚠️ The same set `lines` reads — see `batchlessItemIds`. */
                const showUnstockedInput = batchlessItemIds.has(input.itemId);
                const isEmptyHere = !query?.isLoading && !search && available === 0;

                return (
                  <tr key={input.itemId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ ...lineTd, whiteSpace: 'normal' }}>
                      <div style={{ ...lineCell, fontWeight: 600, color: '#111' }}>
                        {input.name}
                      </div>

                      {/* The dead end, under the item it is about — a full sentence
                          in a narrow numeric column would wreck the alignment this
                          table exists for. */}
                      {isEmptyHere && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 11.5,
                            color: '#b45309',
                            lineHeight: 1.45,
                          }}
                        >
                          Quantity not available at this location. Please change the location.
                        </div>
                      )}

                      {/* 🔴 Said out loud, never swallowed. Nothing was reserved, so
                          a planned batch going missing between planning and issuing
                          is expected — but the user has to know the pre-fill is
                          short of what the order intended, and WHICH of the two
                          reasons it is, because they have different fixes. */}
                      {(planUnmatched[input.itemId]?.elsewhere ?? []).length > 0 && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 11.5,
                            color: '#b45309',
                            lineHeight: 1.45,
                          }}
                        >
                          The plan places{' '}
                          {planUnmatched[input.itemId]!.elsewhere.map((at, i, all) => (
                            <span key={at.name}>
                              {at.count} {at.count === 1 ? 'batch' : 'batches'} at{' '}
                              <strong>{at.name}</strong>
                              {i < all.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                          , which this challan does not go out of. Switch the location, or issue
                          those on their own challan.
                        </div>
                      )}
                      {(planUnmatched[input.itemId]?.gone ?? 0) > 0 && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 11.5,
                            color: '#b45309',
                            lineHeight: 1.45,
                          }}
                        >
                          {planUnmatched[input.itemId]!.gone} planned{' '}
                          {planUnmatched[input.itemId]!.gone === 1 ? 'batch is' : 'batches are'} no
                          longer available here — nothing was reserved. Pick replacements.
                        </div>
                      )}
                    </td>

                    <td style={{ ...lineTd, textAlign: 'right', color: '#64748b' }}>
                      <div style={lineCellRight}>
                        {input.plannedQty === null ? '—' : formatQty(input.plannedQty)}
                      </div>
                    </td>

                    <td
                      style={{
                        ...lineTd,
                        textAlign: 'right',
                        color: isEmptyHere ? '#b45309' : '#334155',
                      }}
                    >
                      <div style={lineCellRight}>
                        {query?.isLoading ? '…' : formatQty(available)}
                      </div>
                    </td>

                    <td style={{ ...lineTd, textAlign: 'right' }}>
                      {showUnstockedInput ? (
                        /*
                          🔴 AN UNTRACKED ITEM HAS NO PICKER AND NEVER WILL. Its
                          batches carry no reference, are not searchable and are not
                          rendered — offering them would be asking the user to choose
                          between rows they cannot tell apart. A quantity, and the
                          server takes it out of the oldest stock first.

                          A shortfall is refused on save: this box no longer invents
                          stock, it spends it. `Available` beside it is the ceiling.
                        */
                        <input
                          id={`unstocked-${input.itemId}`}
                          type="number"
                          onWheel={blurOnWheel}
                          step="0.0001"
                          min="0"
                          value={unstocked[input.itemId] ?? ''}
                          onChange={(e) =>
                            setUnstocked((prev) => ({
                              ...prev,
                              [input.itemId]: Number(e.target.value) || 0,
                            }))
                          }
                          max={available || undefined}
                          disabled={isEmptyHere}
                          placeholder="0"
                          aria-label={`Quantity of ${input.name} to issue`}
                          style={{
                            ...inputStyle,
                            width: 120,
                            textAlign: 'right',
                            background: isEmptyHere ? '#f8fafc' : '#fff',
                            borderColor: overDrawn.has(input.itemId) ? '#fca5a5' : '#d1d5db',
                          }}
                        />
                      ) : (
                        /*
                          The target for this line. Add Batches pre-fills each batch
                          it picks from what is still unallocated against this, and
                          the challan will not save until the batches add up to it.
                        */
                        <input
                          id={`tracked-${input.itemId}`}
                          type="number"
                          onWheel={blurOnWheel}
                          step="0.0001"
                          min="0"
                          value={trackedQty[input.itemId] ?? ''}
                          onChange={(e) =>
                            setTrackedQty((prev) => ({
                              ...prev,
                              [input.itemId]: Number(e.target.value) || 0,
                            }))
                          }
                          disabled={isEmptyHere}
                          placeholder="0"
                          aria-label={`Quantity of ${input.name} to issue`}
                          style={{
                            ...inputStyle,
                            width: 120,
                            textAlign: 'right',
                            background: isEmptyHere ? '#f8fafc' : '#fff',
                            borderColor: blockedLines.has(input.itemId) ? '#fca5a5' : '#d1d5db',
                          }}
                        />
                      )}
                    </td>

                    <td style={{ ...lineTd, color: '#64748b' }}>
                      <div style={lineCell}>{input.uomLabel || '—'}</div>
                    </td>

                    <td style={lineTd}>
                      {showUnstockedInput ? (
                        /* Untracked stock is allocated FIFO by the server, so there
                           is nothing to pick — saying so keeps the column meaningful
                           on every row rather than blank on half of them. */
                        <div style={{ ...lineCell, fontSize: 12, color: '#94a3b8' }}>
                          Oldest stock first
                        </div>
                      ) : (
                        <>
                          <div style={lineCell}>
                            <button
                              type="button"
                              onClick={() => openAddBatches(input.itemId)}
                              disabled={isEmptyHere}
                              style={{
                                padding: 0,
                                border: 'none',
                                background: 'none',
                                fontSize: 12.5,
                                fontWeight: 500,
                                textAlign: 'left',
                                cursor: isEmptyHere ? 'not-allowed' : 'pointer',
                                color: isEmptyHere ? '#cbd5e1' : '#0062ff',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {pickedBatchCount === 0
                                ? 'Add Batches'
                                : `${pickedBatchCount} ${pickedBatchCount === 1 ? 'batch' : 'batches'}`}
                            </button>
                          </div>

                          {/* Why this line is holding the challan up, next to the
                              control that fixes it. Blocking silently and greying
                              out Issue would leave the user hunting the offender
                              across ten rows. */}
                          {blockedLines.get(input.itemId) === 'batches' && (
                            <div
                              style={{
                                fontSize: 11.5,
                                color: '#b91c1c',
                                marginTop: 3,
                                whiteSpace: 'normal',
                                lineHeight: 1.4,
                              }}
                            >
                              Select the batches this comes out of.
                            </div>
                          )}
                          {blockedLines.get(input.itemId) === 'mismatch' && (
                            <div
                              style={{
                                fontSize: 11.5,
                                color: '#b91c1c',
                                marginTop: 3,
                                whiteSpace: 'normal',
                                lineHeight: 1.4,
                              }}
                            >
                              {formatQty(Math.abs((trackedQty[input.itemId] ?? 0) - picked))}{' '}
                              {input.uomLabel}{' '}
                              {(trackedQty[input.itemId] ?? 0) > picked
                                ? 'not allocated yet'
                                : 'allocated over the quantity'}
                              .
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/*
          🔴 No running-totals strip. Every figure it carried — already issued,
          planned, remaining, the tolerance ceiling — was the PRINCIPAL item's
          only, printed once at the bottom of a dialog that carries several items
          in several units. Each section header already states its own item's
          planned quantity and what is selected against it, which is the same
          information where it belongs. The ceiling is enforced per item by the
          server, and its message names the item it refused.
        */}

        {needsOverride && (
          <div style={{ marginTop: 12 }}>
            <label style={{ ...labelStyle, color: '#b45309' }} htmlFor="issue-override">
              Reason for going past the tolerance ceiling
            </label>
            <input
              id="issue-override"
              type="text"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              style={inputStyle}
              placeholder="Why is this being allowed?"
            />
          </div>
        )}
      </section>

      {/* Keyed and mounted only while open — `AddBatchesModal` seeds its grid once,
          on mount, so a shared instance would show one item's rows against another
          item's name and saving it would move the allocation to the wrong line. */}
      {addBatchesItem && effectiveSourceId && (
        <AddBatchesModal
          key={addBatchesItem.itemId}
          isOpen
          onClose={() => {
            setAddBatchesFor(null);
            /* 🔴 The search goes with the dialog. It is a parameter of the
               availability query, so a term left behind keeps the grid's Available
               column showing a filtered subset — and re-opening the dialog would
               start narrowed to whatever was last typed. */
            setSearchByItem((prev) => ({ ...prev, [addBatchesItem.itemId]: '' }));
          }}
          itemName={addBatchesItem.name}
          sku={addBatchesItem.sku}
          uomLabel={addBatchesItem.uomLabel}
          locationName={sourceLocationName}
          plannedQty={addBatchesItem.plannedQty}
          lineQty={trackedQty[addBatchesItem.itemId] ?? 0}
          selection={Object.fromEntries(
            Object.entries(selection).filter(
              ([, sel]) => sel.batch.itemId === addBatchesItem.itemId,
            ),
          )}
          onSave={(rows, overwriteQty) => {
            // Replace THIS item's slice and leave every other item's alone — one
            // dialog holds every input's allocation in one map (§5.7).
            setSelection((prev) => {
              const kept = Object.fromEntries(
                Object.entries(prev).filter(
                  ([, sel]) => sel.batch.itemId !== addBatchesItem.itemId,
                ),
              );
              return { ...kept, ...rows };
            });
            if (overwriteQty !== null) {
              setTrackedQty((prev) => ({ ...prev, [addBatchesItem.itemId]: overwriteQty }));
            }
          }}
          batches={batchQueries[addBatchesIndex]?.data ?? []}
          search={searchByItem[addBatchesItem.itemId] ?? ''}
          onSearchChange={(value) =>
            setSearchByItem((prev) => ({ ...prev, [addBatchesItem.itemId]: value }))
          }
          isLoading={batchQueries[addBatchesIndex]?.isLoading ?? false}
          isCapped={(batchQueries[addBatchesIndex]?.data ?? []).length >= BATCH_LIMIT}
        />
      )}
    </Modal>
  );
}
