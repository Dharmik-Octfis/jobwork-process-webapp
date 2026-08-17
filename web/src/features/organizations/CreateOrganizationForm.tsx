import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createOrganizationSchema, type CreateOrganizationData } from './organizations.schemas';
import { organizationsApi } from './organizations.api';
import { toApiErrorMessage } from '../../api/client';
import { X } from 'lucide-react';
import { useLogout } from '../auth/useLogout';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { LAST_ORG_KEY } from '../../routes/OrgRedirect';
import './CreateOrganizationForm.css';

type MasterData = {
  industries: { id: string; code: string; name: string }[];
  states: { code: string; name: string; countryCode: string; cities: { id: string; name: string }[] }[];
  countries: { id: string; name: string; code: string; isoCode: string; dialCode: string }[];
};

export function CreateOrganizationForm() {
  const navigate = useNavigate();
  const logoutMutation = useLogout();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    staleTime: 5 * 60 * 1000,
  });

  const handleClose = () => {
    if (organizations && organizations.length > 0) {
      navigate('/');
    } else {
      logoutMutation.mutate();
    }
  };
  const [masterData, setMasterData] = useState<MasterData | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setServerError('Image size must be 2 MB or less.');
      e.target.value = '';
      return;
    }
    setServerError(null);
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrganizationData>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: {
      address: {
        stateCode: 'IN-GJ',
        country: 'IN',
        city: '',
      },
      industryType: '',
      dialCode: '91',
    },
  });

  useEffect(() => {
    organizationsApi
      .getSeedData()
      .then((data) => {
        setMasterData(data);
        // Re-assert India once the country options exist: an uncontrolled
        // <select> can drop its selection when its options load in asynchronously.
        setValue('dialCode', '91');
        setValue('address.country', 'IN');
        setValue('address.stateCode', 'IN-GJ');
      })
      .catch((err) => console.error('Failed to load master data:', err));
  }, [setValue]);

  const selectedCountryCode = watch('address.country');
  const selectedStateCode = watch('address.stateCode');

  // Filter states by selected country
  const availableStates = masterData?.states.filter((s) => !selectedCountryCode || s.countryCode === selectedCountryCode) || [];

  const [isInitializing, setIsInitializing] = useState(true);
  useEffect(() => {
    if (isInitializing) {
      setIsInitializing(false);
      return;
    }
    if (selectedCountryCode && !isInitializing) {
      setValue('address.city', '');
      setValue('address.stateCode', '');
    }
  }, [selectedCountryCode, setValue, isInitializing]);

  // Clear city when state changes to avoid invalid combinations
  useEffect(() => {
    if (isInitializing) return;
    if (selectedStateCode && !isInitializing) {
      setValue('address.city', '');
    }
  }, [selectedStateCode, setValue, isInitializing]);

  const onSubmit = async (data: CreateOrganizationData) => {
    try {
      setServerError(null);
      const submitData = data;
      const createdOrg = await organizationsApi.createOrganization(submitData);
      const targetOrgId = createdOrg.organizationId || (createdOrg as unknown as { id?: string }).id;
      
      if (logoFile && targetOrgId) {
        await organizationsApi.uploadLogo(targetOrgId, logoFile);
      }

      if (targetOrgId) {
        localStorage.setItem(LAST_ORG_KEY, targetOrgId);
      }

      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
      
      if (targetOrgId) {
        navigate(`/organizations/${targetOrgId}`);
      } else {
        navigate('/');
      }
    } catch (err) {
      setServerError(toApiErrorMessage(err));
    }
  };

  const availableCities =
    selectedStateCode && masterData
      ? masterData.states.find((s) => s.code === selectedStateCode)?.cities || []
      : [];

  return (
    <div className="org-form-container">
      <div className="org-form-card">
        <button onClick={handleClose} className="org-form-close-btn" aria-label="Close">
          <X size={20} />
        </button>

        <div className="org-form-header">
          <h1>Create Organization</h1>
          <p>Enter the details of your new organization.</p>
        </div>

        {serverError && <div className="org-form-error">{serverError}</div>}

        <form onSubmit={handleSubmit(onSubmit)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface-2)',
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
                  alt="Logo Preview"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', padding: 4 }}>No Logo</span>
              )}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
                Organization Logo
              </label>
              <label
                style={{
                  cursor: 'pointer',
                  padding: '6px 12px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#374151',
                  display: 'inline-block',
                }}
              >
                Choose Image
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoSelect}
                  style={{ display: 'none' }}
                />
              </label>
              {logoPreview && (
                <button
                  type="button"
                  onClick={() => { setLogoFile(null); setLogoPreview(null); }}
                  style={{
                    marginLeft: 8,
                    padding: '6px 12px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #ef4444',
                    borderRadius: '6px',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#ef4444',
                    cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <div className="org-form-grid">
            <div className="org-form-field">
              <label className="org-form-label">
                Name <span className="required">*</span>
              </label>
              <input
                {...register('name')}
                className={`org-form-input ${errors.name ? 'has-error' : ''}`}
                placeholder="Organization Name"
              />
              {errors.name && <span className="org-form-error-text">{errors.name.message}</span>}
            </div>

            <div className="org-form-field">
              <label className="org-form-label">
                Industry Type <span className="required">*</span>
              </label>
              <Controller
                name="industryType"
                control={control}
                render={({ field }) => (
                  <SearchableSelect
                    options={masterData?.industries.map(ind => ({ label: ind.name, value: ind.code })) || []}
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Select Industry"
                  />
                )}
              />
              {errors.industryType && (
                <span className="org-form-error-text">{errors.industryType.message}</span>
              )}
            </div>
          </div>

          <div className="org-form-field org-form-full-width">
            <label className="org-form-label">Street</label>
            <textarea
              {...register('address.streetAddress1')}
              className="org-form-textarea"
              placeholder="Full physical address"
            />
          </div>

          <div className="org-form-grid">
            <div className="org-form-field">
              <label className="org-form-label">Country</label>
              <Controller
                name="address.country"
                control={control}
                render={({ field }) => (
                  <SearchableSelect
                    options={masterData?.countries.map(c => ({ label: c.name, value: c.code })) || []}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={!masterData}
                    placeholder="Select Country"
                  />
                )}
              />
            </div>

            <div className="org-form-field">
              <label className="org-form-label">State</label>
              <Controller
                name="address.stateCode"
                control={control}
                render={({ field }) => (
                  <SearchableSelect
                    options={availableStates.map(s => ({ label: s.name, value: s.code }))}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={!selectedCountryCode}
                    placeholder="Select State"
                  />
                )}
              />
            </div>

            <div className="org-form-field">
              <label className="org-form-label">City</label>
              <Controller
                name="address.city"
                control={control}
                render={({ field }) => (
                  <SearchableSelect
                    options={availableCities.map(c => ({ label: c.name, value: c.id }))}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={!selectedStateCode}
                    placeholder="Select City"
                  />
                )}
              />
            </div>

            <div className="org-form-field">
              <label className="org-form-label">Pincode</label>
              <input
                {...register('address.zip')}
                maxLength={6}
                className={`org-form-input ${errors.address?.zip ? 'has-error' : ''}`}
                placeholder="e.g. 380001"
                onInput={(e) => {
                  e.currentTarget.value = e.currentTarget.value.replace(/\D/g, '');
                }}
              />
              {errors.address?.zip && <span className="org-form-error-text">{errors.address.zip.message}</span>}
            </div>
          </div>

          <div className="org-form-grid">
            <div className="org-form-field">
              <label className="org-form-label">Email</label>
              <input
                {...register('email')}
                type="email"
                className={`org-form-input ${errors.email ? 'has-error' : ''}`}
                placeholder="company@example.com"
              />
              {errors.email && (
                <span className="org-form-error-text">{errors.email.message}</span>
              )}
            </div>

            <div className="org-form-field">
              <label className="org-form-label">Phone</label>
              <div
                className={`org-form-input-group ${errors.phone || errors.dialCode ? 'has-error' : ''}`}
              >
                <Controller
                  name="dialCode"
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      options={masterData?.countries ? masterData.countries.map(c => ({ label: `${c.isoCode} ${c.dialCode}`, value: c.dialCode })) : [{ label: 'IND 91', value: '91' }]}
                      value={field.value}
                      onChange={field.onChange}
                      style={{ width: '130px', flexShrink: 0 }}
                      className="org-form-select"
                      placeholder="Code"
                    />
                  )}
                />
                <div className="divider"></div>
                <input
                  {...register('phone')}
                  type="tel"
                  maxLength={10}
                  className="org-form-input"
                  placeholder="Mobile Number"
                  onInput={(e) => {
                    e.currentTarget.value = e.currentTarget.value.replace(/\D/g, '');
                  }}
                />
              </div>
              {errors.phone && <span className="org-form-error-text">{errors.phone.message}</span>}
            </div>
          </div>

          <div className="org-form-field org-form-full-width">
            <label className="org-form-label">Website</label>
            <input
              {...register('website')}
              type="text"
              className={`org-form-input ${errors.website ? 'has-error' : ''}`}
              placeholder="https://example.com"
            />
            {errors.website && (
              <span className="org-form-error-text">{errors.website.message}</span>
            )}
          </div>

          <div className="org-form-actions">
            <button type="submit" disabled={isSubmitting} className="org-form-submit-btn">
              {isSubmitting ? 'Creating...' : 'Create Organization'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
