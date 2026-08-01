import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { createUomSchema } from './uom.schemas';
import type { CreateUomData, CreateUomFormData, Uom } from './uom.schemas';
import { useCreateUom, useUpdateUom } from './uom.api';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';

const UQC_OPTIONS = [
  { value: 'OTH', label: 'OTH (Others)' },
  { value: 'BOU', label: 'BOU (Billion of units)' },
  { value: 'BGS', label: 'BGS (Bags)' },
  { value: 'BAL', label: 'BAL (Bale)' },
  { value: 'BTL', label: 'BTL (Bottles)' },
  { value: 'BOX', label: 'BOX (Boxes)' },
  { value: 'BKL', label: 'BKL (Buckles)' },
  { value: 'BUN', label: 'BUN (Bunches)' },
  { value: 'BDL', label: 'BDL (Bundles)' },
  { value: 'CAN', label: 'CAN (Cans)' },
  { value: 'CBM', label: 'CBM (Cubic Meters)' },
  { value: 'CCM', label: 'CCM (Cubic Centimeters)' },
  { value: 'CMS', label: 'CMS (Centimeters)' },
  { value: 'CTN', label: 'CTN (Cartons)' },
  { value: 'DOZ', label: 'DOZ (Dozens)' },
  { value: 'DRM', label: 'DRM (Drums)' },
  { value: 'GGK', label: 'GGK (Great Gross)' },
  { value: 'GMS', label: 'GMS (Grams)' },
  { value: 'GRS', label: 'GRS (Gross)' },
  { value: 'GYD', label: 'GYD (Gross Yards)' },
  { value: 'KGS', label: 'KGS (Kilograms)' },
  { value: 'KLR', label: 'KLR (Kilolitre)' },
  { value: 'KME', label: 'KME (Kilometre)' },
  { value: 'LTR', label: 'LTR (Litres)' },
  { value: 'MLT', label: 'MLT (Millilitre)' },
  { value: 'MTR', label: 'MTR (Meters)' },
  { value: 'MTS', label: 'MTS (Metric Tonnes)' },
  { value: 'NOS', label: 'NOS (Numbers)' },
  { value: 'PAC', label: 'PAC (Packs)' },
  { value: 'PCS', label: 'PCS (Pieces)' },
  { value: 'PRS', label: 'PRS (Pairs)' },
  { value: 'QTL', label: 'QTL (Quintal)' },
  { value: 'ROL', label: 'ROL (Rolls)' },
  { value: 'SET', label: 'SET (Sets)' },
  { value: 'SQF', label: 'SQF (Square Feet)' },
  { value: 'SQM', label: 'SQM (Square Meters)' },
  { value: 'SQY', label: 'SQY (Square Yards)' },
  { value: 'TBS', label: 'TBS (Tablets)' },
  { value: 'TGM', label: 'TGM (Ten Gross)' },
  { value: 'THD', label: 'THD (Thousands)' },
  { value: 'TON', label: 'TON (Tonnes)' },
  { value: 'TUB', label: 'TUB (Tubes)' },
  { value: 'UGS', label: 'UGS (US Gallons)' },
  { value: 'UNT', label: 'UNT (Units)' },
  { value: 'YDS', label: 'YDS (Yards)' },
];

interface UomFormModalProps {
  orgId: string;
  isOpen: boolean;
  onClose: () => void;
  uomToEdit?: Uom | null;
}

export function UomFormModal({ orgId, isOpen, onClose, uomToEdit }: UomFormModalProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateUomFormData, unknown, CreateUomData>({
    resolver: zodResolver(createUomSchema),
    defaultValues: {
      unitName: '',
      symbol: '',
      uqc: 'OTH',
      unitPrecision: 2,
    },
  });

  useEffect(() => {
    if (isOpen) {
      if (uomToEdit) {
        reset({
          unitName: uomToEdit.unitName,
          symbol: uomToEdit.symbol,
          uqc: uomToEdit.uqc,
          unitPrecision: uomToEdit.unitPrecision,
        });
      } else {
        reset({
          unitName: '',
          symbol: '',
          uqc: 'OTH',
          unitPrecision: 2,
        });
      }
    }
  }, [isOpen, uomToEdit, reset]);

  const createMutation = useCreateUom(orgId);
  const updateMutation = useUpdateUom(orgId);

  if (!isOpen) return null;

  const onSubmit = async (data: CreateUomData) => {
    clearErrors('root');
    try {
      if (uomToEdit) {
        await updateMutation.mutateAsync({ id: uomToEdit.id, data });
      } else {
        await createMutation.mutateAsync(data);
      }
      onClose();
    } catch (err: unknown) {
      // The API returns { statusCode, message, data } — the reason is in
      // `message`. This used to read `data.error`, which no longer exists, so
      // every failure showed the generic fallback instead of the real cause.
      const error = err as { response?: { data?: { message?: string } } };
      setError('root', {
        type: 'manual',
        message: error.response?.data?.message || 'Failed to save Unit of Measurement',
      });
    }
  };

  return (
    <>
      <style>
        {`
          @keyframes uomModalSlideDown {
            from { opacity: 0; transform: translateY(-50px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes uomModalFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}
      </style>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          zIndex: 100,
          animation: 'uomModalFadeIn 0.2s ease-out forwards',
        }}
      >
        <div
          style={{
            background: 'white',
            borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
            width: '100%',
            maxWidth: 400,
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '85vh',
            animation: 'uomModalSlideDown 0.3s ease-out forwards',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: 'var(--space-4) var(--space-5)',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              {uomToEdit ? 'Edit Unit of Measurement' : 'New Unit of Measurement'}
            </h2>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: 'var(--space-5)', overflowY: 'visible' }}>
            {errors.root && (
              <div
                style={{
                  padding: 'var(--space-3)',
                  background: '#FEF2F2',
                  color: '#DC2626',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 'var(--space-4)',
                  fontSize: 14,
                }}
              >
                {errors.root.message}
              </div>
            )}

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>
                  Name <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  {...register('unitName')}
                  placeholder="e.g. Kilograms"
                  style={{
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    fontSize: 13,
                  }}
                />
                {errors.unitName && (
                  <span style={{ color: 'var(--color-danger)', fontSize: 11 }}>
                    {errors.unitName.message}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>
                  Symbol <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  {...register('symbol')}
                  placeholder="e.g. KGS"
                  style={{
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    fontSize: 13,
                  }}
                />
                {errors.symbol && (
                  <span style={{ color: 'var(--color-danger)', fontSize: 11 }}>
                    {errors.symbol.message}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>Unique Quantity Code (UQC)</label>
                <Controller
                  name="uqc"
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      options={UQC_OPTIONS}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
                {errors.uqc && (
                  <span style={{ color: 'var(--color-danger)', fontSize: 11 }}>
                    {errors.uqc.message}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>
                  Unit Precision <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <Controller
                  name="unitPrecision"
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      options={[0, 1, 2, 3, 4, 5, 6].map((num) => ({
                        label: num.toString(),
                        value: num.toString(),
                        disabled: !!uomToEdit && num < uomToEdit.unitPrecision,
                      }))}
                      value={field.value?.toString()}
                      onChange={(val) => field.onChange(Number(val))}
                    />
                  )}
                />
                {errors.unitPrecision && (
                  <span style={{ color: 'var(--color-danger)', fontSize: 11 }}>
                    {errors.unitPrecision.message}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              padding: 'var(--space-4) var(--space-5)',
              borderTop: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-3)',
              background: 'var(--color-bg)',
              borderBottomLeftRadius: 'var(--radius-lg)',
              borderBottomRightRadius: 'var(--radius-lg)',
            }}
          >
            <button
              onClick={onClose}
              type="button"
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'white',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: 14,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit(onSubmit)}
              disabled={isSubmitting}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: 'var(--color-primary)',
                color: 'white',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                fontSize: 14,
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
