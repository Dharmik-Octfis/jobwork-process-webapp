import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { Modal } from '../../../components/ui/Modal';
import { StepsGrid } from '../StepsGrid';
import { emptyStep, emptyStepItem, toNumber } from '../jobwork.schemas';
import { appendJobOrderSteps } from './jobOrders.api';
import type { JobOrderStepData, OverviewStep } from './jobOrders.schemas';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  jobOrderId: string;
  jobOrderNumber: string;
  /** own | customer, from the order. Decides which batches the planner may name —
   * one customer's goods must never be planned into another's order (§5.3). */
  ownership: string;
  /** Every step already on the order, in seq order. */
  steps: OverviewStep[];
  onAdded: () => void;
}

/**
 * Add work to the END of an order that has already started.
 *
 * 🔴 APPEND ONLY, and the dialog says so rather than offering a position box. The
 * safety of this whole feature rests on nothing being renumbered: every existing
 * step keeps the number printed on the challans raised against it. A "where?"
 * control here would quietly hand that away.
 *
 * 🔴 NO STEP'S STATUS IS CONSULTED — not the last one's, not any. A step appended
 * after one that is pending, at a processor, or complete is the same step: it
 * arrives `pending`, and the chain rule the server already enforces
 * (`chainNotReady`) refuses to let it issue until the step above has returned
 * something. The only refusal is on the ORDER, and it is the server's: an order
 * closed short or cancelled takes no more work.
 *
 * The grid is `StepsGrid` — the same control the create form uses, not a second
 * copy of it. `seqOffset` makes its captions read "Step 4" instead of "Step 1",
 * and `priorProducers` lets the chain badge see the steps already on the order, so
 * an input fed by step 3 is not labelled "From stock".
 */
export function AddStepsDialog({
  isOpen,
  onClose,
  jobOrderId,
  jobOrderNumber,
  ownership,
  steps,
  onAdded,
}: Props) {
  const { orgId } = useParams<{ orgId: string }>();

  /**
   * The new step is SEEDED from what the last existing step produces — carrying
   * on from the step above is the normal case. A real, editable row rather than
   * something the server adds on save, the same call `StepsGrid`'s own Add step
   * makes.
   */
  const seed = (): JobOrderStepData[] => {
    const last = steps[steps.length - 1];
    const carriedOn =
      (last?.itemTotals.outputs.find((row) => row.isPrimary) ?? last?.itemTotals.outputs[0])
        ?.itemId ?? null;
    const next = emptyStep() as JobOrderStepData;
    return [carriedOn ? { ...next, inputs: [{ ...emptyStepItem(), itemId: carriedOn }] } : next];
  };

  const [rows, setRows] = useState<JobOrderStepData[]>(seed);
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  /** `itemId → seq` for everything the order already produces. Latest producer
   * wins: an item made twice is fed by the nearest step above. */
  const priorProducers = new Map<string, number>();
  for (const step of steps) {
    for (const output of step.itemTotals.outputs) priorProducers.set(output.itemId, step.seq);
  }

  /**
   * …and how much of each is still SPARE — what those steps expect to produce,
   * less what they already plan to consume of it. NET, or the over-plan note
   * would offer an appended step panels that step 3 is already eating.
   *
   * Read off the plan (`inputs`/`outputs`), not off `itemTotals`, which carries
   * what has MOVED. A step that has issued nothing yet still has an expectation,
   * and that is the number the new step is being measured against.
   */
  const priorSpare = new Map<string, number>();
  for (const step of steps) {
    for (const output of step.outputs) {
      if (output.expectedQty === null || output.expectedQty === undefined) continue;
      priorSpare.set(
        output.itemId,
        (priorSpare.get(output.itemId) ?? 0) + toNumber(output.expectedQty),
      );
    }
    for (const input of step.inputs) {
      if (input.fromStock || input.plannedQty === null || input.plannedQty === undefined) continue;
      priorSpare.set(
        input.itemId,
        (priorSpare.get(input.itemId) ?? 0) - toNumber(input.plannedQty),
      );
    }
  }

  const startSeq = (steps[steps.length - 1]?.seq ?? 0) + 1;

  const mutation = useMutation({
    mutationFn: () =>
      appendJobOrderSteps({
        orgId: orgId!,
        id: jobOrderId,
        // `plannedInputQty` is the principal row's quantity and the server derives
        // it from that row — sending it too is the same number in two places.
        steps: rows.map((row) => ({ ...row, plannedInputQty: null })),
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      onAdded();
      onClose();
    },
    onError: (error: AxiosError<{ message?: string; details?: Record<string, string> }>) => {
      setFieldErrors(error.response?.data?.details ?? {});
      setMessage(error.response?.data?.message ?? 'Could not add the step.');
    },
  });

  const submit = () => {
    const missing = rows.findIndex((row) => !row.processId);
    if (missing >= 0) {
      setMessage(`Step ${startSeq + missing} needs a process.`);
      return;
    }
    // A step that consumes nothing has nothing to issue, and the failure would
    // otherwise surface days later as an Issue dialog with no sections in it.
    const empty = rows.findIndex((row) => (row.inputs ?? []).length === 0);
    if (empty >= 0) {
      setMessage(`Step ${startSeq + empty} consumes nothing. Add at least one item to it.`);
      return;
    }
    setMessage(null);
    setFieldErrors({});
    mutation.mutate();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Add work to ${jobOrderNumber}`}
      footer={
        <>
          <button
            type="button"
            onClick={submit}
            disabled={mutation.isPending}
            style={{
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 500,
              border: 'none',
              borderRadius: 4,
              background: '#0062ff',
              color: '#fff',
              cursor: mutation.isPending ? 'not-allowed' : 'pointer',
              opacity: mutation.isPending ? 0.6 : 1,
            }}
          >
            {mutation.isPending ? 'Adding…' : `Add step${rows.length === 1 ? '' : 's'}`}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 16px',
              fontSize: 13,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              background: '#fff',
              color: '#333',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </>
      }
    >
      {message && (
        <p
          role="alert"
          style={{
            fontSize: 13,
            color: '#b91c1c',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 4,
            padding: '8px 12px',
            margin: '0 0 14px 0',
          }}
        >
          {message}
        </p>
      )}

      <StepsGrid
        steps={rows}
        onChange={setRows}
        errors={fieldErrors}
        disabled={mutation.isPending}
        showPlannedQty
        allowPlannedBatches
        ownership={ownership}
        seqOffset={startSeq - 1}
        priorProducers={priorProducers}
        priorSpare={priorSpare}
        /* Inside a Modal — the item picker's menu is clipped by the dialog's
           scrolling body without this (CLAUDE.md). */
        portalMenus
      />

      <div style={{ marginTop: 16 }}>
        <label
          htmlFor="append-reason"
          style={{
            display: 'block',
            fontSize: 11,
            fontWeight: 600,
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            marginBottom: 4,
          }}
        >
          Why
        </label>
        <input
          id="append-reason"
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={mutation.isPending}
          placeholder="Party asked for an extra finishing pass"
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: 13,
            border: '1px solid #d1d5db',
            borderRadius: 4,
            minHeight: 32,
          }}
        />
      </div>
    </Modal>
  );
}
