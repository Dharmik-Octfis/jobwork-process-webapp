import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { ArrowLeft, Plus, Copy, AlertCircle, Save } from 'lucide-react';
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
      queryClient.invalidateQueries({ queryKey: ['job-orders', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-orders-count', orgId] });
      navigate(`/organizations/${orgId}/jobwork/job-orders?id=${data.id}`);
    },
    onError: (error: AxiosError<{ message?: string; details?: Record<string, string> }>) => {
      const details = error.response?.data?.details ?? {};
      setFieldErrors(details);
    },
  });

  const handleBack = () => {
    const returnUrl = (location.state as { returnUrl?: string })?.returnUrl;
    if (returnUrl) {
      navigate(returnUrl);
    } else if (cloneFrom) {
      navigate(`/organizations/${orgId}/jobwork/job-orders?id=${cloneFrom}`);
    } else {
      navigate(`/organizations/${orgId}/jobwork/job-orders`);
    }
  };

  return (
    <div className="page-container" style={{ background: '#f8fafc', minHeight: '100%' }}>
      {/* Executive Header Banner */}
      <header
        style={{
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          position: 'sticky',
          top: 0,
          zIndex: 20,
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
        }}
      >
        {/* Top Breadcrumb & Actions Bar */}
        <div
          style={{
            padding: '12px 24px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={handleBack}
              title="Back to Job Orders"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                background: '#fff',
                color: '#64748b',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f1f5f9';
                e.currentTarget.style.color = '#0f172a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#fff';
                e.currentTarget.style.color = '#64748b';
              }}
            >
              <ArrowLeft size={16} />
            </button>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: '#64748b',
              }}
            >
              <span
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/organizations/${orgId}/jobwork/job-orders`)}
              >
                Job Orders
              </span>
              <span>/</span>
              <span style={{ color: '#0f172a', fontWeight: 600 }}>
                {cloneFrom ? 'Clone Job Order' : 'New Job Order'}
              </span>
            </div>
          </div>

          {/* Top Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={handleBack}
              style={{
                padding: '7px 16px',
                fontSize: 13,
                fontWeight: 500,
                color: '#475569',
                background: '#fff',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f8fafc';
                e.currentTarget.style.color = '#0f172a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#fff';
                e.currentTarget.style.color = '#475569';
              }}
            >
              Cancel
            </button>
            <button
              form="joborder-form"
              type="submit"
              onClick={() => {
                const form = document.getElementById('joborder-form') as HTMLFormElement | null;
                if (form) form.requestSubmit();
              }}
              disabled={mutation.isPending}
              style={{
                padding: '7px 20px',
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                border: 'none',
                borderRadius: 6,
                cursor: mutation.isPending ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!mutation.isPending) {
                  e.currentTarget.style.boxShadow = '0 4px 10px rgba(2, 132, 199, 0.35)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!mutation.isPending) {
                  e.currentTarget.style.boxShadow = '0 2px 6px rgba(2, 132, 199, 0.25)';
                  e.currentTarget.style.transform = 'none';
                }
              }}
            >
              {mutation.isPending ? (
                <>
                  <Spinner size={14} label="Saving order..." />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Save size={15} />
                  <span>{cloneFrom ? 'Create Cloned Order' : 'Create Job Order'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Title Strip */}
        <div
          style={{
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 10px',
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 700,
                color: cloneFrom ? '#7c3aed' : '#0284c7',
                background: cloneFrom ? '#f5f3ff' : '#f0f9ff',
                border: `1px solid ${cloneFrom ? '#ddd6fe' : '#bae6fd'}`,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {cloneFrom ? <Copy size={11} /> : <Plus size={11} />}
              {cloneFrom ? 'Clone Order' : 'New Order'}
            </span>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>
              {cloneFrom ? 'Clone Job Order' : 'Create Job Order'}
            </h1>
            {source && (
              <span
                style={{
                  fontSize: 12,
                  color: '#475569',
                  background: '#f1f5f9',
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid #e2e8f0',
                }}
              >
                Copied from {source.jobOrderNumber} (new order number will be generated with fresh
                dates)
              </span>
            )}
          </div>
        </div>
      </header>

      {cloneFailed && (
        <div
          style={{
            margin: '16px 24px 0 24px',
            fontSize: 13,
            color: '#b91c1c',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
          role="alert"
        >
          <AlertCircle size={16} color="#dc2626" />
          <span>
            Could not load the source job order to copy. The form below is blank; please enter the
            details manually or go back and try cloning again.
          </span>
        </div>
      )}

      {isLoadingSource ? (
        <div style={{ padding: 64, display: 'flex', justifyContent: 'center' }}>
          <Spinner size={28} label="Loading template order to copy..." />
        </div>
      ) : (
        <JobOrderForm
          initialData={source}
          isClone={Boolean(cloneFrom)}
          onSubmit={(data) => {
            setFieldErrors({});
            mutation.mutate(data);
          }}
          isPending={mutation.isPending}
          onCancel={handleBack}
          fieldErrors={fieldErrors}
        />
      )}
    </div>
  );
}
