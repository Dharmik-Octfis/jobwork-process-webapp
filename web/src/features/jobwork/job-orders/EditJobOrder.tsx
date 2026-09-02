import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { X } from 'lucide-react';
import { Spinner } from '../../../components/ui/Spinner';
import { fetchJobOrderById, updateJobOrder } from './jobOrders.api';
import type { UpdateJobOrderData } from './jobOrders.schemas';
import { JobOrderForm } from './JobOrderForm';

/**
 * 🔴 A RUNNING ORDER IS EDITABLE PAST ITS WORK FRONT (§6.6, 2026-08-11).
 *
 * This page used to refuse anything but a `draft`, because the whole grid was
 * frozen by the first issue. It is now frozen only up to the last step carrying a
 * live challan or receipt — the steps after it are still a plan, and correcting
 * step 4's processor should never have meant short-closing the order.
 *
 * A CLOSED order is still refused, and that refusal stays: `short_closed` and
 * `cancelled` are sticky, so the document would keep reading as finished while
 * its plan moved underneath it.
 *
 * The lock itself is drawn by `JobOrderForm` → `StepsGrid`, which greys the
 * frozen steps and says why. The server re-derives it from live documents and
 * refuses a stale form, so this page never has to be the thing that is right.
 */
export function EditJobOrder() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { orgId, id } = useParams<{ orgId: string; id: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Back to the LIST with this order still selected, not to the standalone
   * overview. The list's split view is where the Edit button was pressed from, so
   * it is where cancelling and saving return you — landing on a bare list, or on
   * a full-page overview with no list beside it, both read as having navigated
   * somewhere else. The selection is a query param precisely so it can be
   * restored like this.
   */
  const backPath = `/organizations/${orgId}/jobwork/job-orders?id=${id}`;

  const { data: jobOrder, isLoading } = useQuery({
    queryKey: ['job-order', orgId, id],
    queryFn: () => fetchJobOrderById(orgId!, id!),
    enabled: Boolean(orgId && id),
  });

  const mutation = useMutation({
    mutationFn: (data: UpdateJobOrderData) => updateJobOrder({ orgId: orgId!, id: id!, data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-orders', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-order', orgId, id] });
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, id] });
      navigate(backPath);
    },
    onError: (error: AxiosError<{ message?: string; details?: Record<string, string> }>) => {
      setFieldErrors(error.response?.data?.details ?? {});
      setMessage(error.response?.data?.message ?? 'Failed to update job order');
    },
  });

  if (isLoading) {
    return (
      <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
        <Spinner size={24} label="Loading job order" />
      </div>
    );
  }

  if (!jobOrder) {
    return <div style={{ padding: 32, color: '#64748b', fontSize: 13 }}>Job order not found.</div>;
  }

  if (jobOrder.status === 'short_closed' || jobOrder.status === 'cancelled') {
    return (
      <div style={{ padding: '32px 40px', maxWidth: 620 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: '0 0 8px 0' }}>
          {jobOrder.jobOrderNumber} is closed
        </h1>
        <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, margin: '0 0 20px 0' }}>
          This order has been closed, so its steps can no longer be changed — it would read as
          finished while its plan moved underneath it. If there is more work to do, raise a new
          order.
        </p>
        <button
          type="button"
          onClick={() => navigate(backPath)}
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
          Back to the job order
        </button>
      </div>
    );
  }

  return (
    <div
      style={{ background: '#fff', minHeight: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '16px 24px',
          borderBottom: '1px solid #eef0f3',
          justifyContent: 'space-between',
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: 0 }}>
          {jobOrder.jobOrderNumber}
        </h1>
        <button
          type="button"
          onClick={() => navigate(backPath)}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px',
            borderRadius: '4px',
          }}
        >
          <X size={20} />
        </button>
      </header>
      {message && (
        <p
          style={{
            fontSize: 13,
            color: '#b91c1c',
            background: '#fef2f2',
            borderBottom: '1px solid #fecaca',
            padding: '10px 24px',
            margin: 0,
          }}
          role="alert"
        >
          {message}
        </p>
      )}
      <div style={{ padding: '0 0 44px 0' }}>
        <JobOrderForm
          initialData={jobOrder}
          // Material In posted its ledger rows when the order was created. There
          // is no second one: correcting posted stock is an adjustment, not an edit.
          onSubmit={(data) => {
            setFieldErrors({});
            setMessage(null);
            mutation.mutate(data);
          }}
          isPending={mutation.isPending}
          onCancel={() => navigate(backPath)}
          fieldErrors={fieldErrors}
        />
      </div>
    </div>
  );
}
