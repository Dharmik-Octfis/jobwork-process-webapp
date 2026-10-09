import React, { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { RadioGroup } from '../../../components/ui/RadioGroup';
import { HelpCircle } from 'lucide-react';

export interface GenerateBarcodeFormData {
  template: string;
  generationField: string;
  displayDefaultPrice: string; // 'true' or 'false'
}

interface GenerateBarcodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (data: GenerateBarcodeFormData) => void;
  initialData?: GenerateBarcodeFormData;
}

export const GenerateBarcodeModal: React.FC<GenerateBarcodeModalProps> = ({
  isOpen,
  onClose,
  onGenerate,
  initialData,
}) => {
  const { control, handleSubmit, reset } = useForm<GenerateBarcodeFormData>({
    defaultValues: initialData || {
      template: 'barcode_template',
      generationField: 'item_name',
      displayDefaultPrice: 'true',
    },
  });

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        reset(initialData);
      }
    } else {
      reset(
        initialData || {
          template: 'barcode_template',
          generationField: 'item_name',
          displayDefaultPrice: 'true',
        },
      );
    }
  }, [isOpen, initialData, reset]);

  const onSubmit = (data: GenerateBarcodeFormData) => {
    onGenerate(data);
  };

  const footer = (
    <div style={{ display: 'flex', gap: 10, width: '100%', justifyContent: 'flex-start' }}>
      <button
        type="button"
        onClick={handleSubmit(onSubmit)}
        style={{
          padding: '8px 18px',
          backgroundColor: '#186337',
          color: '#ffffff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.15s ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#13532e')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#186337')}
      >
        Generate & Save
      </button>
      <button
        type="button"
        onClick={onClose}
        style={{
          padding: '8px 18px',
          backgroundColor: '#ffffff',
          color: '#334155',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 500,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.15s ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
      >
        Cancel
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Barcode"
      width={600}
      position="top"
      footer={footer}
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '16px 4px 8px 4px' }}
      >
        {/* Template Field */}
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <div style={{ width: 190, flexShrink: 0 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>Template</label>
          </div>
          <div style={{ flex: 1 }}>
            <Controller
              name="template"
              control={control}
              render={({ field: { ref: _ref, ...field } }) => (
                <Select
                  {...field}
                  options={[{ label: 'Barcode Template', value: 'barcode_template' }]}
                />
              )}
            />
          </div>
        </div>

        {/* Barcode Generation Field */}
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <div style={{ width: 190, flexShrink: 0 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: '#334155',
                borderBottom: '1px dashed #94a3b8',
                paddingBottom: 2,
                cursor: 'help',
                display: 'inline-block',
              }}
              title="Field used to generate the barcode"
            >
              Barcode Generation Field
            </label>
          </div>
          <div style={{ flex: 1 }}>
            <Controller
              name="generationField"
              control={control}
              render={({ field: { ref: _ref, ...field } }) => (
                <Select
                  {...field}
                  options={[
                    { label: 'Item Name', value: 'item_name' },
                    { label: 'Batch Number', value: 'batch_number' },
                    { label: 'Taka Number', value: 'taka_number' },
                    { label: 'SKU', value: 'sku' },
                  ]}
                />
              )}
            />
          </div>
        </div>

        {/* Price to Display */}
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <div
            style={{
              width: 190,
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <label style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>
              Price to Display
            </label>
            <HelpCircle size={15} style={{ color: '#94a3b8', cursor: 'pointer' }} />
          </div>
          <div style={{ flex: 1 }}>
            <Controller
              name="displayDefaultPrice"
              control={control}
              render={({ field: { ref: _ref, ...field } }) => (
                <RadioGroup
                  {...field}
                  name="displayDefaultPrice"
                  ariaLabel="Price to Display"
                  options={[
                    { label: 'Default Price', value: 'true' },
                    { label: 'Do not display price', value: 'false' },
                  ]}
                />
              )}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
};
