import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { type CreateVendorData } from './vendors.schemas';
import { createVendor } from './vendors.api';
import type { AxiosError } from 'axios';
import { VendorForm } from './VendorForm';

export function CreateVendor() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { orgId } = useParams<{ orgId: string }>();
  const initialData = location.state?.vendorToClone as Partial<CreateVendorData> | undefined;

  const mutation = useMutation({
    mutationFn: (data: CreateVendorData) => createVendor(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors', orgId] });
      queryClient.invalidateQueries({ queryKey: ['vendor-number-preference', orgId] });
      navigate(`/organizations/${orgId}/purchases/vendors`);
    },
    onError: (error: AxiosError<{ error?: string; message?: string }>) => {
      const errorMsg = error.response?.data?.error || error.response?.data?.message;
      alert(errorMsg || 'Failed to create vendor');
    },
  });

  const onSubmit = (data: CreateVendorData) => {
    mutation.mutate(data);
  };

  return (
    <div>
      <VendorForm
        initialData={initialData}
        onSubmit={onSubmit}
        isSubmitting={mutation.isPending}
        isEdit={false}
      />
    </div>
  );
}
