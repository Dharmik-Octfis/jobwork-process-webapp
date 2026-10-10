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
    queryKey: ['customer', orgId, id],
    queryFn: () => fetchCustomerById(orgId!, id!),
    enabled: !!id && !!orgId,
  });

  const mutation = useMutation({
    mutationFn: (data: CreateCustomerData) => updateCustomer({ id: id!, orgId: orgId!, data }),
    onSuccess: async (_data) => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['customer'] });
      navigate(`/organizations/${orgId}/sales/customers?id=${id}`);
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

  if (isFetching) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>Loading customer data...</div>
    );
  }

  return (
    <>
      {customer && (
        <CustomerForm
          initialData={customer as unknown as CreateCustomerData} // mapping handles identical schema structure
          onSubmit={onSubmit}
          isSubmitting={mutation.isPending}
          isEdit={true}
          customFieldErrors={fieldErrors}
        />
      )}
    </>
  );
}
