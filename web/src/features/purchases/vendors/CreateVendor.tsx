import { useState } from 'react';
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (data: CreateVendorData) => createVendor(orgId!, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['vendors', orgId] });
      queryClient.invalidateQueries({ queryKey: ['vendor-number-preference', orgId] });
      navigate(`/organizations/${orgId}/purchases/vendors?id=${data.id}`);
    },
    onError: (
      error: AxiosError<{ error?: string; message?: string; details?: Record<string, string> }>,
    ) => {
      const details = error.response?.data?.details;
      // Field-level custom-field errors are keyed `customFields.<key>`.
      if (details && typeof details === 'object' && !Array.isArray(details)) {
        setFieldErrors(details);
        return;
      }
      const errorMsg = error.response?.data?.error || error.response?.data?.message;
      alert(errorMsg || 'Failed to create vendor');
    },
  });

  const onSubmit = (data: CreateVendorData) => {
    setFieldErrors({});
    mutation.mutate(data);
  };

  return (
    <VendorForm
      initialData={initialData}
      onSubmit={onSubmit}
      isSubmitting={mutation.isPending}
      isEdit={false}
      customFieldErrors={fieldErrors}
    />
  );
}
