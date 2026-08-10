import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { fetchVendors } from '../../purchases/vendors/vendors.api';
import { fetchLocations } from '../../configuration/locations/locations.api';
import { fetchAvailableLots, fetchStockLocations } from '../lots/lots.api';
import { formatQty, toNumber } from '../jobwork.schemas';
import type { JobOrder, OverviewStep } from '../job-orders/jobOrders.schemas';
import { createJobIssue } from './jobIssues.api';
import type { JobIssueLineData } from './jobIssues.schemas';
import { LotPicker, type LotSelection } from './LotPicker';

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
 * lots, and a free-text remark.
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
  const [processorId, setProcessorId] = useState<string | null>(step.processorId);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [selection, setSelection] = useState<Record<string, LotSelection>>({});
  /** ⚠️ Quantities typed for items that have no stock on record. Temporary —
   * see the note in `lines` below. */
  const [unstocked, setUnstocked] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [remarks, setRemarks] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [needsOverride, setNeedsOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * 🔴 ONE SECTION PER INPUT ITEM (domain §5.7). A challan carries fabric, thread
   * and buttons — one physical movement to one processor, so one document — and
   * each of them has its own lots, its own unit and its own picker.
   *
   * The fallback to the step's scalar item covers a step saved before Sprint 5,
   * whose `inputs` the backfill has not reached.
   */
  const inputItems = useMemo(() => {
    if (step.inputs.length > 0) {
      return step.inputs.map((row) => ({
        itemId: row.itemId,
        name: row.item?.name ?? 'Item',
        uomLabel: row.uom ? (row.uom.symbol ?? row.uom.unitName) : '',
        plannedQty: row.plannedQty === null ? null : toNumber(row.plannedQty),
        fromStock: row.fromStock ?? true,
      }));
    }
    return step.issueItemId
      ? [
          {
            itemId: step.issueItemId,
            name: step.issueItem?.name ?? 'Item',
            uomLabel: step.issueUom ? (step.issueUom.symbol ?? step.issueUom.unitName) : '',
            plannedQty: step.plannedInputQty === null ? null : toNumber(step.plannedInputQty),
            fromStock: true,
          },
        ]
      : [];
  }, [step]);

  /** The principal input — what the step is fundamentally about. The location
   * list and the tolerance strip are its, because the challan has ONE source
   * location and the header figures are in one unit. */
  const principal = inputItems[0] ?? null;
  const itemId = principal?.itemId ?? '';
  const uomLabel = principal?.uomLabel ?? '';

  /** 🔴 A ledger query. Only locations that actually hold this item appear. */
  const { data: locations = [] } = useQuery({
    queryKey: ['stock-locations', orgId, itemId, jobOrder.ownership],
    queryFn: () => fetchStockLocations(orgId!, { itemId, ownership: jobOrder.ownership }),
    enabled: isOpen && Boolean(orgId && itemId),
  });

  /**
   * Auto-selected when only one location qualifies — which is the usual case,
   * and asking a question whose answer never changes is a click for nothing.
   *
   * DERIVED, not synced into state by an effect. An effect that calls setState
   * renders twice and, worse, briefly shows the dialog with no location picked
   * — long enough for the lot query underneath to fire with an empty location
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
   * stayed blank, and both the lot queries and the save button died with no
   * explanation anywhere on screen.
   */
  const ledgerOptions = locations
    .filter((l) => l.id !== excludedSourceId)
    .map((l) => ({
      value: l.id,
      label: `${l.name} — ${formatQty(l.availableQty)} ${uomLabel}`,
    }));

  const sourceOptions = ledgerOptions.length
    ? ledgerOptions
    : allLocations
        .filter(
          (l) => l.type !== 'processor' && l.type !== 'in_transit' && l.id !== excludedSourceId,
        )
        .map((l) => ({ value: l.id, label: `${l.name} — no stock on record` }));

  const effectiveSourceId = sourceLocationId || (sourceOptions[0]?.value ?? '');

  /**
   * One availability query PER ITEM, at the challan's single source location.
   *
   * `useQueries` rather than a loop of `useQuery`, because the number of inputs
   * is data — a step can have one or seven — and hooks cannot be called in a
   * loop whose length changes between renders.
   */
  const lotQueries = useQueries({
    queries: inputItems.map((input) => ({
      queryKey: ['available-lots', orgId, input.itemId, effectiveSourceId, jobOrder.ownership],
      queryFn: () =>
        fetchAvailableLots(orgId!, {
          itemId: input.itemId,
          locationId: effectiveSourceId,
          // 🔴 Not optional. Without it one customer's goods can be issued into
          // another customer's job order (§5.2).
          ownership: jobOrder.ownership,
          withPackages: true,
        }),
      enabled: isOpen && Boolean(orgId && effectiveSourceId),
    })),
  });

  const { data: vendorsPage } = useQuery({
    queryKey: ['vendors', orgId, 'processors'],
    queryFn: () => fetchVendors(orgId!, { perPage: 500 }),
    enabled: isOpen && Boolean(orgId) && step.processorType !== 'internal',
  });
  const processors = (vendorsPage?.results ?? []).filter(
    (v) => !v.vendorTypes?.length || v.vendorTypes.includes('job_worker'),
  );

  const singleLotOnly = step.process?.requiresSingleLot ?? false;

  /**
   * 🔴 EVERY LINE CARRIES ITS OWN ITEM (§5.7). The server refuses a line naming
   * an item the step does not consume, and stamps `job_issue_lines.item_id` from
   * this — which is what every per-item total downstream reads.
   */
  const lines: JobIssueLineData[] = useMemo(() => {
    const out: JobIssueLineData[] = [];
    for (const [index, input] of inputItems.entries()) {
      /**
       * ⚠️ TEMPORARY — an item with no stock on record can still be issued, as a
       * plain quantity with no lot behind it. Material In was retired before
       * Purchase Received and Opening Stock exist, so without this the loop
       * cannot be walked at all. The server creates a zero-valued lot for the
       * line and says so in the ledger remark.
       *
       * 🔴 Remove this the day Purchase Received lands.
       */
      const noStock = (lotQueries[index]?.data ?? []).length === 0;
      if (noStock) {
        const typed = unstocked[input.itemId] ?? 0;
        if (typed > 0) out.push({ itemId: input.itemId, qty: typed });
        continue;
      }
      for (const lot of lotQueries[index]?.data ?? []) {
        const sel = selection[lot.lotId];
        if (!sel) continue;
        // ⚠️ Lot level only — no `lotPackageId`. Taka selection is off (see
        // `PACKAGE_LEVEL` in LotPicker), so a lot contributes one line carrying
        // the quantity typed against it.
        if (sel.qty > 0) {
          out.push({ itemId: input.itemId, lotId: lot.lotId, qty: sel.qty });
        }
      }
    }
    return out;
  }, [inputItems, lotQueries, selection, unstocked]);

  /** Quantities NEVER add up across items — 100 PCS + 5 CONE is 105 of nothing
   * (§6.5) — so the running figures are per item and the footer counts rows. */
  const qtyByItem = useMemo(() => {
    const totals = new Map<string, number>();
    for (const line of lines) {
      totals.set(line.itemId ?? '', (totals.get(line.itemId ?? '') ?? 0) + line.qty);
    }
    return totals;
  }, [lines]);

  const selectedPackages = lines.filter((l) => l.lotPackageId).length;

  const mutation = useMutation({
    mutationFn: () =>
      createJobIssue(orgId!, {
        jobOrderStepId: step.id,
        issueDate: issueDate || undefined,
        processorType: step.processorType,
        processorId,
        sourceLocationId: effectiveSourceId,
        lines,
        toleranceOverrideReason: overrideReason.trim() || null,
        remarks: remarks.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, jobOrder.id] });
      queryClient.invalidateQueries({ queryKey: ['job-issues', orgId] });
      queryClient.invalidateQueries({ queryKey: ['available-lots', orgId] });
      onIssued();
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

  const canSave = lines.length > 0 && Boolean(effectiveSourceId) && !mutation.isPending;

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
          {/* Per item, never one total — 100 PCS + 5 CONE is 105 of nothing. */}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
            {selectedPackages > 0 &&
              `${selectedPackages} taka${selectedPackages === 1 ? '' : 's'} · `}
            {inputItems
              .filter((input) => (qtyByItem.get(input.itemId) ?? 0) > 0)
              .map(
                (input) =>
                  `${formatQty(qtyByItem.get(input.itemId) ?? 0)} ${input.uomLabel} ${input.name}`,
              )
              .join(' · ') || 'nothing selected yet'}
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
            <input
              id="issue-date"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Issue from</label>
            <Select
              value={effectiveSourceId}
              onChange={(value) => {
                setSourceLocationId(value);
                // The picker is per location; a stale selection would issue lots
                // from somewhere they no longer are.
                setSelection({});
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

          {step.processorType === 'internal' ? (
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
                  { value: '', label: 'Pick a processor…' },
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

          <div>
            <label style={labelStyle} htmlFor="issue-item">
              Items
            </label>
            <input
              id="issue-item"
              type="text"
              value={inputItems.map((i) => i.name).join(', ') || '—'}
              readOnly
              style={readOnlyStyle}
            />
          </div>

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
          🔴 ONE PICKER PER INPUT ITEM (§5.7). Issuing all seven of a step's items
          on one challan, or two of them today and the rest tomorrow, are both
          normal — nothing here forces a section to be filled in, so a challan
          carries whatever was actually loaded onto the vehicle.
        */}
        {inputItems.map((input, index) => {
          const query = lotQueries[index];
          const itemLots = query?.data ?? [];
          const picked = qtyByItem.get(input.itemId) ?? 0;
          return (
            <div
              key={input.itemId}
              style={{
                border: '1px solid #eef0f3',
                borderRadius: 6,
                marginBottom: 12,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '8px 12px',
                  background: '#f9f9fb',
                  borderBottom: '1px solid #eef0f3',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{input.name}</span>
                <span
                  style={{
                    padding: '1px 7px',
                    borderRadius: 9,
                    fontSize: 10,
                    fontWeight: 600,
                    background: input.fromStock ? '#f1f5f9' : '#eff6ff',
                    color: input.fromStock ? '#475569' : '#1d4ed8',
                  }}
                >
                  {input.fromStock ? 'From stock' : 'From an earlier step'}
                </span>
                {input.plannedQty !== null && (
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    Planned {formatQty(input.plannedQty)} {input.uomLabel}
                  </span>
                )}
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 12,
                    color: picked > 0 ? '#111' : '#94a3b8',
                  }}
                >
                  {formatQty(picked)} {input.uomLabel} selected
                </span>
              </div>

              <div style={{ padding: 10 }}>
                {/*
                  ⚠️ TEMPORARY — no lots means no stock has ever been received
                  for this item, which is normal today: Material In was retired
                  before Purchase Received and Opening Stock exist. Type the
                  quantity and a zero-valued lot is created for it on save, so
                  the loop can be walked end to end. 🔴 Remove when PR lands.
                */}
                {!query?.isLoading && itemLots.length === 0 ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label
                      htmlFor={`unstocked-${input.itemId}`}
                      style={{ fontSize: 12, color: '#64748b' }}
                    >
                      No stock on record — issue anyway:
                    </label>
                    <input
                      id={`unstocked-${input.itemId}`}
                      type="number"
                      step="0.0001"
                      min="0"
                      value={unstocked[input.itemId] ?? ''}
                      onChange={(e) =>
                        setUnstocked((prev) => ({
                          ...prev,
                          [input.itemId]: Number(e.target.value) || 0,
                        }))
                      }
                      placeholder={`Quantity${input.uomLabel ? ` (${input.uomLabel})` : ''}`}
                      style={{ ...inputStyle, width: 200 }}
                    />
                  </div>
                ) : (
                  <LotPicker
                    lots={itemLots}
                    selection={selection}
                    onChange={setSelection}
                    expanded={expanded}
                    onToggleExpand={(lotId) =>
                      setExpanded((prev) => ({ ...prev, [lotId]: !prev[lotId] }))
                    }
                    uomLabel={input.uomLabel}
                    /* Single-lot is a per-ITEM rule: two items are necessarily two
                     lots, so checking the challan as a whole would refuse every
                     multi-item issue on principle (§5.4). */
                    singleLotOnly={singleLotOnly}
                    onSingleLotBlocked={() =>
                      setNotice(
                        `${step.processNameSnapshot} must run on a single lot — fabric from two dye lots shows shade variation nobody catches until the goods are assembled.`,
                      )
                    }
                    isLoading={query?.isLoading ?? false}
                  />
                )}
              </div>
            </div>
          );
        })}

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
    </Modal>
  );
}
