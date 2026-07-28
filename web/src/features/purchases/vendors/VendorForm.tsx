import { useState, useEffect } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, Info, Settings } from 'lucide-react';
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
import { Select } from '../../../components/ui/Select';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import './vendor-form.css';

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
  const [activeTab, setActiveTab] = useState('other');
  const [isNumberConfigOpen, setIsNumberConfigOpen] = useState(false);
  const queryClient = useQueryClient();

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

  const labelStyle = {
    paddingTop: '0',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: '#111',
  };
  const labelRequiredStyle = { ...labelStyle, color: '#e54d4d' };
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

      <form onSubmit={handleSubmit(onSubmit)} style={{ padding: '32px' }}>
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
          <label style={labelStyle}>
            Primary Contact <Info size={14} color="#888" />
          </label>
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
          <input {...register('companyName')} style={inputStyle} />

          <label style={labelRequiredStyle}>
            Contact Name* <Info size={14} color="#888" />
          </label>
          <div>
            <input
              {...register('contactName')}
              placeholder="Select or type to add"
              style={inputStyle}
            />
            {errors.contactName && (
              <div style={{ color: 'red', fontSize: '12px', marginTop: '4px' }}>
                {errors.contactName.message}
              </div>
            )}
          </div>

          <label style={labelStyle}>
            Email Address <Info size={14} color="#888" />
          </label>
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

          <label style={labelRequiredStyle}>Contact Number*</label>
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

          <label style={labelStyle}>
            Phone <Info size={14} color="#888" />
          </label>
          <div style={{ display: 'flex', gap: '16px', maxWidth: '440px' }}>
            <div style={{ display: 'flex', gap: '0', flex: 1, alignItems: 'center' }}>
              <div style={{
                background: '#f9f9f9',
                border: '1px solid #d1d5db',
                borderRight: 'none',
                padding: '5px 8px',
                fontSize: '13px',
                borderTopLeftRadius: '4px',
                borderBottomLeftRadius: '4px'
              }}>
                +91
              </div>
              <input
                {...register('phone')}
                placeholder="Work Phone"
                maxLength={10}
                onKeyPress={(e) => { if (!/[0-9]/.test(e.key)) e.preventDefault(); }}
                style={{ ...inputStyle, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0', flex: 1, alignItems: 'center' }}>
              <div style={{
                background: '#f9f9f9',
                border: '1px solid #d1d5db',
                borderRight: 'none',
                padding: '5px 8px',
                fontSize: '13px',
                borderTopLeftRadius: '4px',
                borderBottomLeftRadius: '4px'
              }}>
                +91
              </div>
              <input
                {...register('mobile')}
                placeholder="Mobile"
                maxLength={10}
                onKeyPress={(e) => { if (!/[0-9]/.test(e.key)) e.preventDefault(); }}
                style={{ ...inputStyle, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
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
                onChange={(val) => setValue('currency', val, { shouldValidate: true, shouldDirty: true })}
                currencies={currencies || []}
                style={{ maxWidth: '440px' }}
              />

              <label style={labelStyle}>Payment Terms</label>
              <PaymentTermDropdown
                value={watch('paymentTerms') || ''}
                onChange={(val) => setValue('paymentTerms', val, { shouldValidate: true, shouldDirty: true })}
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

                  <label style={labelStyle}>Country/Region</label>
                  <Controller
                    control={control}
                    name="billingCountry"
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

                  <label style={labelStyle}>City</label>
                  <input {...register('billingCity')} style={inputStyle} />

                  <label style={labelStyle}>State</label>
                  <input {...register('billingState')} style={inputStyle} />

                  <label style={labelStyle}>Pin Code</label>
                  <input {...register('billingPinCode')} style={inputStyle} />

                  <label style={labelStyle}>Phone</label>
                  <input
                    {...register('billingPhone')}
                    maxLength={10}
                    onKeyPress={(e) => { if (!/[0-9]/.test(e.key)) e.preventDefault(); }}
                    style={inputStyle}
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

                  <label style={labelStyle}>Country/Region</label>
                  <Controller
                    control={control}
                    name="shippingCountry"
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

                  <label style={labelStyle}>City</label>
                  <input {...register('shippingCity')} style={inputStyle} />

                  <label style={labelStyle}>State</label>
                  <input {...register('shippingState')} style={inputStyle} />

                  <label style={labelStyle}>Pin Code</label>
                  <input {...register('shippingPinCode')} style={inputStyle} />

                  <label style={labelStyle}>Phone</label>
                  <input
                    {...register('shippingPhone')}
                    maxLength={10}
                    onKeyPress={(e) => { if (!/[0-9]/.test(e.key)) e.preventDefault(); }}
                    style={inputStyle}
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
                        <input
                          {...register(`contactPersons.${index}.phone`)}
                          maxLength={10}
                          onKeyPress={(e) => { if (!/[0-9]/.test(e.key)) e.preventDefault(); }}
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>
                        <input
                          {...register(`contactPersons.${index}.mobile`)}
                          maxLength={10}
                          onKeyPress={(e) => { if (!/[0-9]/.test(e.key)) e.preventDefault(); }}
                          style={inputStyle}
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
    </div>
  );
}
