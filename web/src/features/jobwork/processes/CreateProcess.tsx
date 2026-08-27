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

  const listPath = `/organizations/${orgId}/settings/jobwork/processes`;

  const mutation = useMutation({
    mutationFn: (data: CreateProcessData) => createProcess(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processes', orgId] });
      navigate(listPath);
    },
    // The `details` branch that routed `customFields.<key>` errors back to the
    // form went with the custom-fields section. Everything this endpoint can
    // still reject — a blank name, a duplicate — is one message.
    onError: (error: AxiosError<{ message?: string }>) => {
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
      <div style={{ padding: '0 0 44px 0' }}>
        <ProcessForm
          onSubmit={(data) => mutation.mutate(data)}
          isPending={mutation.isPending}
          onCancel={() => navigate(listPath)}
        />
      </div>
    </div>
  );
}
