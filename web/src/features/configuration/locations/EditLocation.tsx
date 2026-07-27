import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLocationById, updateLocation, type CreateLocationData } from './locations.api';
import { LocationForm } from './LocationForm';

export function EditLocation() {
  const navigate = useNavigate();
  const { orgId, id } = useParams<{ orgId: string; id: string }>();
  const queryClient = useQueryClient();

  const { data: location, isLoading } = useQuery({
    queryKey: ['locations', orgId, id],
    queryFn: () => fetchLocationById(orgId!, id!),
    enabled: Boolean(orgId && id),
  });

  const mutation = useMutation({
    mutationFn: (data: CreateLocationData) => updateLocation({ orgId: orgId!, id: id!, data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations', orgId] });
      navigate(`/organizations/${orgId}/settings/locations`);
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      alert(err.response?.data?.message || err.message || 'Failed to update location');
    },
  });

  if (isLoading) {
    return <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>Loading...</div>;
  }

  if (!location) {
    return <div style={{ padding: '32px', textAlign: 'center', color: '#e54d4d' }}>Location not found</div>;
  }

  return (
    <div style={{ background: '#fff', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '16px 24px', borderBottom: '1px solid #eef0f3' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#000', margin: 0 }}>Edit Location</h1>
      </header>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <LocationForm
          initialData={location}
          onSubmit={(data) => mutation.mutate(data)}
          isPending={mutation.isPending}
          onCancel={() => navigate(`/organizations/${orgId}/settings/locations`)}
        />
      </div>
    </div>
  );
}
