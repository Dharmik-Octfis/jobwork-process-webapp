import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { fetchLocations, type Location, type CreateLocationData } from './locations.api';
import { useParams } from 'react-router-dom';
import { ParentLocationDropdown } from './ParentLocationDropdown';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { organizationsApi } from '../../organizations/organizations.api';

interface SeedCountry {
  name: string;
  code: string;
}

interface SeedCity {
  name: string;
}

interface SeedState {
  name: string;
  countryCode: string;
  cities: SeedCity[];
}

export interface LocationFormProps {
  initialData?: Partial<Location>;
  onSubmit: (data: CreateLocationData) => void;
  isPending: boolean;
  onCancel: () => void;
}

export function LocationForm({ initialData, onSubmit, isPending, onCancel }: LocationFormProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const [isChildLocation, setIsChildLocation] = useState(!!initialData?.parentId);

  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<CreateLocationData>({
    defaultValues: {
      type: initialData?.type || 'Business',
      name: initialData?.name || '',
      parentId: initialData?.parentId || null,
      logo: initialData?.logo || '',
      street1: initialData?.street1 || '',
      street2: initialData?.street2 || '',
      city: initialData?.city || '',
      state: initialData?.state || '',
      zip: initialData?.zip || '',
      country: initialData?.country || 'India',
      phone: initialData?.phone || '',
    },
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: Boolean(orgId),
  });

  const { data: seedData } = useQuery({
    queryKey: ['seedData'],
    queryFn: () => organizationsApi.getSeedData(),
  });

  const watchCountry = watch('country');
  const watchState = watch('state');

  const countryOptions = seedData?.countries?.map((c: SeedCountry) => ({ label: c.name, value: c.name })) || [];
  
  const selectedCountryObj = seedData?.countries?.find((c: SeedCountry) => c.name === watchCountry);
  const stateOptions = seedData?.states
    ?.filter((s: SeedState) => !selectedCountryObj || s.countryCode === selectedCountryObj.code)
    ?.map((s: SeedState) => ({ label: s.name, value: s.name })) || [];

  const selectedStateObj = seedData?.states?.find((s: SeedState) => s.name === watchState);
  const cityOptions = selectedStateObj?.cities?.map((c: SeedCity) => ({ label: c.name, value: c.name })) || [];

  // Filter out the current location from parent options to avoid circular dependency
  const availableParents = locations.filter((loc) => loc.id !== initialData?.id);
  const rootLocations = availableParents.filter((loc) => !loc.parentId);
  const getChildLocations = (parentId: string) => availableParents.filter((loc) => loc.parentId === parentId);

  const watchType = watch('type');

  const flattenedLocations: { id: string; name: string; depth: number }[] = [];
  const buildFlattenedLocations = (location: Location, depth = 0) => {
    flattenedLocations.push({ id: location.id, name: location.name, depth });
    const children = getChildLocations(location.id);
    children.forEach((child) => buildFlattenedLocations(child, depth + 1));
  };
  rootLocations.forEach((rootLoc) => buildFlattenedLocations(rootLoc, 0));

  const labelStyle = { display: 'block', fontSize: '13px', color: '#111', marginBottom: '6px' };
  const inputStyle = { width: '100%', maxWidth: '440px', padding: '6px 8px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff', minHeight: '32px' };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ padding: '24px 32px', paddingBottom: '200px' }}>
      <div style={{ marginBottom: '24px' }}>
        <label style={labelStyle}>Location Type</label>
        <div style={{ display: 'flex', gap: '16px', maxWidth: '600px' }}>
          <label style={{
            flex: 1, padding: '16px', border: watchType === 'Business' ? '1px solid #0062ff' : '1px solid #eef0f3',
            borderRadius: '6px', background: watchType === 'Business' ? '#f0f4ff' : '#fff', cursor: 'pointer'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <input type="radio" value="Business" {...register('type')} />
              <strong style={{ fontSize: '14px', color: '#111' }}>Business Location</strong>
            </div>
            <p style={{ fontSize: '12px', color: '#555', margin: 0, paddingLeft: '24px', lineHeight: 1.4 }}>
              A Business Location represents your organization or office's operational location. It is used to record transactions, assess regional performance, and monitor stock levels for items stored at this location.
            </p>
          </label>
          <label style={{
            flex: 1, padding: '16px', border: watchType === 'Warehouse' ? '1px solid #0062ff' : '1px solid #eef0f3',
            borderRadius: '6px', background: watchType === 'Warehouse' ? '#f0f4ff' : '#fff', cursor: 'pointer'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <input type="radio" value="Warehouse" {...register('type')} />
              <strong style={{ fontSize: '14px', color: '#111' }}>Warehouse Only Location</strong>
            </div>
            <p style={{ fontSize: '12px', color: '#555', margin: 0, paddingLeft: '24px', lineHeight: 1.4 }}>
              A Warehouse Only Location refers to where your items are stored. It helps track and monitor stock levels for items stored at this location.
            </p>
          </label>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', rowGap: '20px', alignItems: 'center', marginBottom: '24px' }}>
        {watchType === 'Business' && (
          <>
            <label style={labelStyle}>Logo</label>
            <Controller
              name="logo"
              control={control}
              render={({ field: { onChange, value } }) => (
                <SearchableSelect
                  value={value || ''}
                  onChange={onChange}
                  options={[
                    { label: 'Same as Organization Logo', value: '' },
                    { label: 'Upload Custom Logo (Not implemented yet)', value: 'custom' },
                  ]}
                  style={{ maxWidth: '440px' }}
                />
              )}
            />
          </>
        )}

        <label style={{ ...labelStyle, color: '#ef4444' }}>Name*</label>
        <div>
          <input type="text" {...register('name', { required: true })} style={inputStyle} placeholder="Location Name" />
          {errors.name && <span style={{ color: '#e54d4d', fontSize: '11px', display: 'block', marginTop: '4px' }}>Name is required</span>}
        </div>

        <div></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
          <input type="checkbox" checked={isChildLocation} onChange={(e) => {
            setIsChildLocation(e.target.checked);
            if (!e.target.checked) register('parentId').onChange({ target: { value: null } });
          }} />
          This is a Child Location
        </label>

        {isChildLocation && (
          <>
            <label style={{ ...labelStyle, color: '#ef4444' }}>Parent Location*</label>
            <div>
              <Controller
                name="parentId"
                control={control}
                rules={{ required: isChildLocation }}
                render={({ field: { onChange, value } }) => (
                  <ParentLocationDropdown
                    value={value || ''}
                    onChange={onChange}
                    options={flattenedLocations}
                    style={{ maxWidth: '440px' }}
                  />
                )}
              />
              {errors.parentId && <span style={{ color: '#e54d4d', fontSize: '11px', display: 'block', marginTop: '4px' }}>Parent Location is required</span>}
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', rowGap: '12px', alignItems: 'start' }}>
        <label style={{ ...labelStyle, marginTop: '8px' }}>Address</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <input type="text" {...register('street1')} style={inputStyle} placeholder="Street 1" />
          <input type="text" {...register('street2')} style={inputStyle} placeholder="Street 2" />
          <Controller
            name="country"
            control={control}
            render={({ field: { onChange, value } }) => (
              <SearchableSelect
                value={value || 'India'}
                onChange={onChange}
                options={countryOptions}
                style={{ maxWidth: '440px' }}
              />
            )}
          />
          <div style={{ display: 'flex', gap: '12px', maxWidth: '440px' }}>
            <Controller
              name="state"
              control={control}
              render={({ field: { onChange, value } }) => (
                <SearchableSelect
                  value={value || ''}
                  onChange={onChange}
                  placeholder="Select State"
                  options={stateOptions}
                  style={{ flex: 1 }}
                />
              )}
            />
            <Controller
              name="city"
              control={control}
              render={({ field: { onChange, value } }) => (
                <SearchableSelect
                  value={value || ''}
                  onChange={onChange}
                  placeholder="Select City"
                  options={cityOptions}
                  style={{ flex: 1 }}
                />
              )}
            />
          </div>
          <div style={{ display: 'flex', gap: '12px', maxWidth: '440px' }}>
            <input type="text" {...register('zip')} style={{ ...inputStyle, flex: 1 }} placeholder="Zip/Pin Code" />
            <input type="text" {...register('phone')} style={{ ...inputStyle, flex: 1 }} placeholder="Phone" />
          </div>
        </div>
      </div>

      <div
        style={{
          height: '44px',
          boxSizing: 'border-box',
          position: 'fixed',
          bottom: 0,
          left: 220,
          right: 0,
          background: '#fff',
          padding: '0 24px',
          borderTop: '1px solid #eef0f3',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          zIndex: 100,
        }}
      >
        <button
          type="submit"
          disabled={isPending}
          style={{
            padding: '6px 20px',
            background: '#0062ff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '13px',
          }}
        >
          {isPending ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '6px 20px',
            background: 'white',
            color: '#333',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '13px',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
