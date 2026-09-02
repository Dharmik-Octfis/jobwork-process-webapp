import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createLocation, type CreateLocationData } from './locations.api';
import { LocationForm } from './LocationForm';

export function CreateLocation() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: CreateLocationData) => createLocation(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations', orgId] });
      (location.state as any)?.returnUrl ? navigate((location.state as any).returnUrl) : navigate(`/organizations/${orgId}/settings/locations`);
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      alert(err.response?.data?.message || err.message || 'Failed to create location');
    },
  });

  return (
    <div style={{ background: '#fff', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '16px 24px', borderBottom: '1px solid #eef0f3' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#000', margin: 0 }}>Add Location</h1>
      </header>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <LocationForm
          onSubmit={(data) => mutation.mutate(data)}
          isPending={mutation.isPending}
          onCancel={() => (location.state as any)?.returnUrl ? navigate((location.state as any).returnUrl) : navigate(`/organizations/${orgId}/settings/locations`)}
        />
      </div>
    </div>
  );
}
