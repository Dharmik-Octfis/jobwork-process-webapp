import React from 'react';
import { z } from 'zod';
import { useForm, Controller } from 'react-hook-form';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { zodResolver } from '@hookform/resolvers/zod';
import { vendorAddressSchema, type VendorAddress } from './vendors.schemas';
import { X } from 'lucide-react';

const formSchema = vendorAddressSchema.extend({
  street1: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
});

type AdditionalAddressFormValues = z.infer<typeof formSchema>;

interface AdditionalAddressModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: VendorAddress) => void;
  title?: string;
  defaultValues?: Partial<VendorAddress>;
}

export function AdditionalAddressModal({ isOpen, onClose, onSubmit, title = 'Additional Address', defaultValues }: AdditionalAddressModalProps) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AdditionalAddressFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      addressType: defaultValues?.addressType || 'additional',
      attention: defaultValues?.attention || '',
      country: defaultValues?.country || '',
      street1: defaultValues?.street1 || '',
      street2: defaultValues?.street2 || '',
      city: defaultValues?.city || '',
      state: defaultValues?.state || '',
      pinCode: defaultValues?.pinCode || '',
      phone: defaultValues?.phone || '',
    },
  });

  React.useEffect(() => {
    if (isOpen) {
      reset({
        addressType: defaultValues?.addressType || 'additional',
        attention: defaultValues?.attention || '',
        country: defaultValues?.country || '',
        street1: defaultValues?.street1 || '',
        street2: defaultValues?.street2 || '',
        city: defaultValues?.city || '',
        state: defaultValues?.state || '',
        pinCode: defaultValues?.pinCode || '',
        phone: defaultValues?.phone || '',
      });
    }
  }, [isOpen, defaultValues, reset]);

  if (!isOpen) return null;

  const handleFormSubmit = (data: AdditionalAddressFormValues) => {
    onSubmit({ ...data, addressType: defaultValues?.addressType || 'additional' });
    reset();
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
    width: '400px',
    maxWidth: '90vw',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '90vh',
  };

  const headerStyle: React.CSSProperties = {
    padding: '12px 16px',
    borderBottom: '1px solid #e2e8f0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: '8px',
    borderTopRightRadius: '8px',
  };

  const bodyStyle: React.CSSProperties = {
    padding: '16px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  };

  const footerStyle: React.CSSProperties = {
    padding: '12px 16px',
    borderTop: '1px solid #e2e8f0',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    backgroundColor: '#f8fafc',
    borderBottomLeftRadius: '8px',
    borderBottomRightRadius: '8px',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '13px',
    color: '#334155',
    marginBottom: '4px',
    display: 'block',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    fontSize: '13px',
    border: '1px solid #cbd5e1',
    borderRadius: '4px',
    outline: 'none',
  };

  const btnStyle: React.CSSProperties = {
    padding: '6px 12px',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer',
    border: 'none',
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <h3 style={{ margin: 0, fontSize: '15px', color: '#0f172a' }}>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit(handleFormSubmit)}>
          <div style={bodyStyle}>
            <div>
              <label style={labelStyle}>Attention</label>
              <input {...register('attention')} style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>Country/Region</label>
              <Controller
                control={control}
                name="country"
                render={({ field }) => (
                  <SearchableSelect
                    value={field.value || ''}
                    onChange={field.onChange}
                    options={[
                      { value: 'India', label: 'India' },
                      { value: 'USA', label: 'USA' },
                    ]}
                    placeholder="Select Country"
                  />
                )}
              />
            </div>

            <div>
              <label style={labelStyle}>Address *</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <textarea {...register('street1')} placeholder="Street 1" rows={1} style={{ ...inputStyle, resize: 'vertical' }} />
                {errors.street1 && <span style={{ color: '#ef4444', fontSize: '12px' }}>{errors.street1.message}</span>}
                <textarea {...register('street2')} placeholder="Street 2" rows={1} style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>City *</label>
                <input {...register('city')} style={inputStyle} />
                {errors.city && <span style={{ color: '#ef4444', fontSize: '12px', display: 'block', marginTop: '4px' }}>{errors.city.message}</span>}
              </div>

              <div style={{ flex: 1 }}>
                <label style={labelStyle}>State *</label>
                <input {...register('state')} style={inputStyle} />
                {errors.state && <span style={{ color: '#ef4444', fontSize: '12px', display: 'block', marginTop: '4px' }}>{errors.state.message}</span>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Pin Code</label>
                <input {...register('pinCode')} style={inputStyle} />
              </div>

              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Phone</label>
                <input {...register('phone')} style={inputStyle} />
              </div>
            </div>
          </div>

          <div style={footerStyle}>
            <button
              type="button"
              onClick={onClose}
              style={{ ...btnStyle, backgroundColor: '#fff', border: '1px solid #cbd5e1', color: '#334155' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...btnStyle, backgroundColor: '#0f172a', color: '#fff' }}
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
