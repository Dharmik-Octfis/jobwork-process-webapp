import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { type CreateCustomerData } from './customers.schemas';
import { createCustomer } from './customers.api';
import { CustomerForm } from './CustomerForm';
import { Modal } from '../../../components/ui/Modal';

interface CreateCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (customerId: string) => void;
}

export function CreateCustomerModal({ isOpen, onClose, onSuccess }: CreateCustomerModalProps) {
  const queryClient = useQueryClient();
  const { orgId } = useParams<{ orgId: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // The form's own sub-dialogs are hand-rolled and outside Modal's stack, so Escape
  // pressed in one of them would otherwise close this dialog and drop the form.
  const nestedDialogOpenRef = useRef(false);

  // This component stays mounted while closed, so stale server errors would greet the next open.
  const handleClose = () => {
    setFieldErrors({});
    onClose();
  };

  const mutation = useMutation({
    mutationFn: (data: CreateCustomerData) => createCustomer(orgId!, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customers', orgId] });
      queryClient.invalidateQueries({ queryKey: ['customer-number-preference', orgId] });
      onSuccess?.(data.id);
      handleClose();
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
    <Modal
      isOpen={isOpen}
      title="New Customer"
      position="top"
      width={1000}
      onClose={() => {
        if (!nestedDialogOpenRef.current) handleClose();
      }}
    >
      <CustomerForm
        onSubmit={onSubmit}
        isSubmitting={mutation.isPending}
        isEdit={false}
        customFieldErrors={fieldErrors}
        isModal={true}
        onCancel={handleClose}
        onNestedDialogChange={(open) => {
          nestedDialogOpenRef.current = open;
        }}
      />
    </Modal>
  );
}
