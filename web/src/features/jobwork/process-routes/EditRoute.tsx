import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { X } from 'lucide-react';
import { Spinner } from '../../../components/ui/Spinner';
import { fetchRouteById, updateRoute } from './processRoutes.api';
import type { UpdateRouteData } from './processRoutes.schemas';
import { RouteForm } from './RouteForm';

export function EditRoute() {
  const navigate = useNavigate();  const queryClient = useQueryClient();
  const { orgId, id } = useParams<{ orgId: string; id: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const listPath = `/organizations/${orgId}/settings/jobwork/routes`;
  /** Back to the list with this row still open — the split view is where Edit was
   * pressed from, and a bare list reads as having navigated somewhere else. */
  const backPath = `${listPath}?id=${id}`;

  const { data: route, isLoading } = useQuery({
    queryKey: ['route', orgId, id],
    queryFn: () => fetchRouteById(orgId!, id!),
    enabled: Boolean(orgId && id),
  });

  const mutation = useMutation({
    mutationFn: (data: UpdateRouteData) => updateRoute({ orgId: orgId!, id: id!, data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes', orgId] });
      queryClient.invalidateQueries({ queryKey: ['route', orgId, id] });
      navigate(backPath);
    },
    onError: (error: AxiosError<{ message?: string; details?: Record<string, string> }>) => {
      setFieldErrors(error.response?.data?.details ?? {});
      setMessage(error.response?.data?.message ?? 'Failed to update route');
    },
  });

  if (isLoading) {
    return (
      <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
        <Spinner size={24} label="Loading route" />
      </div>
    );
  }

  if (!route) {
    return <div style={{ padding: 32, color: '#64748b', fontSize: 13 }}>Route not found.</div>;
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
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: 0 }}>{route.name}</h1>
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
        <RouteForm
          initialData={route}
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
