import React from 'react';
import { z } from 'zod';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { type VendorContactPerson } from './vendors.schemas';
import { Select } from '../../../components/ui/Select';
import { PhoneInput } from '../../../components/ui/PhoneInput';
import { organizationsApi } from '../../organizations/organizations.api';

const formSchema = z.object({
  salutation: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  mobile: z.string().nullable().optional(),
});

type ContactPersonFormValues = z.infer<typeof formSchema>;

interface ContactPersonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ContactPersonFormValues) => void;
  initialData?: VendorContactPerson | null;
  title?: string;
}

export function ContactPersonModal({ isOpen, onClose, onSubmit, initialData, title = 'Add Contact Person' }: ContactPersonModalProps) {
  const { data: masterData } = useQuery({
    queryKey: ['seedData'],
    queryFn: () => organizationsApi.getSeedData(),
  });
  const countries = masterData?.countries || [];

  const {
    register,
    control,
    handleSubmit,
    reset,
  } = useForm<ContactPersonFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      salutation: initialData?.salutation || '',
      firstName: initialData?.firstName || '',
      lastName: initialData?.lastName || '',
      email: initialData?.email || '',
      phone: initialData?.phone || '',
      mobile: initialData?.mobile || '',
    },
  });

  React.useEffect(() => {
    if (isOpen) {
      reset({
        salutation: initialData?.salutation || '',
        firstName: initialData?.firstName || '',
        lastName: initialData?.lastName || '',
        email: initialData?.email || '',
        phone: initialData?.phone || '',
        mobile: initialData?.mobile || '',
      });
    }
  }, [isOpen, initialData, reset]);

  if (!isOpen) return null;

  const handleFormSubmit = (data: ContactPersonFormValues) => {
    onSubmit(data);
    onClose();
  };

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const modalStyle: React.CSSProperties = {
    backgroundColor: '#fff',
    borderRadius: '0 0 8px 8px',
    width: '600px',
    maxWidth: '90vw',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '90vh',
  };

  const headerStyle: React.CSSProperties = {
    padding: '16px 24px',
    borderBottom: '1px solid #eef0f3',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
  };

  const formStyle: React.CSSProperties = {
    padding: '24px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '13px',
    color: '#334155',
    fontWeight: 500,
    width: '120px',
    flexShrink: 0,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '13px',
    outline: 'none',
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
  };

  const inputContainerStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 500, color: '#1e293b' }}>
            {title}
          </h2>
          <button
            type="button"
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

        <form onSubmit={handleSubmit(handleFormSubmit)}>
          <div style={formStyle}>
            <div style={rowStyle}>
              <label style={labelStyle}>Name</label>
              <div style={{ ...inputContainerStyle, flexDirection: 'row', gap: '12px' }}>
                <Controller
                  control={control}
                  name="salutation"
                  render={({ field }) => (
                    <Select
                      value={field.value || ''}
                      onChange={field.onChange}
                      options={[
                        { value: '', label: 'Salutation' },
                        { value: 'Mr.', label: 'Mr.' },
                        { value: 'Mrs.', label: 'Mrs.' },
                        { value: 'Ms.', label: 'Ms.' },
                        { value: 'Miss.', label: 'Miss.' },
                        { value: 'Dr.', label: 'Dr.' },
                      ]}
                      minWidth={120}
                      fullWidth={false}
                    />
                  )}
                />
                <input
                  {...register('firstName')}
                  placeholder="First Name"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <input
                  {...register('lastName')}
                  placeholder="Last Name"
                  style={{ ...inputStyle, flex: 1 }}
                />
              </div>
            </div>

            <div style={rowStyle}>
              <label style={labelStyle}>Email Address</label>
              <div style={inputContainerStyle}>
                <input
                  {...register('email')}
                  type="email"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={rowStyle}>
              <label style={labelStyle}>Phone</label>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Controller
                  control={control}
                  name="phone"
                  render={({ field }) => (
                    <PhoneInput
                      value={field.value || ''}
                      onChange={field.onChange}
                      countries={countries}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="mobile"
                  render={({ field }) => (
                    <PhoneInput
                      value={field.value || ''}
                      onChange={field.onChange}
                      countries={countries}
                    />
                  )}
                />
              </div>
            </div>
          </div>

          <div
            style={{
              padding: '16px 24px',
              borderTop: '1px solid #eef0f3',
              display: 'flex',
              justifyContent: 'flex-start',
              gap: '12px',
              backgroundColor: '#f8fafc',
            }}
          >
            <button
              type="submit"
              style={{
                padding: '8px 16px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                backgroundColor: 'white',
                color: '#64748b',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
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
