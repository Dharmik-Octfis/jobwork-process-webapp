import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { BackButton } from '../../../components/ui/BackButton';
import { Spinner } from '../../../components/ui/Spinner';
import { fetchJobOrderById, updateJobOrder } from './jobOrders.api';
import type { UpdateJobOrderData } from './jobOrders.schemas';
import { JobOrderForm } from './JobOrderForm';

/**
 * Editing is only possible while the order is still `draft` — the server refuses
 * it otherwise, and this page says so rather than letting someone fill in a form
 * that cannot save. Once a step has issued anything, its rate and processor are
 * on a challan a processor is holding, and the issue documents reference the step
 * by id.
 */
export function EditJobOrder() {
  const navigate = useNavigate();
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

  if (jobOrder.status !== 'draft') {
    return (
      <div style={{ padding: '32px 40px', maxWidth: 620 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: '0 0 8px 0' }}>
          {jobOrder.jobOrderNumber} has already started
        </h1>
        <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, margin: '0 0 20px 0' }}>
          Material has been issued against this order, so its steps can no longer be changed — the
          rate and processor on each step are on paperwork somebody is holding, and the challans
          already raised point at those steps. If the plan has changed, close this order short and
          raise a new one.
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
        }}
      >
        <BackButton onClick={() => navigate(backPath)} label="Back to the job order" />
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: 0 }}>
          {jobOrder.jobOrderNumber}
        </h1>
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
      <div style={{ flex: 1, overflowY: 'auto' }}>
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
