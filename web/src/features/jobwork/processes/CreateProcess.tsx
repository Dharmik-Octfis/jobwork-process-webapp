import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { BackButton } from '../../../components/ui/BackButton';
import { createProcess } from './processes.api';
import type { CreateProcessData } from './processes.schemas';
import { ProcessForm } from './ProcessForm';

export function CreateProcess() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { orgId } = useParams<{ orgId: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const listPath = `/organizations/${orgId}/jobwork/processes`;

  const mutation = useMutation({
    mutationFn: (data: CreateProcessData) => createProcess(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processes', orgId] });
      navigate(listPath);
    },
    onError: (error: AxiosError<{ message?: string; details?: Record<string, string> }>) => {
      const details = error.response?.data?.details;
      // Custom-field errors arrive keyed `customFields.<key>` and belong beside
      // the field, not in an alert.
      if (details && typeof details === 'object' && !Array.isArray(details)) {
        setFieldErrors(details);
        return;
      }
      alert(error.response?.data?.message || 'Failed to create process');
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
        <BackButton onClick={() => navigate(listPath)} label="Back to processes" />
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: 0 }}>New Process</h1>
      </header>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <ProcessForm
          onSubmit={(data) => {
            setFieldErrors({});
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
