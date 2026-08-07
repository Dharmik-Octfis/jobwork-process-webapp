import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { BackButton } from '../../../components/ui/BackButton';
import { createJobOrder } from './jobOrders.api';
import type { CreateJobOrderData } from './jobOrders.schemas';
import { JobOrderForm } from './JobOrderForm';

export function CreateJobOrder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { orgId } = useParams<{ orgId: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

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
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: 0 }}>New Job Order</h1>
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
          onSubmit={(data) => {
            setFieldErrors({});
            setMessage(null);
            mutation.mutate(data);
          }}
          isPending={mutation.isPending}
          onCancel={() => navigate(`/organizations/${orgId}/jobwork/job-orders`)}
          fieldErrors={fieldErrors}
        />
      </div>
    </div>
  );
}
