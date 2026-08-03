import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { type CreateVendorData } from './vendors.schemas';
import { updateVendor, fetchVendorById } from './vendors.api';
import type { AxiosError } from 'axios';
import { VendorForm } from './VendorForm';

export function EditVendor() {
  const { id, orgId } = useParams<{ id: string; orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: vendor, isLoading: isFetching } = useQuery({
    queryKey: ['vendor', orgId, id],
    queryFn: () => fetchVendorById(orgId!, id!),
    enabled: !!id && !!orgId,
  });

  const mutation = useMutation({
    mutationFn: (data: CreateVendorData) => updateVendor({ id: id!, orgId: orgId!, data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['vendors'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor'] });
      navigate(`/organizations/${orgId}/purchases/vendors`);
    },
    onError: (
      error: AxiosError<{ error?: string; message?: string; details?: Record<string, string> }>,
    ) => {
      const details = error.response?.data?.details;
      if (details && typeof details === 'object' && !Array.isArray(details)) {
        setFieldErrors(details);
        return;
      }
      const errorMsg = error.response?.data?.error || error.response?.data?.message;
      alert(errorMsg || 'Failed to update vendor');
    },
  });

  const onSubmit = (data: CreateVendorData) => {
    setFieldErrors({});
    mutation.mutate(data);
  };

  if (isFetching) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>Loading vendor data...</div>
    );
  }

  return (
    <div>
      {vendor && (
        <VendorForm
          initialData={vendor as unknown as CreateVendorData} // mapping handles identical schema structure
          onSubmit={onSubmit}
          isSubmitting={mutation.isPending}
          isEdit={true}
          customFieldErrors={fieldErrors}
        />
      )}
    </div>
  );
}
