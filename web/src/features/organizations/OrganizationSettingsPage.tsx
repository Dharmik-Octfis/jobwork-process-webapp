import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateOrganizationSchema, type UpdateOrganizationData } from './organizations.schemas';
import { organizationsApi } from './organizations.api';
import { toApiErrorMessage } from '../../api/client';
import { Trash2, AlertTriangle } from 'lucide-react';
import './CreateOrganizationForm.css'; // Re-use styles

type MasterData = {
  industries: { id: string; code: string; name: string }[];
  states: { code: string; name: string; cities: { id: string; name: string }[] }[];
};

export function OrganizationSettingsPage() {
  const { orgId: id } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    staleTime: 5 * 60 * 1000,
  });

  const activeOrg = organizations?.find((o) => o.id === id);

  const [masterData, setMasterData] = useState<MasterData | null>(null);

  useEffect(() => {
    organizationsApi
      .getMasterData()
      .then(setMasterData)
      .catch((err) => console.error('Failed to load master data:', err));
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateOrganizationData>({
    resolver: zodResolver(updateOrganizationSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      orgAddress: '',
      stateCode: '',
      cityId: '',
      zip: '',
      industryCode: '',
      taxIdValue: '',
    },
  });

  // Populate form when activeOrg is loaded
  useEffect(() => {
    if (activeOrg) {
      reset({
        name: activeOrg.name,
        email: activeOrg.email || '',
        phone: activeOrg.phone || '',
        orgAddress: activeOrg.orgAddress || '',
        stateCode: activeOrg.stateCode || '',
        cityId: activeOrg.cityId || '',
        zip: activeOrg.zip || '',
        industryCode: activeOrg.industryCode || '',
        taxIdValue: activeOrg.taxIdValue || '',
      });
    }
  }, [activeOrg, reset]);

  const selectedStateCode = watch('stateCode');

  // Clear city when state changes, unless we are just initializing
  const [isInitializing, setIsInitializing] = useState(true);
  useEffect(() => {
    if (activeOrg && isInitializing) {
      setIsInitializing(false);
      return;
    }
    if (selectedStateCode && !isInitializing) {
      setValue('cityId', '');
    }
  }, [selectedStateCode, setValue, activeOrg, isInitializing]);

  const onSubmit = async (data: UpdateOrganizationData) => {
    if (!id) return;
    try {
      setServerError(null);
      await organizationsApi.updateOrganization(id, data);
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
      navigate('/');
    } catch (err) {
      setServerError(toApiErrorMessage(err));
    }
  };

  const handleDelete = async () => {
    if (!id || !activeOrg) return;
    if (deleteConfirmName !== activeOrg.name) {
      setDeleteError('Organization name does not match.');
      return;
    }
    try {
      setDeleteError(null);
      await organizationsApi.deleteOrganization(id);
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
      navigate('/');
    } catch (err) {
      setDeleteError(toApiErrorMessage(err));
    }
  };

  const availableCities =
    selectedStateCode && masterData
      ? masterData.states.find((s) => s.code === selectedStateCode)?.cities || []
      : [];

  if (!activeOrg) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: 'var(--color-bg)',
        }}
      >
        Loading or Organization not found...
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          flex: 1,
          maxWidth: 1200,
          margin: '0 auto',
          width: '100%',
          padding: 'var(--space-6) var(--space-5)',
          gap: 'var(--space-6)',
        }}
      >
        {/* Main Content */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <section
            style={{
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              padding: 'var(--space-6)',
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 var(--space-1) 0' }}>
              Organization Profile
            </h2>
            <p
              style={{
                color: 'var(--color-text-muted)',
                margin: '0 0 var(--space-5) 0',
                fontSize: 14,
              }}
            >
              Update your organization's details and public information.
            </p>

            {serverError && (
              <div
                style={{
                  padding: 12,
                  background: 'var(--danger-50)',
                  color: 'var(--color-danger)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 20,
                  fontSize: 14,
                }}
              >
                {serverError}
              </div>
            )}

            <form
              onSubmit={handleSubmit(onSubmit)}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
            >
              {/* Name */}
              <div className="org-form-group">
                <label>
                  Organization Name <span className="org-form-required">*</span>
                </label>
                <input
                  type="text"
                  className={`org-form-input ${errors.name ? 'error' : ''}`}
                  placeholder="e.g. Acme Corp"
                  {...register('name')}
                />
                {errors.name && <p className="org-form-error-msg">{errors.name.message}</p>}
              </div>

              {/* Industry */}
              <div className="org-form-group">
                <label>
                  Industry Type <span className="org-form-required">*</span>
                </label>
                <select
                  className={`org-form-select ${errors.industryCode ? 'error' : ''}`}
                  {...register('industryCode')}
                  disabled={!masterData}
                >
                  <option value="">Select Industry</option>
                  {masterData?.industries.map((i) => (
                    <option key={i.id} value={i.code}>
                      {i.name}
                    </option>
                  ))}
                </select>
                {errors.industryCode && (
                  <p className="org-form-error-msg">{errors.industryCode.message}</p>
                )}
              </div>

              {/* Two column layout for email/phone */}
              <div
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}
              >
                <div className="org-form-group">
                  <label>Email Address</label>
                  <input
                    type="email"
                    className={`org-form-input ${errors.email ? 'error' : ''}`}
                    placeholder="contact@company.com"
                    {...register('email')}
                  />
                  {errors.email && <p className="org-form-error-msg">{errors.email.message}</p>}
                </div>

                <div className="org-form-group">
                  <label>Phone Number</label>
                  <input
                    type="tel"
                    className={`org-form-input ${errors.phone ? 'error' : ''}`}
                    placeholder="+1 (555) 000-0000"
                    {...register('phone')}
                  />
                  {errors.phone && <p className="org-form-error-msg">{errors.phone.message}</p>}
                </div>
              </div>

              <div className="org-form-group">
                <label>Street Address</label>
                <input
                  type="text"
                  className={`org-form-input ${errors.orgAddress ? 'error' : ''}`}
                  placeholder="123 Business Rd, Suite 100"
                  {...register('orgAddress')}
                />
                {errors.orgAddress && (
                  <p className="org-form-error-msg">{errors.orgAddress.message}</p>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 'var(--space-4)',
                }}
              >
                <div className="org-form-group">
                  <label>State</label>
                  <select
                    className={`org-form-select ${errors.stateCode ? 'error' : ''}`}
                    {...register('stateCode')}
                    disabled={!masterData}
                  >
                    <option value="">Select State</option>
                    {masterData?.states.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="org-form-group">
                  <label>City</label>
                  <select
                    className={`org-form-select ${errors.cityId ? 'error' : ''}`}
                    {...register('cityId')}
                    disabled={!selectedStateCode}
                  >
                    <option value="">Select City</option>
                    {availableCities.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="org-form-group">
                  <label>ZIP Code</label>
                  <input
                    type="text"
                    className={`org-form-input ${errors.zip ? 'error' : ''}`}
                    placeholder="10001"
                    {...register('zip')}
                  />
                </div>
              </div>

              <div className="org-form-group">
                <label>Tax ID / GSTIN</label>
                <input
                  type="text"
                  className={`org-form-input ${errors.taxIdValue ? 'error' : ''}`}
                  placeholder="Enter Tax ID"
                  {...register('taxIdValue')}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  marginTop: 'var(--space-4)',
                  paddingTop: 'var(--space-4)',
                  borderTop: '1px solid var(--color-border)',
                }}
              >
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    background: 'var(--color-primary)',
                    color: 'white',
                    border: 'none',
                    padding: '10px 24px',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 600,
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    opacity: isSubmitting ? 0.7 : 1,
                  }}
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </section>

          {/* Danger Zone */}
          <section
            style={{
              border: '1px solid var(--color-danger)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              marginTop: 'var(--space-4)',
            }}
          >
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border)' }}>
              <h2
                style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-danger)', margin: 0 }}
              >
                Danger Zone
              </h2>
            </div>
            <div
              style={{
                padding: '24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--danger-50)',
              }}
            >
              <div>
                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    margin: '0 0 4px 0',
                    color: 'var(--color-text)',
                  }}
                >
                  Delete this organization
                </h3>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
                  Once deleted, it will be gone forever. Please be certain.
                </p>
              </div>
              <button
                onClick={() => setIsDeleteDialogOpen(true)}
                style={{
                  background: 'white',
                  color: 'var(--color-danger)',
                  border: '1px solid var(--color-danger)',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Trash2 size={16} /> Delete Organization
              </button>
            </div>
          </section>
        </main>
      </div>

      {/* Delete Confirmation Modal */}
      {isDeleteDialogOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              background: 'var(--color-surface)',
              width: 450,
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ padding: 24 }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: 'var(--danger-50)',
                    color: 'var(--color-danger)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <h2
                    style={{
                      fontSize: 18,
                      fontWeight: 600,
                      margin: '0 0 8px 0',
                      color: 'var(--color-text)',
                    }}
                  >
                    Delete organization
                  </h2>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 14,
                      color: 'var(--color-text-muted)',
                      lineHeight: 1.5,
                    }}
                  >
                    This action cannot be undone. This will permanently delete the{' '}
                    <strong>{activeOrg.name}</strong> organization, members, and all associated
                    data.
                  </p>
                </div>
              </div>

              {deleteError && (
                <div
                  style={{
                    padding: 12,
                    background: 'var(--danger-50)',
                    color: 'var(--color-danger)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: 20,
                    fontSize: 14,
                  }}
                >
                  {deleteError}
                </div>
              )}

              <div className="org-form-group">
                <label style={{ fontSize: 14 }}>
                  Please type <strong>{activeOrg.name}</strong> to confirm.
                </label>
                <input
                  type="text"
                  className="org-form-input"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                />
              </div>
            </div>

            <div
              style={{
                padding: '16px 24px',
                background: 'var(--color-bg)',
                borderTop: '1px solid var(--color-border)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 12,
              }}
            >
              <button
                onClick={() => {
                  setIsDeleteDialogOpen(false);
                  setDeleteError(null);
                  setDeleteConfirmName('');
                }}
                style={{
                  background: 'white',
                  border: '1px solid var(--color-border)',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmName !== activeOrg.name}
                style={{
                  background: 'var(--color-danger)',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 600,
                  cursor: deleteConfirmName !== activeOrg.name ? 'not-allowed' : 'pointer',
                  opacity: deleteConfirmName !== activeOrg.name ? 0.5 : 1,
                }}
              >
                Delete Organization
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
