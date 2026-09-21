import { X } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { VendorForm } from './VendorForm';
import { createVendor } from './vendors.api';
import type { CreateVendorData } from './vendors.schemas';
import type { AxiosError } from 'axios';

interface CreateVendorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (vendorId: string) => void;
}

export function CreateVendorModal({ isOpen, onClose, onSuccess }: CreateVendorModalProps) {
  const queryClient = useQueryClient();
  const { orgId } = useParams<{ orgId: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (data: CreateVendorData) => createVendor(orgId!, data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['vendors', orgId] });
      queryClient.invalidateQueries({ queryKey: ['vendor-number-preference', orgId] });
      onSuccess?.(res.id);
      onClose();
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
      alert(errorMsg || 'Failed to create vendor');
    },
  });

  const onSubmit = (data: CreateVendorData) => {
    setFieldErrors({});
    mutation.mutate(data);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '0 20px 20px 20px', // No padding at the top
      }}
    >
      <div
        style={{
          width: '800px',
          maxWidth: '100%',
          maxHeight: '95vh',
          backgroundColor: '#f8fafc',
          borderRadius: '0 0 8px 8px', // No border radius on top
          overflow: 'hidden',
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
          animation: 'slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <style>
          {`
            @keyframes slideDown {
              from { opacity: 0; transform: translateY(-20px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}
        </style>
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#ffffff',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#1e293b' }}>
            New Vendor
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              padding: '4px',
            }}
          >
            <X size={20} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          <VendorForm
            onSubmit={onSubmit}
            isSubmitting={mutation.isPending}
            isEdit={false}
            customFieldErrors={fieldErrors}
            onCancel={onClose}
            isModal={true}
          />
        </div>
      </div>
    </div>
  );
}
