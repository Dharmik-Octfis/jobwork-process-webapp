import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { type CreateCustomerData } from './customers.schemas';
import { updateCustomer, fetchCustomerById } from './customers.api';
import type { AxiosError } from 'axios';
import { CustomerForm } from './CustomerForm';

export function EditCustomer() {
  const { id, orgId } = useParams<{ id: string; orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: customer, isLoading: isFetching } = useQuery({
    queryKey: ['customers', id, orgId],
    queryFn: () => fetchCustomerById(orgId!, id!),
    enabled: !!id && !!orgId,
  });

  const mutation = useMutation({
    mutationFn: (data: CreateCustomerData) => updateCustomer({ id: id!, orgId: orgId!, data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', orgId] });
      navigate(`/organizations/${orgId}/sales/customers`);
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
      alert(errorMsg || 'Failed to update customer');
    },
  });

  const onSubmit = (data: CreateCustomerData) => {
    setFieldErrors({});
    mutation.mutate(data);
  };

  if (isFetching) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>Loading customer data...</div>
    );
  }

  return (
    <div>
      {customer && (
        <CustomerForm
          initialData={customer as unknown as CreateCustomerData} // mapping handles identical schema structure
          onSubmit={onSubmit}
          isSubmitting={mutation.isPending}
          isEdit={true}
          customFieldErrors={fieldErrors}
        />
      )}
    </div>
  );
}
