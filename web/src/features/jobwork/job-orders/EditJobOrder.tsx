import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { ArrowLeft, Pencil, Save, AlertCircle } from 'lucide-react';
import { Spinner } from '../../../components/ui/Spinner';
import { fetchJobOrderById, updateJobOrder } from './jobOrders.api';
import type { UpdateJobOrderData } from './jobOrders.schemas';
import { JobOrderForm } from './JobOrderForm';
import { JobOrderStatusBadge } from './JobOrderStatusBadge';

/**
 * A running order is editable past its work front.
 * Steps prior to active challans/receipts are frozen; subsequent planned steps remain editable.
 */
export function EditJobOrder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { orgId, id } = useParams<{ orgId: string; id: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
      setFieldErrors(details);
    },
  });

  if (isLoading) {
    return (
      <div style={{ padding: 64, display: 'flex', justifyContent: 'center' }}>
        <Spinner size={28} label="Loading job order details..." />
      </div>
    );
  }

  if (!jobOrder) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
        Job order not found.
      </div>
    );
  }

  if (jobOrder.status === 'short_closed' || jobOrder.status === 'cancelled') {
    return (
      <div style={{ padding: '40px 48px', maxWidth: 640, margin: '40px auto' }}>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: '32px 36px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: '#fef2f2',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto',
            }}
          >
            <AlertCircle size={28} />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: '0 0 10px 0' }}>
            {jobOrder.jobOrderNumber} is closed
          </h1>
          <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 24px 0' }}>
            This order has been closed, so its steps can no longer be modified. If there is more
            production work to perform, please raise a new job order.
          </p>
          <button
            type="button"
            onClick={() => navigate(backPath)}
            style={{
              padding: '9px 24px',
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
            Back to Job Order
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="page-container"
      style={{
        background: '#f8fafc',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* Executive Header Banner */}
      <header
        style={{
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          position: 'sticky',
          top: 0,
          flexShrink: 0,
          zIndex: 10,
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
              onClick={() => navigate(backPath)}
              title="Back to Job Order"
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
              <span style={{ cursor: 'pointer' }} onClick={() => navigate(backPath)}>
                {jobOrder.jobOrderNumber}
              </span>
              <span>/</span>
              <span style={{ color: '#0f172a', fontWeight: 600 }}>Edit</span>
            </div>
          </div>

          {/* Top Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => navigate(backPath)}
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
                  <Spinner size={14} label="Saving changes..." />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save size={15} />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Title & Status Strip */}
        <div
          style={{
            padding: '14px 24px',
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
                color: '#0284c7',
                background: '#f0f9ff',
                border: '1px solid #bae6fd',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <Pencil size={11} /> Edit Mode
            </span>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>
              {jobOrder.jobOrderNumber}
            </h1>
            <JobOrderStatusBadge status={jobOrder.status} size="md" />
          </div>
        </div>
      </header>

      {/* Main Form Content directly in flex container so .page-body scrolls */}
      <JobOrderForm
        initialData={jobOrder}
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
