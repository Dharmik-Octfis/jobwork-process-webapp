import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Building2, ArrowLeft } from 'lucide-react';
import { createVendorSchema, type CreateVendorData } from './vendors.schemas';
import { updateVendor, fetchVendorById } from './vendors.api';
import type { AxiosError } from 'axios';
import './vendor-form.css';

export function EditVendor() {
  const { id, orgId } = useParams<{ id: string; orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: vendor, isLoading: isFetching } = useQuery({
    queryKey: ['vendors', id, orgId],
    queryFn: () => fetchVendorById(orgId!, id!),
    enabled: !!id && !!orgId,
  });

  const { register, handleSubmit, formState: { errors, isSubmitting }, setError, reset } = useForm<CreateVendorData>({
    resolver: zodResolver(createVendorSchema),
  });

  useEffect(() => {
    if (vendor) {
      reset({
        vendorName: vendor.vendorName,
        vendorNumber: vendor.vendorNumber || '',
        emailAddress: vendor.emailAddress || '',
        phone: vendor.phone || '',
        gstTreatment: vendor.gstTreatment as CreateVendorData['gstTreatment'],
        sourceOfSupply: vendor.sourceOfSupply,
      });
    }
  }, [vendor, reset]);

  const mutation = useMutation({
    mutationFn: (data: CreateVendorData) => updateVendor({ id: id!, orgId: orgId!, data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors', orgId] });
      navigate(`/organizations/${orgId}/purchases/vendors`);
    },
    onError: (error: AxiosError<{ error?: string; message?: string }>) => {
      const errorMsg = error.response?.data?.error || error.response?.data?.message;
      if (errorMsg) {
        setError('root', { message: errorMsg });
      } else {
        setError('root', { message: 'Failed to update vendor' });
      }
    }
  });

  const onSubmit = (data: CreateVendorData) => {
    mutation.mutate(data);
  };

  if (isFetching) {
    return <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>Loading vendor data...</div>;
  }

  return (
    <div className="vendor-form-container">
      <div className="vendor-form-wrapper">
        <button
          className="vendor-form-back-btn"
          onClick={() => navigate(`/organizations/${orgId}/purchases/vendors`)}
        >
          <ArrowLeft size={16} /> Back to Vendors
        </button>

        <div className="vendor-form-card">
          <div className="vendor-form-header" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--color-primary-50)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Building2 size={24} color="var(--color-primary)" />
            </div>
            <div>
              <h1>Edit Vendor</h1>
              <p>Update vendor or supplier profile.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)}>
            {errors.root && <div className="vendor-form-error">{errors.root.message}</div>}

            <div className="vendor-form-grid">
              <div className="vendor-form-field">
                <label className="vendor-form-label">
                  Vendor Name <span className="required">*</span>
                </label>
                <input
                  {...register('vendorName')}
                  className={`vendor-form-input ${errors.vendorName ? 'has-error' : ''}`}
                  placeholder="e.g. Acme Corp"
                />
                {errors.vendorName && <span className="vendor-form-error-text">{errors.vendorName.message}</span>}
              </div>

              <div className="vendor-form-field">
                <label className="vendor-form-label">
                  Vendor Number <span className="required">*</span>
                </label>
                <input
                  {...register('vendorNumber')}
                  className={`vendor-form-input ${errors.vendorNumber ? 'has-error' : ''}`}
                  placeholder="e.g. VEN-001"
                />
                {errors.vendorNumber && <span className="vendor-form-error-text">{errors.vendorNumber.message}</span>}
              </div>
            </div>

            <div className="vendor-form-grid">
              <div className="vendor-form-field">
                <label className="vendor-form-label">Email Address</label>
                <input
                  {...register('emailAddress')}
                  type="email"
                  className={`vendor-form-input ${errors.emailAddress ? 'has-error' : ''}`}
                  placeholder="contact@example.com"
                />
                {errors.emailAddress && <span className="vendor-form-error-text">{errors.emailAddress.message}</span>}
              </div>

              <div className="vendor-form-field">
                <label className="vendor-form-label">Phone Number</label>
                <input
                  {...register('phone')}
                  className={`vendor-form-input ${errors.phone ? 'has-error' : ''}`}
                  placeholder="+1 234 567 8900"
                />
                {errors.phone && <span className="vendor-form-error-text">{errors.phone.message}</span>}
              </div>
            </div>

            <hr
              style={{
                border: 'none',
                borderTop: '1px solid var(--color-border)',
                margin: 'var(--space-2) 0 var(--space-4)',
              }}
            />

            <div className="vendor-form-grid">
              <div className="vendor-form-field">
                <label className="vendor-form-label">
                  GST Treatment <span className="required">*</span>
                </label>
                <select
                  {...register('gstTreatment')}
                  className={`vendor-form-select ${errors.gstTreatment ? 'has-error' : ''}`}
                >
                  <option value="">Select an option</option>
                  <option value="REGISTERED_BUSINESS">Registered Business</option>
                  <option value="UNREGISTERED_BUSINESS">Unregistered Business</option>
                  <option value="OVERSEAS">Overseas</option>
                </select>
                {errors.gstTreatment && <span className="vendor-form-error-text">{errors.gstTreatment.message}</span>}
              </div>

              <div className="vendor-form-field">
                <label className="vendor-form-label">
                  Source of Supply <span className="required">*</span>
                </label>
                <input
                  {...register('sourceOfSupply')}
                  className={`vendor-form-input ${errors.sourceOfSupply ? 'has-error' : ''}`}
                  placeholder="e.g. Gujarat"
                />
                {errors.sourceOfSupply && <span className="vendor-form-error-text">{errors.sourceOfSupply.message}</span>}
              </div>
            </div>

            <div className="vendor-form-actions">
              <button
                type="button"
                className="vendor-form-cancel-btn"
                onClick={() => navigate(`/organizations/${orgId}/purchases/vendors`)}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="vendor-form-submit-btn"
              >
                {isSubmitting ? 'Updating...' : 'Update Vendor'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
