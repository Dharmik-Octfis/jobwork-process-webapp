import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { type CreateCustomerData } from './customers.schemas';
import { createCustomer } from './customers.api';
import type { AxiosError } from 'axios';
import { CustomerForm } from './CustomerForm';

export function CreateCustomer() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { orgId } = useParams<{ orgId: string }>();
  const initialData = location.state?.customerToClone as Partial<CreateCustomerData> | undefined;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (data: CreateCustomerData) => createCustomer(orgId!, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customers', orgId] });
      queryClient.invalidateQueries({ queryKey: ['customer-number-preference', orgId] });
      navigate(`/organizations/${orgId}/sales/customers?id=${data.id}`);
    },
    // The toast comes from queryClient's global onError; here we only highlight fields.
    onError: (error: AxiosError<{ details?: Record<string, string> }>) => {
      const details = error.response?.data?.details;
      if (details && typeof details === 'object' && !Array.isArray(details)) {
        setFieldErrors(details);
      }
    },
  });

  const onSubmit = (data: CreateCustomerData) => {
    setFieldErrors({});
    mutation.mutate(data);
  };

  return (
    <CustomerForm
      initialData={initialData}
      onSubmit={onSubmit}
      isSubmitting={mutation.isPending}
      isEdit={false}
      customFieldErrors={fieldErrors}
    />
  );
}
