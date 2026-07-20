import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createOrganizationSchema, type CreateOrganizationData } from './organizations.schemas';
import { organizationsApi } from './organizations.api';
import { toApiErrorMessage } from '../../api/client';
import { X } from 'lucide-react';
import { useLogout } from '../auth/useLogout';
import './CreateOrganizationForm.css';

type MasterData = {
  industries: { id: string; code: string; name: string }[];
  states: { id: string; name: string; cities: { id: string; name: string }[] }[];
  countries: { id: string; name: string; code: string; isoCode: string }[];
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
    formState: { errors, isSubmitting },
  } = useForm<CreateOrganizationData>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: {
      state: '',
      city: '',
      industryCode: '',
      dialCode: '+91',
    },
  });

  const selectedState = watch('state');

  // Clear city when state changes to avoid invalid combinations
  useEffect(() => {
    if (selectedState) {
      setValue('city', '');
    }
  }, [selectedState, setValue]);

  const onSubmit = async (data: CreateOrganizationData) => {
    try {
      setServerError(null);
      const submitData = data;
      await organizationsApi.createOrganization(submitData);
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
      navigate('/'); // Go back to dashboard or organizations list after onboarding
    } catch (err) {
      setServerError(toApiErrorMessage(err));
    }
  };

  const availableCities =
    selectedState && masterData
      ? masterData.states.find((s) => s.name === selectedState)?.cities || []
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
              <select
                {...register('industryCode')}
                className={`org-form-select ${errors.industryCode ? 'has-error' : ''}`}
              >
                <option value="" disabled>
                  Select Industry
                </option>
                {masterData?.industries.map((ind) => (
                  <option key={ind.id} value={ind.code}>
                    {ind.name}
                  </option>
                ))}
              </select>
              {errors.industryCode && (
                <span className="org-form-error-text">{errors.industryCode.message}</span>
              )}
            </div>
          </div>

          <div className="org-form-field org-form-full-width">
            <label className="org-form-label">Address</label>
            <textarea
              {...register('orgAddress')}
              className="org-form-textarea"
              placeholder="Full physical address"
            />
          </div>

          <div className="org-form-grid">
            <div className="org-form-field">
              <label className="org-form-label">State</label>
              <select {...register('state')} className="org-form-select">
                <option value="" disabled>
                  Select State
                </option>
                {masterData?.states.map((stateObj) => (
                  <option key={stateObj.id} value={stateObj.name}>
                    {stateObj.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="org-form-field">
              <label className="org-form-label">City</label>
              <select {...register('city')} disabled={!selectedState} className="org-form-select">
                <option value="" disabled>
                  Select City
                </option>
                {availableCities.map((city) => (
                  <option key={city.id} value={city.name}>
                    {city.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="org-form-field org-form-full-width">
            <label className="org-form-label">Pincode</label>
            <input
              {...register('zip')}
              maxLength={6}
              className={`org-form-input ${errors.zip ? 'has-error' : ''}`}
              placeholder="e.g. 380001"
              onInput={(e) => {
                e.currentTarget.value = e.currentTarget.value.replace(/\D/g, '');
              }}
            />
            {errors.zip && <span className="org-form-error-text">{errors.zip.message}</span>}
          </div>

          <div className="org-form-grid">
            <div className="org-form-field">
              <label className="org-form-label">GST Number</label>
              <input
                {...register('taxIdValue')}
                maxLength={15}
                className={`org-form-input ${errors.taxIdValue ? 'has-error' : ''}`}
                placeholder="22AAAAA0000A1Z5"
                style={{ textTransform: 'uppercase' }}
              />
              {errors.taxIdValue && (
                <span className="org-form-error-text">{errors.taxIdValue.message}</span>
              )}
            </div>

            <div className="org-form-field">
              <label className="org-form-label">Phone No</label>
              <div className={`org-form-input-group ${errors.phone ? 'has-error' : ''}`}>
                <select
                  {...register('dialCode')}
                  className="org-form-select"
                  style={{ width: 'auto', flexShrink: 0 }}
                >
                  {masterData?.countries ? (
                    masterData.countries.map((country) => (
                      <option key={country.id} value={country.code}>
                        {country.isoCode} {country.code}
                      </option>
                    ))
                  ) : (
                    <option value="+91">IND +91</option>
                  )}
                </select>
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
            <label className="org-form-label">Email</label>
            <input
              {...register('email')}
              type="email"
              className={`org-form-input ${errors.email ? 'has-error' : ''}`}
              placeholder="company@example.com"
            />
            {errors.email && <span className="org-form-error-text">{errors.email.message}</span>}
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
