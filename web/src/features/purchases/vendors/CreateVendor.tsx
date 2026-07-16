import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Building2, ArrowLeft } from 'lucide-react';
import { createVendorSchema, type CreateVendorData } from './vendors.schemas';
import { createVendor } from './vendors.api';
import type { AxiosError } from 'axios';

export function CreateVendor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<CreateVendorData>({
    resolver: zodResolver(createVendorSchema),
  });

  const mutation = useMutation({
    mutationFn: createVendor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      navigate('/purchases/vendors');
    },
    onError: (error: AxiosError<{ error?: string; message?: string }>) => {
      const errorMsg = error.response?.data?.error || error.response?.data?.message;
      if (errorMsg) {
        setError('root', { message: errorMsg });
      } else {
        setError('root', { message: 'Failed to create vendor' });
      }
    }
  });

  const onSubmit = (data: CreateVendorData) => {
    mutation.mutate(data);
  };

  return (
    <div style={{ padding: 'var(--space-6) var(--space-5)', maxWidth: 800, margin: '0 auto', width: '100%' }}>
      <button
        onClick={() => navigate('/purchases/vendors')}
        style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0, marginBottom: 'var(--space-4)', fontSize: 14, fontWeight: 500 }}
      >
        <ArrowLeft size={16} /> Back to Vendors
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-primary-50)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Building2 size={24} color="var(--color-primary)" />
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, color: 'var(--color-text)' }}>New Vendor</h1>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>Create a new vendor or supplier profile.</p>
        </div>
      </div>

      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-sm)' }}>
        <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {errors.root && (
            <div style={{ padding: '12px', background: '#fef2f2', color: '#b91c1c', borderRadius: 'var(--radius-md)', fontSize: 14, border: '1px solid #fca5a5' }}>
              {errors.root.message}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Vendor Name <span style={{color: 'red'}}>*</span></label>
              <input
                {...register('vendorName')}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13 }}
                placeholder="e.g. Acme Corp"
              />
              {errors.vendorName && <span style={{ color: 'red', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.vendorName.message}</span>}
            </div>
            
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Vendor Number <span style={{color: 'red'}}>*</span></label>
              <input
                {...register('vendorNumber')}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13 }}
                placeholder="e.g. VEN-001"
              />
              {errors.vendorNumber && <span style={{ color: 'red', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.vendorNumber.message}</span>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Email Address</label>
              <input
                {...register('emailAddress')}
                type="email"
                style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13 }}
                placeholder="contact@example.com"
              />
              {errors.emailAddress && <span style={{ color: 'red', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.emailAddress.message}</span>}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Phone Number</label>
              <input
                {...register('phone')}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13 }}
                placeholder="+1 234 567 8900"
              />
              {errors.phone && <span style={{ color: 'red', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.phone.message}</span>}
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: 'var(--space-2) 0' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>GST Treatment <span style={{color: 'red'}}>*</span></label>
              <select
                {...register('gstTreatment')}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13, background: 'white' }}
              >
                <option value="">Select an option</option>
                <option value="REGISTERED_BUSINESS">Registered Business</option>
                <option value="UNREGISTERED_BUSINESS">Unregistered Business</option>
                <option value="OVERSEAS">Overseas</option>
              </select>
              {errors.gstTreatment && <span style={{ color: 'red', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.gstTreatment.message}</span>}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Source of Supply <span style={{color: 'red'}}>*</span></label>
              <input
                {...register('sourceOfSupply')}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13 }}
                placeholder="e.g. Gujarat"
              />
              {errors.sourceOfSupply && <span style={{ color: 'red', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.sourceOfSupply.message}</span>}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button
              type="button"
              onClick={() => navigate('/purchases/vendors')}
              style={{ background: 'white', color: 'var(--color-text)', border: '1px solid var(--color-border)', padding: '6px 16px', borderRadius: 'var(--radius-sm)', fontWeight: 500, fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{ background: 'var(--color-primary)', color: 'white', border: 'none', padding: '6px 16px', borderRadius: 'var(--radius-sm)', fontWeight: 500, fontSize: 13, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1 }}
            >
              {isSubmitting ? 'Saving...' : 'Save Vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
