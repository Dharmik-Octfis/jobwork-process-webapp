import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { createCurrencySchema } from './currencies.schemas';
import type { CreateCurrencyData, CreateCurrencyFormData, Currency } from './currencies.schemas';
import { useCreateCurrency, useUpdateCurrency } from './currencies.api';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';

const CURRENCY_OPTIONS = [
  { label: 'AED - UAE Dirham', value: 'AED' },
  { label: 'AFN - Afghan Afghani', value: 'AFN' },
  { label: 'ALL - Albanian Lek', value: 'ALL' },
  { label: 'AMD - Armenian Dram', value: 'AMD' },
  { label: 'ANG - Netherlands Antillian Guilder', value: 'ANG' },
  { label: 'AOA - Angolan Kwanza', value: 'AOA' },
  { label: 'ARS - Argentine Peso', value: 'ARS' },
  { label: 'AUD - Australian Dollar', value: 'AUD' },
  { label: 'CAD - Canadian Dollar', value: 'CAD' },
  { label: 'CHF - Swiss Franc', value: 'CHF' },
  { label: 'CNY - Chinese Yuan', value: 'CNY' },
  { label: 'EUR - Euro', value: 'EUR' },
  { label: 'GBP - British Pound', value: 'GBP' },
  { label: 'INR - Indian Rupee', value: 'INR' },
  { label: 'JPY - Japanese Yen', value: 'JPY' },
  { label: 'SGD - Singapore Dollar', value: 'SGD' },
  { label: 'USD - US Dollar', value: 'USD' }
];

const NUMBER_FORMATS = [
  { label: '1,234,567.89', value: '1,234,567.89' },
  { label: '1.234.567,89', value: '1.234.567,89' },
  { label: '12,34,567.89', value: '12,34,567.89' },
  { label: '1 234 567,89', value: '1 234 567,89' },
];

interface CurrencyFormModalProps {
  orgId: string;
  isOpen: boolean;
  onClose: () => void;
  currencyToEdit?: Currency | null;
}

export function CurrencyFormModal({ orgId, isOpen, onClose, currencyToEdit }: CurrencyFormModalProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateCurrencyFormData, unknown, CreateCurrencyData>({
    resolver: zodResolver(createCurrencySchema),
    defaultValues: {
      currencyCode: '',
      currencyName: '',
      symbol: '',
      decimalPlaces: 2,
      format: '1,234,567.89',
    },
  });

  useEffect(() => {
    if (isOpen) {
      if (currencyToEdit) {
        reset({
          currencyCode: currencyToEdit.currencyCode,
          currencyName: currencyToEdit.currencyName,
          symbol: currencyToEdit.symbol,
          decimalPlaces: currencyToEdit.decimalPlaces,
          format: currencyToEdit.format || '1,234,567.89',
        });
      } else {
        reset({
          currencyCode: '',
          currencyName: '',
          symbol: '',
          decimalPlaces: 2,
          format: '1,234,567.89',
        });
      }
      clearErrors();
    }
  }, [isOpen, currencyToEdit, reset, clearErrors]);

  const createMutation = useCreateCurrency(orgId);
  const updateMutation = useUpdateCurrency(orgId);

  const onSubmit = async (data: CreateCurrencyData) => {
    try {
      if (currencyToEdit) {
        await updateMutation.mutateAsync({
          id: currencyToEdit.id,
          data,
        });
      } else {
        await createMutation.mutateAsync(data);
      }
      onClose();
    } catch (error) {
      const err = error as { response?: { status?: number } };
      if (err.response?.status === 409) {
        setError('currencyCode', {
          type: 'manual',
          message: 'Currency code already exists in this organization.',
        });
      } else {
        setError('root', {
          type: 'manual',
          message: 'An unexpected error occurred. Please try again.',
        });
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
          width: '100%',
          maxWidth: '400px',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        <div
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>
            {currencyToEdit ? 'Edit Currency' : 'New Currency'}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              display: 'flex',
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-5)', overflowY: 'visible' }}>
          <form id="currency-form" onSubmit={handleSubmit(onSubmit)}>
            {errors.root && (
              <div
                style={{
                  padding: '12px',
                  backgroundColor: '#fee2e2',
                  color: '#dc2626',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '16px',
                  fontSize: '14px',
                }}
              >
                {errors.root.message}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    marginBottom: '6px',
                    color: 'var(--color-text)',
                  }}
                >
                  Currency Code<span style={{ color: '#dc2626' }}>*</span>
                </label>
                <Controller
                  name="currencyCode"
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      options={CURRENCY_OPTIONS}
                      value={field.value}
                      onChange={(val) => {
                        field.onChange(val);
                        const option = CURRENCY_OPTIONS.find(opt => opt.value === val);
                        if (option) {
                          const name = option.label.split(' - ')[1];
                          if (name) setValue('currencyName', name);
                          setValue('symbol', val);
                        }
                      }}
                      placeholder="Select"
                    />
                  )}
                />
                {errors.currencyCode && (
                  <span style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                    {errors.currencyCode.message}
                  </span>
                )}
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    marginBottom: '6px',
                    color: 'var(--color-text)',
                  }}
                >
                  Currency Symbol<span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  {...register('symbol')}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s ease',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = 'var(--color-primary)')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--color-border)')}
                />
                {errors.symbol && (
                  <span style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                    {errors.symbol.message}
                  </span>
                )}
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    marginBottom: '6px',
                    color: 'var(--color-text)',
                  }}
                >
                  Currency Name<span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  {...register('currencyName')}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s ease',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = 'var(--color-primary)')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--color-border)')}
                />
                {errors.currencyName && (
                  <span style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                    {errors.currencyName.message}
                  </span>
                )}
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    marginBottom: '6px',
                    color: 'var(--color-text)',
                  }}
                >
                  Decimal Places
                </label>
                <Controller
                  name="decimalPlaces"
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      options={[
                        { label: '0', value: '0' },
                        { label: '1', value: '1' },
                        { label: '2', value: '2' },
                        { label: '3', value: '3' },
                        { label: '4', value: '4' },
                      ]}
                      value={field.value !== undefined ? String(field.value) : ''}
                      onChange={(val) => field.onChange(val ? Number(val) : 0)}
                      placeholder="Select"
                    />
                  )}
                />
                {errors.decimalPlaces && (
                  <span style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                    {errors.decimalPlaces.message}
                  </span>
                )}
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    marginBottom: '6px',
                    color: 'var(--color-text)',
                  }}
                >
                  Format
                </label>
                <Controller
                  name="format"
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      options={NUMBER_FORMATS}
                      value={field.value || ''}
                      onChange={field.onChange}
                      placeholder="Select Format"
                    />
                  )}
                />
                {errors.format && (
                  <span style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                    {errors.format.message}
                  </span>
                )}
              </div>
            </div>
          </form>
        </div>

        <div
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'flex-start',
            gap: 'var(--space-3)',
            backgroundColor: '#fff',
            borderBottomLeftRadius: 'var(--radius-lg)',
            borderBottomRightRadius: 'var(--radius-lg)',
          }}
        >
          <button
            type="submit"
            form="currency-form"
            disabled={isSubmitting}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: '#166534',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1,
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: '#f8fafc',
              fontSize: '14px',
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              color: 'var(--color-text)',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
