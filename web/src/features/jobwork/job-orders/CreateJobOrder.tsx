import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { BackButton } from '../../../components/ui/BackButton';
import { Spinner } from '../../../components/ui/Spinner';
import { createJobOrder, fetchJobOrderById } from './jobOrders.api';
import type { CreateJobOrderData } from './jobOrders.schemas';
import { JobOrderForm } from './JobOrderForm';

export function CreateJobOrder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { orgId } = useParams<{ orgId: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Clone lives in the URL rather than in router state, so the half-filled form
   * survives a reload and the link can be handed to somebody — the same contract
   * `?cloneFrom=` already has on Purchase Orders. The source is fetched here and
   * stripped of its identity by `JobOrderForm` (`isClone`).
   */
  const [searchParams] = useSearchParams();
  const cloneFrom = searchParams.get('cloneFrom');

  const {
    data: source,
    isLoading: isLoadingSource,
    isError: cloneFailed,
  } = useQuery({
    queryKey: ['job-order', orgId, cloneFrom],
    queryFn: () => fetchJobOrderById(orgId!, cloneFrom!),
    enabled: Boolean(orgId && cloneFrom),
  });

  const mutation = useMutation({
    mutationFn: (data: CreateJobOrderData) => createJobOrder(orgId!, data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['job-orders', orgId] });
      // Straight to the Overview, not back to the list: the next thing anyone
      // does with a new job order is issue material against step 1.
      navigate(`/organizations/${orgId}/jobwork/job-orders/${created.id}`);
    },
    onError: (error: AxiosError<{ message?: string; details?: Record<string, string> }>) => {
      setFieldErrors(error.response?.data?.details ?? {});
      setMessage(error.response?.data?.message ?? 'Failed to create job order');
    },
  });

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
        <BackButton
          onClick={() => navigate(`/organizations/${orgId}/jobwork/job-orders`)}
          label="Back to job orders"
        />
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: 0 }}>
          {cloneFrom ? 'Clone Job Order' : 'New Job Order'}
        </h1>
        {source && (
          <span style={{ fontSize: 12, color: '#64748b' }}>
            Copied from {source.jobOrderNumber} — it gets its own number, and the dates start blank.
          </span>
        )}
      </header>
      {cloneFailed && (
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
          Could not load the job order to copy. This form is blank — fill it in by hand, or go back
          and clone again.
        </p>
      )}
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
        {/* The form seeds its state ONCE from `initialData`, so it must not mount
            before the order being copied has arrived — it would render blank and
            stay blank. */}
        {isLoadingSource ? (
          <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
            <Spinner size={24} label="Loading the job order to copy" />
          </div>
        ) : (
          <JobOrderForm
            initialData={source}
            isClone={Boolean(cloneFrom)}
            onSubmit={(data) => {
              setFieldErrors({});
              setMessage(null);
              mutation.mutate(data);
            }}
            isPending={mutation.isPending}
            onCancel={() => navigate(`/organizations/${orgId}/jobwork/job-orders`)}
            fieldErrors={fieldErrors}
          />
        )}
      </div>
    </div>
  );
}
