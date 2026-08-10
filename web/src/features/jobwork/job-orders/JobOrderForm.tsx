import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { Select } from '../../../components/ui/Select';
import { CustomFieldsSection } from '../../custom-fields/CustomFieldsSection';
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
  onSubmit: (data: CreateJobOrderData) => void;
  isPending: boolean;
  onCancel: () => void;
  fieldErrors?: Record<string, string>;
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

function toFormSteps(order?: Partial<JobOrder>): JobOrderStepData[] {
  if (!order?.steps?.length) return [emptyStep() as JobOrderStepData];
  return order.steps.map((step) => ({
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
export function JobOrderForm({ initialData, onSubmit, isPending, onCancel, fieldErrors }: Props) {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const isEdit = Boolean(initialData?.id);

  /** `null` = "follow the series"; a string = the number the user typed over it. */
  const [typedNumber, setTypedNumber] = useState<string | null>(null);
  const [isNumberConfigOpen, setIsNumberConfigOpen] = useState(false);
  const [routeId, setRouteId] = useState<string>(initialData?.routeId ?? '');
  const [orderDate, setOrderDate] = useState(
    toDateInput(initialData?.orderDate) || new Date().toISOString().slice(0, 10),
  );
  const [targetDate, setTargetDate] = useState(toDateInput(initialData?.targetDate));
  const [ownership, setOwnership] = useState(initialData?.ownership ?? 'own');
  const [ownerPartyId, setOwnerPartyId] = useState<string | null>(
    initialData?.ownerPartyId ?? null,
  );
  const [remarks, setRemarks] = useState(initialData?.remarks ?? '');
  const [steps, setSteps] = useState<JobOrderStepData[]>(toFormSteps(initialData));
  const [customFields, setCustomFields] = useState<CustomFieldValues>(
    (initialData?.customFields as CustomFieldValues) ?? {},
  );
  const [localError, setLocalError] = useState<string | null>(null);

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
      setLocalError(`Step ${missing + 1} needs a process.`);
      return;
    }
    if (ownership === 'customer' && !ownerPartyId) {
      setLocalError('Customer-owned work needs the customer it belongs to.');
      return;
    }
    // 🔴 At least one item, somewhere. A job order that consumes nothing has
    // nothing to issue, and the failure would otherwise surface days later as an
    // Issue dialog with no sections in it.
    const empty = steps.findIndex((s) => (s.inputs ?? []).length === 0);
    if (empty >= 0) {
      setLocalError(`Step ${empty + 1} consumes nothing. Add at least one item to it.`);
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
    <form onSubmit={submit} noValidate style={{ padding: '24px 32px', paddingBottom: 120 }}>
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
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16,
            maxWidth: 900,
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  id="jo-number"
                  type="text"
                  value={jobOrderNumber}
                  onChange={(e) => setTypedNumber(e.target.value)}
                  placeholder="(auto)"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => setIsNumberConfigOpen(true)}
                  title="Configure job order numbering"
                  aria-label="Configure job order numbering"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    minHeight: 32,
                    border: '1px solid #d1d5db',
                    borderRadius: 4,
                    background: '#fff',
                    color: '#64748b',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <Settings size={16} />
                </button>
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle} htmlFor="jo-date">
              Date
            </label>
            <input
              id="jo-date"
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="jo-target">
              Target date
            </label>
            <input
              id="jo-target"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
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
                  { value: '', label: 'Pick a customer…' },
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

        <StepsGrid steps={steps} onChange={setSteps} errors={fieldErrors} showPlannedQty />
      </section>

      <section style={{ maxWidth: 640, marginBottom: 32 }}>
        <h2 style={sectionHeading}>Custom Fields</h2>
        <CustomFieldsSection
          orgId={orgId!}
          entityType="job_order"
          values={customFields}
          onChange={setCustomFields}
          errors={fieldErrors}
          applyDefaults={!initialData?.id}
        />
      </section>

      <div
        style={{
          height: 44,
          boxSizing: 'border-box',
          position: 'fixed',
          bottom: 0,
          left: 220,
          right: 0,
          background: '#fff',
          padding: '0 24px',
          borderTop: '1px solid #eef0f3',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          zIndex: 100,
        }}
      >
        <button
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
  );
}
