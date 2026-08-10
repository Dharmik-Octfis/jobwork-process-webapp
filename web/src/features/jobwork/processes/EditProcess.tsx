import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { BackButton } from '../../../components/ui/BackButton';
import { Spinner } from '../../../components/ui/Spinner';
import { fetchProcessById, updateProcess } from './processes.api';
import type { UpdateProcessData } from './processes.schemas';
import { ProcessForm } from './ProcessForm';

export function EditProcess() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { orgId, id } = useParams<{ orgId: string; id: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const listPath = `/organizations/${orgId}/settings/jobwork/processes`;
  /** Back to the list with this row still open — the split view is where Edit was
   * pressed from, and a bare list reads as having navigated somewhere else. */
  const backPath = `${listPath}?id=${id}`;

  const { data: process, isLoading } = useQuery({
    // orgId in the key: switching organization must not serve the previous
    // tenant's cached record.
    queryKey: ['process', orgId, id],
    queryFn: () => fetchProcessById(orgId!, id!),
    enabled: Boolean(orgId && id),
  });

  const mutation = useMutation({
    mutationFn: (data: UpdateProcessData) => updateProcess({ orgId: orgId!, id: id!, data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processes', orgId] });
      queryClient.invalidateQueries({ queryKey: ['process', orgId, id] });
      navigate(backPath);
    },
    onError: (error: AxiosError<{ message?: string; details?: Record<string, string> }>) => {
      const details = error.response?.data?.details;
      if (details && typeof details === 'object' && !Array.isArray(details)) {
        setFieldErrors(details);
        return;
      }
      alert(error.response?.data?.message || 'Failed to update process');
    },
  });

  if (isLoading) {
    return (
      <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
        <Spinner size={24} label="Loading process" />
      </div>
    );
  }

  if (!process) {
    return <div style={{ padding: 48, color: '#64748b' }}>Process not found.</div>;
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
        <BackButton onClick={() => navigate(backPath)} label="Back to the process" />
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: 0 }}>{process.name}</h1>
      </header>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <ProcessForm
          initialData={process}
          onSubmit={(data) => {
            setFieldErrors({});
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
