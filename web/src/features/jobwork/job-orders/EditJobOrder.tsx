import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
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
  const queryClient = useQueryClient();
  const { orgId, id } = useParams<{ orgId: string; id: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
      const details = error.response?.data?.details ?? {};
      // Highlight only — the global mutation handler shows the one toast (app/queryClient.ts).
      setFieldErrors(details);
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
            padding: '7px 20px',
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
            boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
          }}
        >
          Back to the job order
        </button>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ background: '#fff' }}>
      <header
        className="page-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '16px 24px',
          borderBottom: '1px solid #e2e8f0',
          justifyContent: 'space-between',
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>
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
            padding: '6px',
            borderRadius: '6px',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f1f5f9';
            e.currentTarget.style.color = '#0f172a';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none';
            e.currentTarget.style.color = '#64748b';
          }}
        >
          <X size={18} />
        </button>
      </header>
      <JobOrderForm
        initialData={jobOrder}
        // Material In posted its ledger rows when the order was created. There
        // is no second one: correcting posted stock is an adjustment, not an edit.
        onSubmit={(data) => {
          setFieldErrors({});
          mutation.mutate(data);
        }}
        isPending={mutation.isPending}
        onCancel={() => navigate(backPath)}
        fieldErrors={fieldErrors}
      />
    </div>
  );
}
