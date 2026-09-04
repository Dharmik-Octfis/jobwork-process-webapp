import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { DateInput } from '../../../components/ui/DateInput';
import { Select } from '../../../components/ui/Select';
import { CustomFieldsSection } from '../../custom-fields/CustomFieldsSection';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';
import type { CustomFieldValues } from '../../custom-fields/customFields.schemas';
import { fetchCustomers } from '../../sales/customers/customers.api';
import { StepsGrid } from '../StepsGrid';
import {
  OWNERSHIP_OPTIONS,
  emptyStep,
  type StepItemRow,
  type StepItemRowRead,
} from '../jobwork.schemas';
import { fetchRouteById, fetchRoutes } from '../process-routes/processRoutes.api';
import type { Route } from '../process-routes/processRoutes.schemas';
import {
  fetchJobOrderNumberPreference,
  formatJobOrderNumber,
  updateJobOrderNumberPreference,
} from './jobOrders.api';
import type { CreateJobOrderData, JobOrder, JobOrderStepData } from './jobOrders.schemas';
import { JobOrderNumberConfigModal } from './JobOrderNumberConfigModal';

interface Props {
  initialData?: Partial<JobOrder>;
  /**
   * 🔴 THE PREFILL IS ANOTHER ORDER'S PLAN, NOT ITS IDENTITY.
   *
   * `initialData` is a saved order, so everything that says *which* order it is
   * has to come off here — one place, rather than at each of the three call sites
   * that could get it wrong. Its number goes back to the series (the old one is
   * printed on that order's challans); its step ids go, because a step id belongs
   * to the order it was saved on and `jobOrderStepSchema` refuses a foreign one on
   * create; its step statuses go, or the grid would freeze the rows that had
   * already started on the ORIGINAL; and its dates go, because a due date belongs
   * to the run that was promised, not to the plan being copied.
   */
  isClone?: boolean;
  onSubmit: (data: CreateJobOrderData) => void;
  isPending: boolean;
  onCancel: () => void;
  fieldErrors?: Record<string, string>;
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: '#4b5563',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  height: 36,
  boxSizing: 'border-box' as const,
};

const readOnlyStyle: React.CSSProperties = {
  ...inputStyle,
  background: '#f8fafc',
  color: '#64748b',
};

const sectionHeading: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#111',
  margin: '0 0 16px 0',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const num = (value: string | number | null | undefined) =>
  value === null || value === undefined ? null : Number(value);

/** Server rows → grid rows. Quantities arrive as Decimal strings. */
function toInputRows(rows: StepItemRowRead[] = []): StepItemRow[] {
  return rows.map((row) => ({
    itemId: row.itemId,
    uomId: row.uomId,
    plannedQty: num(row.plannedQty),
    tolerancePct: num(row.tolerancePct),
    /* The saved plan, back into the WRITE shape. The read rows carry the batch's
       label and godown for rendering; the server only wants the three ids and the
       quantity, and sending the hydrated objects back would be a payload the
       schema rejects. */
    plannedBatches: (row.plannedBatches ?? []).map((planned) => ({
      batchId: planned.batchId,
      /* 🔴 Carried back, or editing a job order silently un-plans every roll it
         named: the write shape has always had this field, the read shape did not,
         so the round trip dropped it. */
      batchUnitId: planned.batchUnitId ?? null,
      locationId: planned.locationId,
      qty: Number(planned.qty),
    })),
  }));
}

function toOutputRows(rows: StepItemRowRead[] = []): StepItemRow[] {
  return rows.map((row) => ({
    itemId: row.itemId,
    uomId: row.uomId,
    expectedQty: num(row.expectedQty),
    isPrimary: Boolean(row.isPrimary),
  }));
}

function toFormSteps(order?: Partial<JobOrder>, isClone = false): JobOrderStepData[] {
  if (!order?.steps?.length) return [emptyStep() as JobOrderStepData];
  return order.steps.map((step) => ({
    // Carried so the server can match the locked rows on save (§6.6). A route
    // copied into a new order deliberately has none — see `toGridSteps` — and
    // nor does a clone, which is the same copy from a different source.
    id: isClone ? undefined : step.id,
    processId: step.processId,
    processorType: step.processorType,
    processorId: step.processorId,
    workCentreLocationId: step.workCentreLocationId,
    rate: num(step.rate),
    rateBasis: step.rateBasis,
    inputs: toInputRows(step.inputs),
    outputs: toOutputRows(step.outputs),
    expectedYield: num(step.expectedYield),
    tolerancePct: num(step.tolerancePct),
    plannedInputQty: num(step.plannedInputQty),
    remarks: step.remarks,
  }));
}

/** A route's steps as grid rows. Copied ONCE — from here the grid is the job
 * order's own, and the route is never read again (§2.4). */
function toGridSteps(route: Route): JobOrderStepData[] {
  return route.steps.map((step) => ({
    processId: step.processId,
    processorType: step.processorType,
    processorId: step.processorId,
    workCentreLocationId: step.workCentreLocationId,
    rate: num(step.rate),
    rateBasis: step.rateBasis,
    inputs: toInputRows(step.inputs),
    outputs: toOutputRows(step.outputs),
    expectedYield: num(step.expectedYield),
    tolerancePct: num(step.tolerancePct),
    plannedInputQty: null,
    remarks: step.remarks,
  }));
}

/** Closing an order short appends `Closed short: <reason>` to its remarks
 * (`shortCloseJobOrder`). That line is how the PREVIOUS run ended — carried into
 * a clone it would read as a note about work nobody has started yet. */
function stripClosureNotes(remarks: string | null | undefined): string {
  if (!remarks) return '';
  return remarks
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('Closed short:'))
    .join('\n')
    .trim();
}

function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * The job order create/edit form.
 *
 * WHAT THE ROUTE ACTUALLY DOES HERE, AND WHAT IT DOES NOT
 *
 * Picking a route COPIES its steps into the grid, once, and then lets go. There
 * is no live link: the steps are yours to edit from that moment, and editing the
 * route later changes nothing here (field-sources §2.4). That is why choosing a
 * route replaces the grid instead of locking it — and why a job order with no
 * route at all is completely normal, with the steps typed by hand.
 */
export function JobOrderForm({
  initialData,
  isClone = false,
  onSubmit,
  isPending,
  onCancel,
  fieldErrors,
}: Props) {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const isEdit = Boolean(initialData?.id) && !isClone;

  /** `null` = "follow the series"; a string = the number the user typed over it. */
  const [typedNumber, setTypedNumber] = useState<string | null>(null);
  const [isNumberConfigOpen, setIsNumberConfigOpen] = useState(false);
  const [routeId, setRouteId] = useState<string>(initialData?.routeId ?? '');
  const [orderDate, setOrderDate] = useState(
    (isClone ? '' : toDateInput(initialData?.orderDate)) || new Date().toISOString().slice(0, 10),
  );
  const [targetDate, setTargetDate] = useState(isClone ? '' : toDateInput(initialData?.targetDate));
  const [ownership, setOwnership] = useState(initialData?.ownership ?? 'own');
  const [ownerPartyId, setOwnerPartyId] = useState<string | null>(
    initialData?.ownerPartyId ?? null,
  );
  const [remarks, setRemarks] = useState(
    (isClone ? stripClosureNotes(initialData?.remarks) : initialData?.remarks) ?? '',
  );
  const [steps, setSteps] = useState<JobOrderStepData[]>(toFormSteps(initialData, isClone));
  const [customFields, setCustomFields] = useState<CustomFieldValues>(
    (initialData?.customFields as CustomFieldValues) ?? {},
  );
  /** Read here, not just inside the section, so the HEADING goes with it. An org
   * that has defined no job order fields otherwise gets a "Custom Fields" title
   * over a centred paragraph about Settings → Modules — a screenful of a feature
   * they did not ask about, in the middle of the form. */
  const { data: customFieldDefs = [] } = useActiveCustomFields(orgId, 'job_order');
  const [localError, setLocalError] = useState<string | null>(null);

  /**
   * 🔴 HOW MUCH OF THE GRID IS FROZEN — everything up to and including the last
   * step that has started (§6.6). Behind that line challans point at the rows by
   * id and their `seq` is printed on paperwork; past it the grid is the plan and
   * is edited freely.
   *
   * Read off `status`, which is `pending` until a step issues something. That is a
   * close mirror of the server's rule and not the rule itself — the server counts
   * live documents, and a step short-closed with nothing issued would read as
   * locked here and be editable there. Erring toward MORE locked is the safe
   * direction: the save is refused with a message, never silently misapplied.
   */
  const lockedCount = isClone
    ? 0 // Nothing has run on THIS order yet — the source's work front is not its.
    : (initialData?.steps ?? []).reduce(
        (count, step, index) => (step.status !== 'pending' ? index + 1 : count),
        0,
      );

  const { data: routesPage } = useQuery({
    queryKey: ['routes', orgId, 'job-order-form'],
    queryFn: () => fetchRoutes(orgId!, { perPage: 500 }),
    enabled: Boolean(orgId),
  });
  const routes = routesPage?.results ?? [];

  /**
   * The numbering series. Read only when creating — an existing order already has
   * its number, and that number is on every challan raised against it.
   */
  const { data: numberPreference } = useQuery({
    queryKey: ['job-order-number-preference', orgId],
    queryFn: () => fetchJobOrderNumberPreference(orgId!),
    enabled: Boolean(orgId) && !isEdit,
  });

  /**
   * What the field shows: whatever the user typed, or — while they have typed
   * nothing — the number the series would hand out. DERIVED, not copied into
   * state by an effect: an effect would fight the user, overwriting a typed
   * number the moment the preference refetched.
   */
  const offeredNumber = numberPreference ? formatJobOrderNumber(numberPreference) : '';
  const jobOrderNumber = typedNumber ?? offeredNumber;

  const savePreference = useMutation({
    mutationFn: (data: { prefix: string; nextNumber: number }) =>
      updateJobOrderNumberPreference(orgId!, data),
    onSuccess: (pref) => {
      queryClient.setQueryData(['job-order-number-preference', orgId], pref);
      // Back to following the series — the dialog IS how you change the number
      // now, so anything typed before it was opened is stale.
      setTypedNumber(null);
      setIsNumberConfigOpen(false);
    },
  });

  const { data: customersPage } = useQuery({
    queryKey: ['customers', orgId, 'owner-party'],
    queryFn: () => fetchCustomers(orgId!, { perPage: 500 }),
    enabled: Boolean(orgId) && ownership === 'customer',
  });
  const customers = customersPage?.results ?? [];

  /**
   * The input unit is the item's stocking unit and is READ-ONLY: one item, one
   * stocking unit (§5.1). A balance is always one number in one unit, so letting
   * this be chosen per order would make two orders' quantities incomparable.
   */

  /**
   * Fill the grid from a route.
   *
   * 🔴 THE FILL IS SYNCHRONOUS WHEREVER IT CAN BE. The route dropdown is fed by a
   * list that already carries every step, so the grid is replaced in the same tick
   * as the selection. It used to always await `fetchRouteById` and, because the
   * call sat behind a bare `void`, ANY failure on that request — a 404 on a route
   * deleted in another tab, an offline blip — left the grid exactly as it was with
   * nothing on screen to say so. The fetch is now only the fallback, and when it
   * fails it says so.
   */
  const applyRoute = async (nextRouteId: string) => {
    setRouteId(nextRouteId);
    if (!nextRouteId) return;

    const listed = routes.find((r) => r.id === nextRouteId);
    if (listed?.steps.length) {
      setSteps(toGridSteps(listed));
      setLocalError(null);
      return;
    }

    try {
      const route = await fetchRouteById(orgId!, nextRouteId);
      if (route.steps.length === 0) {
        setLocalError(`"${route.name}" has no steps yet, so there was nothing to fill in.`);
        return;
      }
      setSteps(toGridSteps(route));
      setLocalError(null);
    } catch {
      setLocalError('Could not load that route’s steps. Pick it again, or add the steps by hand.');
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    const missing = steps.findIndex((s) => !s.processId);
    if (missing >= 0) {
      toast.error(`Step ${missing + 1} needs a process.`);
      return;
    }
    if (ownership === 'customer' && !ownerPartyId) {
      toast.error('Customer-owned work needs the customer it belongs to.');
      return;
    }
    // 🔴 At least one item, somewhere. A job order that consumes nothing has
    // nothing to issue, and the failure would otherwise surface days later as an
    // Issue dialog with no sections in it.
    const empty = steps.findIndex((s) => (s.inputs ?? []).length === 0);
    if (empty >= 0) {
      toast.error(`Step ${empty + 1} consumes nothing. Add at least one item to it.`);
      return;
    }

    const emptyOutput = steps.findIndex((s) => (s.outputs ?? []).length === 0);
    if (emptyOutput >= 0) {
      toast.error(`Step ${emptyOutput + 1} produces nothing.`);
      return;
    }
    setLocalError(null);

    onSubmit({
      // Create-only, and only when it differs from what the series would hand out
      // anyway: sending the offered number back would push the series past it a
      // second time, leaving a gap.
      ...(!isEdit && jobOrderNumber.trim() && jobOrderNumber.trim() !== offeredNumber
        ? { jobOrderNumber: jobOrderNumber.trim() }
        : {}),
      orderDate: orderDate || undefined,
      targetDate: targetDate || null,
      routeId: routeId || null,
      ownership,
      ownerPartyId: ownership === 'customer' ? ownerPartyId : null,
      /**
       * `plannedInputQty` is deliberately NOT sent. It is the principal input
       * row's quantity, and the server derives it from that row — sending it as
       * well would be the same number in two places, free to disagree the moment
       * somebody edits one of them.
       */
      steps: steps.map((step) => ({ ...step, plannedInputQty: null })),
      remarks: remarks.trim() || null,
      customFields,
    });
  };

  return (
    <>
      <div className="page-body">
        <form
          id="joborder-form"
          onSubmit={submit}
          noValidate
          style={{ padding: '12px 16px', paddingBottom: 120 }}
        >
          {localError && (
            <p
              style={{
                fontSize: 13,
                color: '#b91c1c',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 4,
                padding: '8px 12px',
                margin: '0 0 20px 0',
                maxWidth: 900,
              }}
              role="alert"
            >
              {localError}
            </p>
          )}

          <section style={{ marginBottom: 32 }}>
            <h2 style={sectionHeading}>Order</h2>

            <div
              className="form-field-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 16,
                maxWidth: 1200,
              }}
            >
              <div>
                <label style={labelStyle} htmlFor="jo-number">
                  Job Order Number
                </label>
                {isEdit ? (
                  <input
                    id="jo-number"
                    type="text"
                    value={initialData?.jobOrderNumber ?? ''}
                    readOnly
                    style={readOnlyStyle}
                  />
                ) : (
                  /* The gear belongs TO this field — it configures the number in it —
                 so it sits inside the box rather than floating beside it as a
                 second control. Still a real <button>, so Tab reaches it right
                 after the input (CLAUDE.md's tab rule). */
                  <div style={{ position: 'relative' }}>
                    <input
                      id="jo-number"
                      type="text"
                      value={jobOrderNumber}
                      onChange={(e) => setTypedNumber(e.target.value)}
                      placeholder="(auto)"
                      style={{
                        ...inputStyle,
                        padding: '6px 34px 6px 8px',
                        boxSizing: 'border-box',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setIsNumberConfigOpen(true)}
                      title="Configure job order numbering"
                      aria-label="Configure job order numbering"
                      style={{
                        position: 'absolute',
                        right: 3,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 26,
                        height: 26,
                        border: 'none',
                        borderRadius: 3,
                        background: 'transparent',
                        color: '#64748b',
                        cursor: 'pointer',
                      }}
                    >
                      <Settings size={15} />
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label style={labelStyle} htmlFor="jo-date">
                  Date
                </label>
                <DateInput
                  id="jo-date"
                  value={orderDate}
                  onChange={setOrderDate}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle} htmlFor="jo-target">
                  Target date
                </label>
                <DateInput
                  id="jo-target"
                  value={targetDate}
                  onChange={setTargetDate}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Route</label>
                <Select
                  value={routeId}
                  onChange={(value) => void applyRoute(value)}
                  options={[
                    { value: '', label: 'No route — build steps by hand' },
                    ...routes.map((r) => ({ value: r.id, label: r.name })),
                  ]}
                  ariaLabel="Route"
                  fullWidth
                />
              </div>

              <div>
                <label style={labelStyle}>Material belongs to</label>
                <Select
                  value={ownership}
                  onChange={(value) => {
                    setOwnership(value);
                    if (value !== 'customer') setOwnerPartyId(null);
                  }}
                  options={[...OWNERSHIP_OPTIONS]}
                  ariaLabel="Ownership"
                  fullWidth
                />
              </div>

              {ownership === 'customer' && (
                <div>
                  <label style={{ ...labelStyle, color: '#ef4444' }}>Customer*</label>
                  <Select
                    value={ownerPartyId ?? ''}
                    onChange={(value) => setOwnerPartyId(value || null)}
                    options={[
                      { value: '', label: 'Select a customer…' },
                      ...customers.map((c) => ({
                        value: c.id,
                        label: c.companyName || c.contactName,
                      })),
                    ]}
                    ariaLabel="Owning customer"
                    fullWidth
                  />
                </div>
              )}
            </div>

            <div style={{ marginTop: 16, maxWidth: 620 }}>
              <label style={labelStyle} htmlFor="jo-remarks">
                Remarks
              </label>
              <textarea
                id="jo-remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
              />
            </div>
          </section>

          <section style={{ marginBottom: 32 }}>
            <h2 style={sectionHeading}>Steps</h2>

            <StepsGrid
              steps={steps}
              onChange={setSteps}
              errors={fieldErrors}
              showPlannedQty
              /* 🔴 Job orders only — never on a route. A route is a template reused
             across runs and a batch is a specific roll that will be gone by the
             next one, so a route naming batches would be wrong the second time it
             was used, and silently. */
              allowPlannedBatches
              /* Decides which batches may even be offered: one customer's goods must
             never be planned into another's order (§5.3). */
              ownership={ownership}
              lockedCount={lockedCount}
            />
          </section>

          {customFieldDefs.length > 0 && (
            <section style={{ maxWidth: 900, marginBottom: 32 }}>
              <h2 style={sectionHeading}>Custom Fields</h2>
              {/* Same wrapping grid as the Order section above, so custom fields read
              as more fields on this form rather than a panel bolted to the end. */}
              <CustomFieldsSection
                orgId={orgId!}
                entityType="job_order"
                values={customFields}
                onChange={setCustomFields}
                errors={fieldErrors}
                applyDefaults={!isEdit}
                layout="grid"
              />
            </section>
          )}

          {isNumberConfigOpen && (
            <JobOrderNumberConfigModal
              onClose={() => setIsNumberConfigOpen(false)}
              isSaving={savePreference.isPending}
              initialPrefix={numberPreference?.prefix}
              initialNextNumber={
                numberPreference ? String(numberPreference.nextNumber).padStart(5, '0') : undefined
              }
              onSave={(prefix, nextNumber) =>
                savePreference.mutate({ prefix, nextNumber: parseInt(nextNumber, 10) || 1 })
              }
            />
          )}
        </form>
      </div>
      <div
        className="page-footer form-actions-footer"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '16px 32px',
          background: '#fff',
          borderTop: '1px solid #eef0f3',
          position: 'sticky',
          bottom: 0,
          zIndex: 100,
        }}
      >
        <button
          form="joborder-form"
          type="submit"
          disabled={isPending}
          style={{
            padding: '6px 20px',
            background: '#0062ff',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: 13,
          }}
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '6px 20px',
            background: 'white',
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
      </div>
    </>
  );
}
