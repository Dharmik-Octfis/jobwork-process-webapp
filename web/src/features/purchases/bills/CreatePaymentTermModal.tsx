import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Modal } from '../../../components/ui/Modal';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { createPaymentTerm } from './payment-terms.api';

interface CreatePaymentTermModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (termName: string) => void;
}

interface FormValues {
  termName: string;
  dueAfterDays: number;
}

export function CreatePaymentTermModal({
  isOpen,
  onClose,
  onSuccess,
}: CreatePaymentTermModalProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      dueAfterDays: 0,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: FormValues) => createPaymentTerm(orgId!, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['payment-terms', orgId] });
      if (onSuccess) {
        onSuccess(data.termName);
      }
      reset();
      onClose();
    },
    onError: (err) => {
      console.error('Failed to create payment term:', err);
    },
  });

  const onSubmit = (data: FormValues) => {
    createMutation.mutate({
      ...data,
      dueAfterDays: Number(data.dueAfterDays),
    });
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create New Payment Term"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
          <Button variant="secondary" onClick={handleClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit(onSubmit)}
            isLoading={createMutation.isPending}
          >
            Create
          </Button>
        </div>
      }
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '4px 0' }}
      >
        <Input
          label="Payment Term Name"
          placeholder="e.g. Net 30"
          {...register('termName', { required: 'Term name is required' })}
          error={errors.termName?.message}
        />
        <Input
          label="Due After (Days)"
          type="number"
          min="0"
          placeholder="e.g. 30"
          {...register('dueAfterDays', {
            required: 'Due days is required',
            valueAsNumber: true,
            min: { value: 0, message: 'Cannot be negative' },
          })}
          error={errors.dueAfterDays?.message}
        />
      </form>
    </Modal>
  );
}
