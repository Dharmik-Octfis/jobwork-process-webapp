import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { X } from 'lucide-react';
import { createRoute } from './processRoutes.api';
import type { CreateRouteData } from './processRoutes.schemas';
import { RouteForm } from './RouteForm';

export function CreateRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { orgId } = useParams<{ orgId: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const listPath = `/organizations/${orgId}/settings/jobwork/routes`;

  const mutation = useMutation({
    mutationFn: (data: CreateRouteData) => createRoute(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes', orgId] });
      navigate(listPath);
    },
    onError: (error: AxiosError<{ message?: string; details?: Record<string, string> }>) => {
      // The chain check returns `details` keyed `steps.<n>.issueItemId`, which the
      // grid highlights on the offending row. The message goes above the form
      // because it names two steps and belongs to neither.
      setFieldErrors(error.response?.data?.details ?? {});
      setMessage(error.response?.data?.message ?? 'Failed to create route');
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
          justifyContent: 'space-between',
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: 0 }}>
          New Process Route
        </h1>
        <button
          type="button"
          onClick={() => navigate(listPath)}
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
        <RouteForm
          onSubmit={(data) => {
            setFieldErrors({});
            setMessage(null);
            mutation.mutate(data);
          }}
          isPending={mutation.isPending}
          onCancel={() => navigate(listPath)}
          fieldErrors={fieldErrors}
        />
      </div>
    </div>
  );
}
