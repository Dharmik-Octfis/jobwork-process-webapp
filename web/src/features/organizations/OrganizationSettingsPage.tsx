import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'react-hot-toast';
import { updateOrganizationSchema, type UpdateOrganizationData } from './organizations.schemas';
import { organizationsApi } from './organizations.api';
import { toApiErrorMessage } from '../../api/client';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import './CreateOrganizationForm.css'; // Re-use styles

type MasterData = {
  industries: { id: string; code: string; name: string }[];
  states: {
    code: string;
    name: string;
    countryCode: string;
    cities: { id: string; name: string }[];
  }[];
  countries: { id: string; code: string; name: string; dialCode: string }[];
};

export function OrganizationSettingsPage() {
  const { orgId: id } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);


  const {
    data: organizations,
    isLoading,
    isError,
    error,
  } = useQuery({
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
        website: activeOrg.website || '',
      });
    }
  }, [activeOrg, reset]);

  const selectedCountryCode = watch('address.country');
  const selectedStateCode = watch('address.stateCode');

  // Filter states by selected country
  const availableStates =
    masterData?.states.filter(
      (s) => !selectedCountryCode || s.countryCode === selectedCountryCode,
    ) || [];

  const onSubmit = async (data: UpdateOrganizationData) => {
    if (!id) return;
    try {
      setServerError(null);
      await organizationsApi.updateOrganization(id, data);
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
      toast.success('Organization updated successfully');
    } catch (err) {
      setServerError(toApiErrorMessage(err));
    }
  };



  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [deletingLogo, setDeletingLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(activeOrg?.logo_url || null);

  const [copiedOrgCode, setCopiedOrgCode] = useState(false);

  // `navigator.clipboard` is undefined outside a secure context — plain http on a
  // LAN IP, which is exactly how this gets demoed — so the failure path has to do
  // something real. A button that silently does nothing reads as broken, and this
  // is the one value on the page a customer actually needs to get out of the app.
  const copyOrgCode = async () => {
    if (!activeOrg?.orgCode) return;
    try {
      await navigator.clipboard.writeText(activeOrg.orgCode);
      setCopiedOrgCode(true);
      setTimeout(() => setCopiedOrgCode(false), 1500);
    } catch {
      window.prompt('Copy your Organization Code:', activeOrg.orgCode);
    }
  };

  useEffect(() => {
    if (activeOrg?.logo_url) {
      setLogoPreview(activeOrg.logo_url);
    } else {
      setLogoPreview(null);
    }
  }, [activeOrg]);

  const handleLogoRemove = async () => {
    if (!id) return;
    try {
      setDeletingLogo(true);
      setServerError(null);
      await organizationsApi.deleteLogo(id);
      setLogoPreview(null);
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
    } catch (err) {
      setServerError(toApiErrorMessage(err));
    } finally {
      setDeletingLogo(false);
    }
  };

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
          padding: 'var(--space-3) var(--space-4)',
          gap: 'var(--space-3)',
        }}
      >
        {/* Main Content */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <section
            style={{
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              padding: 'var(--space-4)',
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 var(--space-1) 0' }}>
              Organization Profile
            </h2>
            <p
              style={{
                color: 'var(--color-text-muted)',
                margin: '0 0 var(--space-3) 0',
                fontSize: 13,
              }}
            >
              Update your organization's details and public information.
            </p>

            {/* Logo Section */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: 16,
                padding: '12px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface-2)',
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
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
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <label style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 4, color: 'var(--color-text)' }}>
                  Organization Logo
                </label>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 12px 0' }}>
                  Upload your company logo. Recommended format: PNG, JPG, or SVG up to
                  2MB.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <label
                    style={{
                      cursor: uploadingLogo ? 'not-allowed' : 'pointer',
                      padding: '8px 16px',
                      backgroundColor: '#ffffff',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#374151',
                      transition: 'all 0.2s',
                      opacity: uploadingLogo ? 0.7 : 1,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    }}
                  >
                    {uploadingLogo ? 'Uploading...' : 'Choose Image'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      disabled={uploadingLogo}
                      style={{ display: 'none' }}
                    />
                  </label>
                  {logoPreview && (
                    <button
                      type="button"
                      onClick={handleLogoRemove}
                      disabled={deletingLogo}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #ef4444',
                        borderRadius: '6px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#ef4444',
                        cursor: deletingLogo ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s',
                        opacity: deletingLogo ? 0.7 : 1,
                      }}
                    >
                      {deletingLogo ? 'Removing...' : 'Remove'}
                    </button>
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
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
            >
              {/* Org ID — read-only. The only field here a customer needs to read
                  *out* rather than edit. Generated once at creation and never
                  changes, so it is deliberately not part of the form state. */}
              <div className="org-form-group">
                <label>Organization Code</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      fontSize: 15,
                      letterSpacing: '0.08em',
                      color: 'var(--color-text)',
                    }}
                  >
                    {activeOrg.orgCode ?? '—'}
                  </span>
                  {activeOrg.orgCode && (
                    // type="button" is load-bearing: a bare <button> inside a form
                    // defaults to type="submit", so copying would save the org.
                    <button
                      type="button"
                      onClick={copyOrgCode}
                      style={{
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)',
                        color: 'var(--color-text-muted)',
                        borderRadius: 6,
                        padding: '2px 8px',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {copiedOrgCode ? 'Copied' : 'Copy'}
                    </button>
                  )}
                </div>
                <p
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  Quote this when you contact support.
                </p>
              </div>

              {/* Name and Industry */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
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
                          options={
                          masterData?.industries.map((ind) => ({
                            label: ind.name,
                            value: ind.code,
                          })) || []
                        }
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
              </div>

              {/* Two column layout for email/phone */}
              <div
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}
              >
                <div className="org-form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    className={`org-form-input ${errors.email ? 'error' : ''}`}
                    placeholder="contact@company.com"
                    {...register('email')}
                  />
                  {errors.email && <p className="org-form-error-msg">{errors.email.message}</p>}
                </div>

                <div className="org-form-group">
                  <label>Phone</label>
                  <input
                    type="tel"
                    className={`org-form-input ${errors.phone ? 'error' : ''}`}
                    placeholder="9876543210"
                    {...register('phone')}
                    onInput={(e) => {
                      e.currentTarget.value = e.currentTarget.value.replace(/\D/g, '');
                    }}
                    maxLength={10}
                  />
                  {errors.phone && <p className="org-form-error-msg">{errors.phone.message}</p>}
                </div>
              </div>

              <div className="org-form-group">
                <label>Street</label>
                <input
                  type="text"
                  className={`org-form-input ${errors.address?.streetAddress1 ? 'error' : ''}`}
                  placeholder="E.g. 101, Business Center"
                  {...register('address.streetAddress1')}
                />
                {errors.address?.streetAddress1 && (
                  <p className="org-form-error-msg">{errors.address.streetAddress1.message}</p>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--space-2)',
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
                          options={
                            masterData?.countries.map((c) => ({ label: c.name, value: c.code })) ||
                            []
                          }
                          value={field.value}
                          onChange={(val) => {
                            if (val !== field.value) {
                              field.onChange(val);
                              setValue('address.stateCode', '');
                              setValue('address.city', '');
                            }
                          }}
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
                          options={availableStates.map((s) => ({ label: s.name, value: s.code }))}
                          value={field.value}
                          onChange={(val) => {
                            if (val !== field.value) {
                              field.onChange(val);
                              setValue('address.city', '');
                            }
                          }}
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
                          options={availableCities.map((c) => ({ label: c.name, value: c.id }))}
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
                <label>Website</label>
                <input
                  type="url"
                  className={`org-form-input ${errors.website ? 'error' : ''}`}
                  placeholder="https://example.com"
                  {...register('website')}
                />
                {errors.website && (
                  <p className="org-form-error-msg">{errors.website.message}</p>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  marginTop: 'var(--space-2)',
                  paddingTop: 'var(--space-2)',
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
                  {isSubmitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}
