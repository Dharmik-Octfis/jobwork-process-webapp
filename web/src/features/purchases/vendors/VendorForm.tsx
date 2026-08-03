import { useState, useEffect } from 'react';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, Settings } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createVendorSchema, type CreateVendorData } from './vendors.schemas';
import { fetchVendorNumberPreference, updateVendorNumberPreference } from './vendors.api';
import { VendorNumberConfigModal } from './VendorNumberConfigModal';
import { useCurrencies } from '../../configuration/currencies/currencies.api';
import { CustomFieldsSection } from '../../custom-fields/CustomFieldsSection';
import { usePaymentTerms } from '../../sales/customers/payment-terms.api';
import { PaymentTermModal } from '../../sales/customers/PaymentTermModal';
import { PaymentTermDropdown } from '../../sales/customers/PaymentTermDropdown';
import { CurrencyDropdown } from '../../sales/customers/CurrencyDropdown';
import { CurrencyFormModal } from '../../configuration/currencies/CurrencyFormModal';
import { Select } from '../../../components/ui/Select';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { PhoneInput } from '../../../components/ui/PhoneInput';
import { ComboBox } from '../../../components/ui/ComboBox';
import { organizationsApi } from '../../organizations/organizations.api';
import './vendor-form.css';

type MasterData = {
  industries: { id: string; code: string; name: string }[];
  states: {
    code: string;
    name: string;
    countryCode: string;
    cities: { id: string; name: string }[];
  }[];
  countries: { id: string; name: string; code: string; isoCode: string; dialCode: string }[];
};

interface VendorFormProps {
  initialData?: Partial<CreateVendorData>;
  onSubmit: (data: CreateVendorData) => void;
  isSubmitting: boolean;
  isEdit?: boolean;
  customFieldErrors?: Record<string, string>;
}

export function VendorForm({
  initialData,
  onSubmit,
  isSubmitting,
  isEdit = false,
  customFieldErrors,
}: VendorFormProps) {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const { data: customFields = [] } = useActiveCustomFields(orgId!, 'vendor');
  const [activeTab, setActiveTab] = useState('other');
  const [isNumberConfigOpen, setIsNumberConfigOpen] = useState(false);
  const [masterData, setMasterData] = useState<MasterData | null>(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    organizationsApi.getSeedData().then(setMasterData);
  }, []);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateVendorData>({
    resolver: zodResolver(createVendorSchema),
    defaultValues: initialData || {
      contactPersons: [
        {
          salutation: '',
          firstName: '',
          lastName: '',
          email: '',
          phone: '',
          mobile: '',
        },
      ],
    },
  });

  const { data: preference } = useQuery({
    queryKey: ['vendor-number-preference', orgId],
    queryFn: () => fetchVendorNumberPreference(orgId!),
    enabled: !!orgId,
  });

  const { data: currencies } = useCurrencies(orgId!);
  const { data: paymentTerms } = usePaymentTerms(orgId!);
  const [isPaymentTermModalOpen, setIsPaymentTermModalOpen] = useState(false);
  const [isCurrencyModalOpen, setIsCurrencyModalOpen] = useState(false);

  const [lastPrefilledNumber, setLastPrefilledNumber] = useState('');

  // Pre-fill vendor number if it's empty and we have a preference (typically only on new vendor creation)
  useEffect(() => {
    if (preference && !isEdit) {
      const generatedNumber = `${preference.prefix}${preference.nextNumber.toString().padStart(5, '0')}`;
      const currentValue = watch('contactNumber');

      if (!currentValue || currentValue === lastPrefilledNumber) {
        setValue('contactNumber', generatedNumber);
        setLastPrefilledNumber(generatedNumber);
      }
    }
  }, [preference, isEdit, setValue, watch, lastPrefilledNumber]);

  const companyName = watch('companyName');
  const primaryContactFirstName = watch('primaryContactFirstName');
  const primaryContactLastName = watch('primaryContactLastName');
  const contactNameValue = watch('contactName');
  const [displayNameOptions, setDisplayNameOptions] = useState<string[]>([]);

  useEffect(() => {
    const options = Array.from(
      new Set(
        [
          contactNameValue,
          companyName,
          [primaryContactFirstName, primaryContactLastName].filter(Boolean).join(' '),
          [primaryContactLastName, primaryContactFirstName].filter(Boolean).join(', '),
          companyName && primaryContactFirstName
            ? `${companyName} - ${primaryContactFirstName} ${primaryContactLastName}`.trim()
            : '',
        ].filter(Boolean),
      ),
    );
    setDisplayNameOptions(options);
  }, [companyName, primaryContactFirstName, primaryContactLastName, contactNameValue]);



  const updatePreferenceMutation = useMutation({
    mutationFn: (data: { prefix: string; nextNumber: number }) =>
      updateVendorNumberPreference(orgId!, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['vendor-number-preference', orgId], data);
      setValue('contactNumber', `${data.prefix}${data.nextNumber.toString().padStart(5, '0')}`);
      setIsNumberConfigOpen(false);
    },
  });

  const {
    fields: contactPersons,
    append: appendContactPerson,
    remove: removeContactPerson,
  } = useFieldArray({
    control,
    name: 'contactPersons',
  });

  const handleCopyBillingToShipping = () => {
    setValue('shippingAttention', watch('billingAttention'));
    setValue('shippingCountry', watch('billingCountry'));
    setValue('shippingStreet1', watch('billingStreet1'));
    setValue('shippingStreet2', watch('billingStreet2'));
    setValue('shippingCity', watch('billingCity'));
    setValue('shippingState', watch('billingState'));
    setValue('shippingPinCode', watch('billingPinCode'));
    setValue('shippingPhone', watch('billingPhone'));
  };

  const billingCountry = watch('billingCountry');
  const billingCountryCode = masterData?.countries.find((c) => c.name === billingCountry)?.code;
  const billingStateOptions =
    masterData?.states
      .filter((s) => !billingCountryCode || s.countryCode === billingCountryCode)
      .map((s) => ({ label: s.name, value: s.name })) || [];
  const billingStateName = watch('billingState');
  const billingStateObj = masterData?.states.find(
    (s) => s.name === billingStateName && s.countryCode === billingCountryCode,
  );
  const billingCityOptions =
    billingStateObj?.cities.map((c) => ({ label: c.name, value: c.name })) || [];

  const shippingCountry = watch('shippingCountry');
  const shippingCountryCode = masterData?.countries.find((c) => c.name === shippingCountry)?.code;
  const shippingStateOptions =
    masterData?.states
      .filter((s) => !shippingCountryCode || s.countryCode === shippingCountryCode)
      .map((s) => ({ label: s.name, value: s.name })) || [];
  const shippingStateName = watch('shippingState');
  const shippingStateObj = masterData?.states.find(
    (s) => s.name === shippingStateName && s.countryCode === shippingCountryCode,
  );
  const shippingCityOptions =
    shippingStateObj?.cities.map((c) => ({ label: c.name, value: c.name })) || [];

  const labelStyle = {
    paddingTop: '0',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: '#111',
  };
  const inputStyle = {
    width: '100%',
    maxWidth: '440px',
    padding: '6px 8px',
    fontSize: '13px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
  };

  const tabBtnStyle = (isActive: boolean) => ({
    padding: '12px 0',
    border: 'none',
    background: 'none',
    borderBottom: isActive ? '2px solid #0062ff' : '2px solid transparent',
    color: isActive ? '#111' : '#555',
    fontWeight: isActive ? 500 : 400,
    fontSize: '13px',
    cursor: 'pointer',
  });

  return (
    <div
      className="vendor-form-container"
      style={{
        padding: 0,
        margin: 0,
        background: '#fff',
        width: '100%',
        minHeight: '100vh',
        display: 'block',
        paddingBottom: '80px',
      }}
    >
      {/* Header */}
      <div style={{ padding: '24px 32px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 400, margin: 0, color: '#000' }}>
          {isEdit ? 'Edit Vendor' : 'New Vendor'}
        </h1>
      </div>

      <form onSubmit={handleSubmit((data) => {
        const cleanedData = {
          ...data,
          contactPersons: data.contactPersons?.filter(cp =>
            cp.firstName?.trim() || cp.lastName?.trim() || cp.email?.trim() || cp.phone?.trim() || cp.mobile?.trim()
          )
        };
        onSubmit(cleanedData);
      })} style={{ padding: '32px' }}>
        {/* Main Details Section */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '200px 1fr',
            rowGap: '20px',
            columnGap: '16px',
            marginBottom: '40px',
            alignItems: 'center',
            fontSize: '13px',
          }}
        >
          <label style={labelStyle}>Primary Contact</label>
          <div style={{ display: 'flex', gap: '12px', maxWidth: '440px' }}>
            <Controller
              control={control}
              name="primaryContactSalutation"
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
              {...register('primaryContactFirstName')}
              placeholder="First Name"
              style={{ ...inputStyle, flex: 1 }}
            />
            <input
              {...register('primaryContactLastName')}
              placeholder="Last Name"
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>

          <label style={labelStyle}>Company Name</label>
          <input
            {...register('companyName')}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, color: '#ef4444' }}>Display Name*</label>
          <div>
            <Controller
              control={control}
              name="contactName"
              render={({ field }) => (
                <ComboBox
                  value={field.value || ''}
                  onChange={(val) => {
                    field.onChange(val);
                  }}
                  options={displayNameOptions}
                  placeholder=" Select or Type to add"
                  hasError={!!errors.contactName}
                  style={{ maxWidth: '440px' }}
                />
              )}
            />
            {errors.contactName && (
              <div style={{ color: 'red', fontSize: '12px', marginTop: '4px' }}>
                {errors.contactName.message}
              </div>
            )}
          </div>

          <label style={labelStyle}>Email Address</label>
          <div style={{ position: 'relative', maxWidth: '440px' }}>
            <span
              style={{
                position: 'absolute',
                left: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#888',
              }}
            >
              ✉
            </span>
            <input
              {...register('email')}
              type="email"
              style={{ ...inputStyle, paddingLeft: '28px' }}
            />
          </div>

          <label style={{ ...labelStyle, color: '#ef4444' }}>Vendor Number*</label>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input {...register('contactNumber')} style={{ ...inputStyle, flex: 1 }} />
              <button
                type="button"
                onClick={() => setIsNumberConfigOpen(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                }}
              >
                <Settings size={18} />
              </button>
            </div>
            {errors.contactNumber && (
              <div style={{ color: 'red', fontSize: '12px', marginTop: '4px' }}>
                {errors.contactNumber.message}
              </div>
            )}
          </div>

          <label style={labelStyle}>Phone</label>
          <div style={{ display: 'flex', gap: '16px', maxWidth: '440px' }}>
            <div style={{ flex: 1 }}>
              <Controller
                control={control}
                name="phone"
                render={({ field }) => (
                  <PhoneInput
                    value={field.value || ''}
                    onChange={field.onChange}
                    countries={masterData?.countries || []}
                  />
                )}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Controller
                control={control}
                name="mobile"
                render={({ field }) => (
                  <PhoneInput
                    value={field.value || ''}
                    onChange={field.onChange}
                    countries={masterData?.countries || []}
                  />
                )}
              />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div
          style={{
            borderBottom: '1px solid #eef0f3',
            marginBottom: '24px',
            display: 'flex',
            gap: '32px',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('other')}
            style={tabBtnStyle(activeTab === 'other')}
          >
            Other Details
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('address')}
            style={tabBtnStyle(activeTab === 'address')}
          >
            Address
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('contact')}
            style={tabBtnStyle(activeTab === 'contact')}
          >
            Contact Persons
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('custom')}
            style={tabBtnStyle(activeTab === 'custom')}
          >
            Custom Fields
            {customFields.some((f) => f.isRequired) && <span style={{ color: '#ef4444' }}>*</span>}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('remarks')}
            style={tabBtnStyle(activeTab === 'remarks')}
          >
            Remarks
          </button>
        </div>

        {/* Tab Content */}
        <div style={{ marginBottom: '60px', minHeight: '300px' }}>
          {/* Other Details Tab */}
          {activeTab === 'other' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '200px 1fr',
                rowGap: '20px',
                columnGap: '16px',
                fontSize: '13px',
                alignItems: 'center',
              }}
            >
              <label style={labelStyle}>Currency</label>
              <CurrencyDropdown
                value={watch('currency') || ''}
                onChange={(val) =>
                  setValue('currency', val, { shouldValidate: true, shouldDirty: true })
                }
                currencies={currencies || []}
                onAddNew={() => setIsCurrencyModalOpen(true)}
                style={{ maxWidth: '440px' }}
              />

              <label style={labelStyle}>Payment Terms</label>
              <PaymentTermDropdown
                value={watch('paymentTerms') || ''}
                onChange={(val) =>
                  setValue('paymentTerms', val, { shouldValidate: true, shouldDirty: true })
                }
                paymentTerms={paymentTerms || []}
                onAddNew={() => setIsPaymentTermModalOpen(true)}
                style={{ maxWidth: '440px' }}
              />
            </div>
          )}

          {/* Address Tab */}
          {activeTab === 'address' && (
            <div style={{ display: 'flex', gap: '64px' }}>
              {/* Billing */}
              <div style={{ flex: 1, maxWidth: '500px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '24px' }}>
                  BILLING ADDRESS
                </h3>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '140px 1fr',
                    rowGap: '16px',
                    columnGap: '16px',
                    alignItems: 'start',
                    fontSize: '13px',
                  }}
                >
                  <label style={labelStyle}>Attention</label>
                  <input {...register('billingAttention')} style={inputStyle} />

                  <label style={labelStyle}>Address</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <textarea
                      {...register('billingStreet1')}
                      placeholder="Street 1"
                      rows={2}
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                    <textarea
                      {...register('billingStreet2')}
                      placeholder="Street 2"
                      rows={2}
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                  </div>

                  <label style={labelStyle}>Country/Region</label>
                  <Controller
                    control={control}
                    name="billingCountry"
                    render={({ field }) => (
                      <SearchableSelect
                        value={field.value || ''}
                        onChange={(val) => {
                          field.onChange(val);
                          setValue('billingState', ''); // Reset state on country change
                          setValue('billingCity', ''); // Reset city on country change
                        }}
                        options={
                          masterData?.countries.map((c) => ({ label: c.name, value: c.name })) || []
                        }
                        placeholder="Select Country"
                        disabled={!masterData}
                      />
                    )}
                  />

                  <label style={labelStyle}>State</label>
                  {billingCountry === 'India' ? (
                    <Controller
                      control={control}
                      name="billingState"
                      render={({ field }) => (
                        <SearchableSelect
                          value={field.value || ''}
                          onChange={(val) => {
                            field.onChange(val);
                            setValue('billingCity', '');
                          }}
                          options={billingStateOptions}
                          placeholder="Select State"
                          disabled={billingStateOptions.length === 0}
                        />
                      )}
                    />
                  ) : (
                    <input {...register('billingState')} style={inputStyle} placeholder="State" />
                  )}

                  <label style={labelStyle}>City</label>
                  {billingCountry === 'India' ? (
                    <Controller
                      control={control}
                      name="billingCity"
                      render={({ field }) => (
                        <SearchableSelect
                          value={field.value || ''}
                          onChange={field.onChange}
                          options={billingCityOptions}
                          placeholder="Select City"
                          disabled={!watch('billingState') || billingCityOptions.length === 0}
                        />
                      )}
                    />
                  ) : (
                    <input {...register('billingCity')} style={inputStyle} placeholder="City" />
                  )}

                  <label style={labelStyle}>Pin Code</label>
                  <input {...register('billingPinCode')} style={inputStyle} />

                  <label style={labelStyle}>Phone</label>
                  <Controller
                    control={control}
                    name="billingPhone"
                    render={({ field }) => (
                      <PhoneInput
                        value={field.value || ''}
                        onChange={field.onChange}
                        countries={masterData?.countries || []}
                      />
                    )}
                  />
                </div>
              </div>

              {/* Shipping */}
              <div style={{ flex: 1, maxWidth: '500px' }}>
                <h3
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    marginBottom: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  SHIPPING ADDRESS
                  <button
                    type="button"
                    onClick={handleCopyBillingToShipping}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#0062ff',
                      fontSize: '13px',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    ( ↓ Copy billing address )
                  </button>
                </h3>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '140px 1fr',
                    rowGap: '16px',
                    columnGap: '16px',
                    alignItems: 'start',
                    fontSize: '13px',
                  }}
                >
                  <label style={labelStyle}>Attention</label>
                  <input {...register('shippingAttention')} style={inputStyle} />

                  <label style={labelStyle}>Address</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <textarea
                      {...register('shippingStreet1')}
                      placeholder="Street 1"
                      rows={2}
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                    <textarea
                      {...register('shippingStreet2')}
                      placeholder="Street 2"
                      rows={2}
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                  </div>

                  <label style={labelStyle}>Country/Region</label>
                  <Controller
                    control={control}
                    name="shippingCountry"
                    render={({ field }) => (
                      <SearchableSelect
                        value={field.value || ''}
                        onChange={(val) => {
                          field.onChange(val);
                          setValue('shippingState', ''); // Reset state on country change
                          setValue('shippingCity', ''); // Reset city on country change
                        }}
                        options={
                          masterData?.countries.map((c) => ({ label: c.name, value: c.name })) || []
                        }
                        placeholder="Select Country"
                        disabled={!masterData}
                      />
                    )}
                  />

                  <label style={labelStyle}>State</label>
                  {shippingCountry === 'India' ? (
                    <Controller
                      control={control}
                      name="shippingState"
                      render={({ field }) => (
                        <SearchableSelect
                          value={field.value || ''}
                          onChange={(val) => {
                            field.onChange(val);
                            setValue('shippingCity', '');
                          }}
                          options={shippingStateOptions}
                          placeholder="Select State"
                          disabled={shippingStateOptions.length === 0}
                        />
                      )}
                    />
                  ) : (
                    <input {...register('shippingState')} style={inputStyle} placeholder="State" />
                  )}

                  <label style={labelStyle}>City</label>
                  {shippingCountry === 'India' ? (
                    <Controller
                      control={control}
                      name="shippingCity"
                      render={({ field }) => (
                        <SearchableSelect
                          value={field.value || ''}
                          onChange={field.onChange}
                          options={shippingCityOptions}
                          placeholder="Select City"
                          disabled={!watch('shippingState') || shippingCityOptions.length === 0}
                        />
                      )}
                    />
                  ) : (
                    <input {...register('shippingCity')} style={inputStyle} placeholder="City" />
                  )}

                  <label style={labelStyle}>Pin Code</label>
                  <input {...register('shippingPinCode')} style={inputStyle} />

                  <label style={labelStyle}>Phone</label>
                  <Controller
                    control={control}
                    name="shippingPhone"
                    render={({ field }) => (
                      <PhoneInput
                        value={field.value || ''}
                        onChange={field.onChange}
                        countries={masterData?.countries || []}
                      />
                    )}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Contact Persons Tab */}
          {activeTab === 'contact' && (
            <div>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  marginBottom: '16px',
                  fontSize: '13px',
                }}
              >
                <thead>
                  <tr style={{ borderBottom: '1px solid #ddd', color: '#555', textAlign: 'left' }}>
                    <th style={{ padding: '12px 8px' }}>SALUTATION</th>
                    <th style={{ padding: '12px 8px' }}>FIRST NAME</th>
                    <th style={{ padding: '12px 8px' }}>LAST NAME</th>
                    <th style={{ padding: '12px 8px' }}>EMAIL ADDRESS</th>
                    <th style={{ padding: '12px 8px' }}>WORK PHONE</th>
                    <th style={{ padding: '12px 8px' }}>MOBILE</th>
                    <th style={{ padding: '12px 8px', width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {contactPersons.map((field, index) => (
                    <tr key={field.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>
                        <Controller
                          control={control}
                          name={`contactPersons.${index}.salutation`}
                          render={({ field }) => (
                            <Select
                              value={field.value || ''}
                              onChange={field.onChange}
                              options={[
                                { value: '', label: '' },
                                { value: 'Mr.', label: 'Mr.' },
                                { value: 'Mrs.', label: 'Mrs.' },
                                { value: 'Ms.', label: 'Ms.' },
                              ]}
                              minWidth={80}
                              fullWidth={false}
                            />
                          )}
                        />
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>
                        <input
                          {...register(`contactPersons.${index}.firstName`)}
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>
                        <input
                          {...register(`contactPersons.${index}.lastName`)}
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>
                        <input
                          {...register(`contactPersons.${index}.email`)}
                          type="email"
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>
                        <Controller
                          control={control}
                          name={`contactPersons.${index}.phone`}
                          render={({ field }) => (
                            <PhoneInput
                              value={field.value || ''}
                              onChange={field.onChange}
                              countries={masterData?.countries || []}
                            />
                          )}
                        />
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>
                        <Controller
                          control={control}
                          name={`contactPersons.${index}.mobile`}
                          render={({ field }) => (
                            <PhoneInput
                              value={field.value || ''}
                              onChange={field.onChange}
                              countries={masterData?.countries || []}
                            />
                          )}
                        />
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '13px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => removeContactPerson(index)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#e54d4d',
                            cursor: 'pointer',
                            padding: '4px',
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {contactPersons.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{ padding: '24px', textAlign: 'center', color: '#999' }}
                      >
                        No contact persons added.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <button
                type="button"
                onClick={() =>
                  appendContactPerson({
                    salutation: '',
                    firstName: '',
                    lastName: '',
                    email: '',
                    phone: '',
                    mobile: '',
                  })
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  background: '#f0f4ff',
                  color: '#0062ff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '13px',
                }}
              >
                <Plus size={16} /> Add Contact Person
              </button>
            </div>
          )}

          {activeTab === 'custom' && orgId && (
            <CustomFieldsSection
              orgId={orgId}
              entityType="vendor"
              values={(watch('customFields') as Record<string, unknown>) ?? {}}
              onChange={(v) => setValue('customFields', v, { shouldDirty: true })}
              errors={customFieldErrors}
              applyDefaults={!isEdit}
            />
          )}

          {activeTab === 'remarks' && (
            <div style={{ padding: '24px 0' }}>
              <label style={{ ...labelStyle, marginBottom: '8px' }}>
                Remarks (For Internal Use)
              </label>
              <textarea
                {...register('notes')}
                rows={4}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>
          )}
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
            disabled={isSubmitting}
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
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/organizations/${orgId}/purchases/vendors`)}
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

      <VendorNumberConfigModal
        isOpen={isNumberConfigOpen}
        onClose={() => setIsNumberConfigOpen(false)}
        initialPrefix={preference?.prefix}
        initialNextNumber={preference?.nextNumber?.toString().padStart(5, '0')}
        onSave={(prefix, nextNumber) => {
          updatePreferenceMutation.mutate({ prefix, nextNumber: parseInt(nextNumber, 10) || 1 });
        }}
      />
      <PaymentTermModal
        orgId={orgId!}
        isOpen={isPaymentTermModalOpen}
        onClose={() => setIsPaymentTermModalOpen(false)}
        onSuccess={(newTerm) => {
          setIsPaymentTermModalOpen(false);
          setValue('paymentTerms', newTerm.termName);
        }}
      />
      <CurrencyFormModal
        isOpen={isCurrencyModalOpen}
        onClose={() => setIsCurrencyModalOpen(false)}
        orgId={orgId!}
      />
    </div>
  );
}
