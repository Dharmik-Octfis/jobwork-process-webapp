import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { createPaymentTerm, type PaymentTerm } from './payment-terms.api';
import { createPaymentTermSchema, type CreatePaymentTermData } from './payment-terms.schemas';
import { toApiErrorMessage } from '../../../api/client';

interface PaymentTermModalProps {
  orgId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newTerm: PaymentTerm) => void;
}

export function PaymentTermModal({ orgId, isOpen, onClose, onSuccess }: PaymentTermModalProps) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreatePaymentTermData>({
    resolver: zodResolver(createPaymentTermSchema),
  });

  const mutation = useMutation({
    mutationFn: (data: CreatePaymentTermData) => createPaymentTerm(orgId, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['payment-terms', orgId] });
      reset();
      onSuccess(data);
    },
    onError: (error: unknown) => {
      // You can add toast here if preferred
      console.error('Failed to create payment term:', error);
      alert(toApiErrorMessage(error));
    }
  });

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 0,
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '0 0 8px 8px',
          width: '500px',
          maxWidth: '90vw',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 24px',
            borderBottom: '1px solid #e5e7eb',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 500, color: '#374151' }}>
            New Payment Term
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#6b7280',
              display: 'flex',
              padding: '4px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit((data) => mutation.mutate(data))}
          style={{ padding: '24px' }}
        >
          <div style={{ display: 'grid', gap: '20px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <label style={{ color: '#ef4444', fontSize: '14px' }}>Term Name*</label>
              <div>
                <input
                  type="text"
                  {...register('termName')}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '14px',
                  }}
                />
                {errors.termName && (
                  <span style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                    {errors.termName.message}
                  </span>
                )}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <label style={{ color: '#ef4444', fontSize: '14px' }}>Due After*</label>
              <div>
                <div style={{ display: 'flex' }}>
                  <input
                    type="number"
                    {...register('dueAfterDays', { valueAsNumber: true })}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      border: '1px solid #d1d5db',
                      borderRight: 'none',
                      borderRadius: '4px 0 0 4px',
                      fontSize: '14px',
                    }}
                  />
                  <span
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#f9fafb',
                      border: '1px solid #d1d5db',
                      borderRadius: '0 4px 4px 0',
                      color: '#374151',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    Days
                  </span>
                </div>
                {errors.dueAfterDays && (
                  <span style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                    {errors.dueAfterDays.message}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: '32px',
              paddingTop: '20px',
              borderTop: '1px solid #e5e7eb',
              display: 'flex',
              gap: '12px',
            }}
          >
            <button
              type="submit"
              disabled={isSubmitting || mutation.isPending}
              style={{
                backgroundColor: '#166534',
                color: 'white',
                border: 'none',
                padding: '8px 24px',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: (isSubmitting || mutation.isPending) ? 'not-allowed' : 'pointer',
                opacity: (isSubmitting || mutation.isPending) ? 0.7 : 1,
              }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting || mutation.isPending}
              style={{
                backgroundColor: 'white',
                color: '#374151',
                border: '1px solid #d1d5db',
                padding: '8px 24px',
                borderRadius: '4px',
                fontSize: '14px',
                cursor: (isSubmitting || mutation.isPending) ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
