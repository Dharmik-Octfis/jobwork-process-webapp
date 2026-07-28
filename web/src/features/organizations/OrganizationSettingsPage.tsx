import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateOrganizationSchema, type UpdateOrganizationData } from './organizations.schemas';
import { organizationsApi } from './organizations.api';
import { toApiErrorMessage } from '../../api/client';
import { Trash2, AlertTriangle } from 'lucide-react';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import './CreateOrganizationForm.css'; // Re-use styles

type MasterData = {
  industries: { id: string; code: string; name: string }[];
  states: { code: string; name: string; countryCode: string; cities: { id: string; name: string }[] }[];
  countries: { id: string; code: string; name: string; dialCode: string }[];
};

export function OrganizationSettingsPage() {
  const { orgId: id } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  const { data: organizations, isLoading, isError, error } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    staleTime: 5 * 60 * 1000,
  });

  const activeOrg = organizations?.find((o) => o.organizationId === id);

  const [masterData, setMasterData] = useState<MasterData | null>(null);

  useEffect(() => {
    organizationsApi
      .getSeedData()
      .then(setMasterData)
      .catch((err) => console.error('Failed to load master data:', err));
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<UpdateOrganizationData>({
    resolver: zodResolver(updateOrganizationSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      dialCode: '+91',
      address: {
        streetAddress1: '',
        country: 'IN',
        stateCode: 'IN-GJ',
        city: '',
        zip: '',
      },
      industryType: '',
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
        dialCode: activeOrg.dialCode || '+91',
        address: {
          streetAddress1: activeOrg.address?.streetAddress1 || '',
          country: activeOrg.address?.country || 'IN',
          stateCode: activeOrg.address?.stateCode || 'IN-GJ',
          city: activeOrg.address?.city || '',
          zip: activeOrg.address?.zip || '',
        },
        industryType: activeOrg.industryType || '',
        taxIdValue: activeOrg.taxIdValue || '',
      });
    }
  }, [activeOrg, reset]);

  const selectedCountryCode = watch('address.country');
  const selectedStateCode = watch('address.stateCode');

  // Filter states by selected country
  const availableStates = masterData?.states.filter((s) => !selectedCountryCode || s.countryCode === selectedCountryCode) || [];

  // Clear city when state changes, unless we are just initializing
  const [isInitializing, setIsInitializing] = useState(true);
  useEffect(() => {
    if (activeOrg && isInitializing) {
      setIsInitializing(false);
      return;
    }
    if (selectedCountryCode && !isInitializing) {
      setValue('address.stateCode', '');
      setValue('address.city', '');
    }
  }, [selectedCountryCode, setValue, isInitializing]);

  useEffect(() => {
    if (activeOrg && isInitializing) {
      return;
    }
    if (selectedStateCode && !isInitializing) {
      setValue('address.city', '');
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

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(activeOrg?.logo_url || null);

  useEffect(() => {
    if (activeOrg?.logo_url) {
      setLogoPreview(activeOrg.logo_url);
    }
  }, [activeOrg]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    if (file.size > 2 * 1024 * 1024) {
      setServerError('Image size must be 2 MB or less.');
      e.target.value = '';
      return;
    }
    try {
      setUploadingLogo(true);
      setServerError(null);
      const localPreviewUrl = URL.createObjectURL(file);
      setLogoPreview(localPreviewUrl);
      const updated = await organizationsApi.uploadLogo(id, file);
      if (updated.logo_url) {
        setLogoPreview(updated.logo_url);
      }
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
    } catch (err) {
      setServerError(toApiErrorMessage(err));
    } finally {
      setUploadingLogo(false);
    }
  };

  const availableCities =
    selectedStateCode && masterData
      ? masterData.states.find((s) => s.code === selectedStateCode)?.cities || []
      : [];

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: 'var(--color-bg)',
          color: 'var(--color-text-muted)',
        }}
      >
        Loading organization settings...
      </div>
    );
  }

  if (isError) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          gap: 16,
          background: 'var(--color-bg)',
        }}
      >
        <p style={{ color: 'var(--color-danger, #ef4444)' }}>
          Failed to load organization settings: {toApiErrorMessage(error)}
        </p>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            background: 'var(--color-primary, #2563eb)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  if (!activeOrg) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          gap: 16,
          background: 'var(--color-bg)',
        }}
      >
        <p style={{ fontSize: 16, fontWeight: 500 }}>Organization not found.</p>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            background: 'var(--color-primary, #2563eb)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Return to Dashboard
        </button>
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

            {/* Logo Section */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                marginBottom: 24,
                padding: 16,
                border: '1px dashed var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg)',
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 8,
                  border: '1px solid var(--color-border)',
                  background: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Organization Logo"
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <span style={{ fontSize: 24, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                    {activeOrg.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <label style={{ fontWeight: 500, fontSize: 14, display: 'block', marginBottom: 4 }}>
                  Organization Logo
                </label>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 8px 0' }}>
                  Upload your company logo (`logo_url`). Recommended format: PNG, JPG, or SVG up to 2MB.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    disabled={uploadingLogo}
                    style={{ fontSize: 13 }}
                  />
                  {uploadingLogo && (
                    <span style={{ fontSize: 12, color: 'var(--color-primary)' }}>Uploading...</span>
                  )}
                </div>
              </div>
            </div>

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
                  Industry Type <span className="required">*</span>
                </label>
                <Controller
                  name="industryType"
                  control={control}
                  render={({ field }) => (
                    <div className={errors.industryType ? 'error' : ''}>
                      <SearchableSelect
                        options={masterData?.industries.map(ind => ({ label: ind.name, value: ind.code })) || []}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Select Industry"
                      />
                    </div>
                  )}
                />
                {errors.industryType && (
                  <p className="org-form-error-msg">{errors.industryType.message}</p>
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
                <textarea
                  className={`org-form-input ${errors.address?.streetAddress1 ? 'error' : ''}`}
                  placeholder="E.g. 101, Business Center"
                  {...register('address.streetAddress1')}
                  rows={2}
                />
                {errors.address?.streetAddress1 && (
                  <p className="org-form-error-msg">{errors.address.streetAddress1.message}</p>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--space-4)',
                }}
              >
                <div className="org-form-group">
                  <label>Country</label>
                  <Controller
                    name="address.country"
                    control={control}
                    render={({ field }) => (
                      <div className={errors.address?.country ? 'error' : ''}>
                        <SearchableSelect
                          options={masterData?.countries.map(c => ({ label: c.name, value: c.code })) || []}
                          value={field.value}
                          onChange={field.onChange}
                          disabled={!masterData}
                          placeholder="Select Country"
                        />
                      </div>
                    )}
                  />
                </div>

                <div className="org-form-group">
                  <label>State</label>
                  <Controller
                    name="address.stateCode"
                    control={control}
                    render={({ field }) => (
                      <div className={errors.address?.stateCode ? 'error' : ''}>
                        <SearchableSelect
                          options={availableStates.map(s => ({ label: s.name, value: s.code }))}
                          value={field.value}
                          onChange={field.onChange}
                          disabled={!selectedCountryCode}
                          placeholder="Select State"
                        />
                      </div>
                    )}
                  />
                </div>

                <div className="org-form-group">
                  <label>City</label>
                  <Controller
                    name="address.city"
                    control={control}
                    render={({ field }) => (
                      <div className={errors.address?.city ? 'error' : ''}>
                        <SearchableSelect
                          options={availableCities.map(c => ({ label: c.name, value: c.id }))}
                          value={field.value}
                          onChange={field.onChange}
                          disabled={!selectedStateCode}
                          placeholder="Select City"
                        />
                      </div>
                    )}
                  />
                </div>

                <div className="org-form-group">
                  <label>ZIP Code</label>
                  <input
                    type="text"
                    className={`org-form-input ${errors.address?.zip ? 'error' : ''}`}
                    placeholder="10001"
                    {...register('address.zip')}
                  />
                </div>
              </div>

              <div className="org-form-group">
                <label>Tax ID / GSTIN</label>
                <input
                  type="text"
                  className={`org-form-input ${errors.taxIdValue ? 'error' : ''}`}
                  placeholder="E.g. 27AAAAA0000A1Z5"
                  {...register('taxIdValue')}
                  style={{ textTransform: 'uppercase' }}
                  maxLength={15}
                />
                {errors.taxIdValue && (
                  <p className="org-form-error-msg">{errors.taxIdValue.message}</p>
                )}
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
