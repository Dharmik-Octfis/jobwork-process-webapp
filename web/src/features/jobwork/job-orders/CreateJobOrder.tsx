import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { X } from 'lucide-react';
import { Spinner } from '../../../components/ui/Spinner';
import { createJobOrder, fetchJobOrderById } from './jobOrders.api';
import type { CreateJobOrderData } from './jobOrders.schemas';
import { JobOrderForm } from './JobOrderForm';

export function CreateJobOrder() {
  const navigate = useNavigate();
  const location = useLocation();
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['jobOrders', orgId] });
      navigate(`/organizations/${orgId}/jobwork/job-orders?id=${data.id}`);
    },
    onError: (error: AxiosError<{ message?: string; details?: Record<string, string> }>) => {
      setFieldErrors(error.response?.data?.details ?? {});
      setMessage(error.response?.data?.message ?? 'Failed to create job order');
    },
  });

  return (
    <div className="page-container" style={{ background: '#fff' }}>
      <header
        className="page-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '16px 24px',
          borderBottom: '1px solid #eef0f3',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: 0 }}>
            {cloneFrom ? 'Clone Job Order' : 'New Job Order'}
          </h1>
          {source && (
            <span style={{ fontSize: 12, color: '#64748b' }}>
              Copied from {source.jobOrderNumber} — it gets its own number, and the dates start blank.
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            const returnUrl = (location.state as { returnUrl?: string })?.returnUrl;
            if (returnUrl) {
              navigate(returnUrl);
            } else if (cloneFrom) {
              navigate(`/organizations/${orgId}/jobwork/job-orders?id=${cloneFrom}`);
            } else {
              navigate(-1);
            }
          }}
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
        {/* The form seeds its state ONCE from `initialData`, so it must not mount
            before the order being copied has arrived — it would render blank and
            stay blank. */}
        {isLoadingSource ? (
          <div className="page-body" style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
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
            onCancel={() => {
              const returnUrl = (location.state as { returnUrl?: string })?.returnUrl;
              if (returnUrl) {
                navigate(returnUrl);
              } else if (cloneFrom) {
                navigate(`/organizations/${orgId}/jobwork/job-orders?id=${cloneFrom}`);
              } else {
                navigate(`/organizations/${orgId}/jobwork/job-orders`);
              }
            }}
            fieldErrors={fieldErrors}
          />
        )}
    </div>
  );
}
