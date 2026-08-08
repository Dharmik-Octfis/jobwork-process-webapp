import { useState, useRef } from 'react';
import { useActiveCustomFields } from '../custom-fields/customFields.api';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Select } from '../../components/ui/Select';
import { CategorySelectDropdown } from './components/CategorySelectDropdown';
import { itemsApi } from './items.api.ts';
import type { ItemFormData, Item, ItemImageAttachment } from './items.schemas.ts';
import { itemFormSchema } from './items.schemas.ts';
import { z } from 'zod';
import { CustomFieldsSection } from '../custom-fields/CustomFieldsSection.tsx';
import { useUoms } from '../inventory/uom/uom.api.ts';
import { UomFormModal } from '../inventory/uom/UomFormModal.tsx';
import { Plus } from 'lucide-react';

interface CreateItemPageProps {
  isModal?: boolean;
  onSuccess?: (itemId: string) => void;
  onCancel?: () => void;
}

export function CreateItemPage({ isModal = false, onSuccess, onCancel }: CreateItemPageProps = {}) {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: customFields = [] } = useActiveCustomFields(orgId!, 'item');
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const { data: uoms = [] } = useUoms(orgId!);
  const [isUomModalOpen, setIsUomModalOpen] = useState(false);

  const itemToClone = (location.state as { itemToClone?: Partial<Item> & Record<string, unknown> })
    ?.itemToClone;

  const [formData, setFormData] = useState<ItemFormData>(() => {
    if (itemToClone) {
      return {
        name: itemToClone.name || '',
        type: (itemToClone.type || itemToClone.product_type || 'Goods') as 'Goods' | 'Service',
        category: itemToClone.category || '',
        hsnCode: itemToClone.hsnCode || itemToClone.hsn_or_sac || '',
        itemType: (itemToClone.itemType || itemToClone.item_type || 'Single Item') as
          'Single Item' | 'Contains Variants',
        unit: itemToClone.unit || '',
        stockingUomId: itemToClone.stockingUomId ?? null,
        sku: itemToClone.sku || '',
        isSalesInfo: true,
        sellingPrice:
          itemToClone.sellingPrice !== null && itemToClone.sellingPrice !== undefined
            ? Number(itemToClone.sellingPrice)
            : itemToClone.rate !== null && itemToClone.rate !== undefined
              ? Number(itemToClone.rate)
              : (null as unknown as number),
        salesDescription: itemToClone.salesDescription || itemToClone.sales_description || '',
        isPurchaseInfo: true,
        costPrice:
          itemToClone.costPrice !== null && itemToClone.costPrice !== undefined
            ? Number(itemToClone.costPrice)
            : itemToClone.purchase_rate !== null && itemToClone.purchase_rate !== undefined
              ? Number(itemToClone.purchase_rate)
              : (null as unknown as number),
        purchaseDescription:
          itemToClone.purchaseDescription || itemToClone.purchase_description || '',
        packaging: itemToClone.packaging || '',
        frontImage: itemToClone.frontImage || itemToClone.front_image || null,
        rearImage: itemToClone.rearImage || itemToClone.rear_image || null,
        images: itemToClone.images || [],
        trackInventory: true,
        inventoryTracking:
          itemToClone.inventoryTracking || itemToClone.inventory_tracking || 'None',
        openingStock:
          itemToClone.openingStock !== null && itemToClone.openingStock !== undefined
            ? Number(itemToClone.openingStock)
            : null,
        openingStockValuePerUnit:
          itemToClone.openingStockValuePerUnit !== null &&
          itemToClone.openingStockValuePerUnit !== undefined
            ? Number(itemToClone.openingStockValuePerUnit)
            : null,
        customFields:
          itemToClone.customFields || (itemToClone.custom_fields as Record<string, unknown>) || {},
      };
    }
    return {
      name: '',
      type: 'Goods',
      category: '',
      hsnCode: '',
      itemType: 'Single Item',
      unit: '',
      stockingUomId: null,
      sku: '',
      isSalesInfo: true,
      sellingPrice: null as unknown as number,
      salesDescription: '',
      isPurchaseInfo: true,
      costPrice: null as unknown as number,
      purchaseDescription: '',
      packaging: '',
      frontImage: null,
      rearImage: null,
      images: [],
      trackInventory: true,
      inventoryTracking: 'None',
      openingStock: null,
      openingStockValuePerUnit: null,
      customFields: {},
    };
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});

  const frontImageRef = useRef<HTMLInputElement>(null);
  const rearImageRef = useRef<HTMLInputElement>(null);
  const otherImagesRef = useRef<HTMLInputElement>(null);

  const [frontImageFile, setFrontImageFile] = useState<File | null>(null);
  const [rearImageFile, setRearImageFile] = useState<File | null>(null);
  const [otherImageFiles, setOtherImageFiles] = useState<File[]>([]);

  const createMutation = useMutation({
    mutationFn: (data: ItemFormData) => itemsApi.createItem(orgId!, data),
    onSuccess: async (createdItem) => {
      // Upload images if there are any
      if (frontImageFile || rearImageFile || otherImageFiles.length > 0) {
        const formDataUpload = new FormData();
        if (frontImageFile) formDataUpload.append('frontImage', frontImageFile);
        if (rearImageFile) formDataUpload.append('rearImage', rearImageFile);
        otherImageFiles.forEach((file) => formDataUpload.append('images', file));
        try {
          await itemsApi.uploadImages(orgId!, createdItem.id, formDataUpload);
        } catch (error: unknown) {
          const err = error as { response?: { data?: unknown; status?: number }; message?: string };
          console.error(
            'Failed to upload images. Server response:',
            err.response?.data,
            'Status:',
            err.response?.status,
          );
          alert(`Image upload failed: ${JSON.stringify(err.response?.data || err.message)}`);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
      const itemId = createdItem.id;

      if (isModal && onSuccess) {
        onSuccess(itemId);
      } else {
        navigate(`/organizations/${orgId}/items`);
      }
    },
    onError: (error: unknown) => {
      const err = error as {
        response?: { data?: { error?: string; message?: string; details?: unknown } };
      };
      const errorMsg =
        err.response?.data?.error || err.response?.data?.message || 'Failed to create item.';
      const details = err.response?.data?.details;
      // Custom-field validation returns a { "customFields.<key>": message } object.
      if (details && typeof details === 'object' && !Array.isArray(details)) {
        setCustomFieldErrors(details as Record<string, string>);
        return;
      }
      console.error('Failed to create item:', errorMsg, details);
      alert(`${errorMsg}${details ? '\n' + JSON.stringify(details, null, 2) : ''}`);
    },
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement;
    const val =
      type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : type === 'number'
          ? parseFloat(value) || null
          : value;

    setFormData((prev) => ({
      ...prev,
      [name]: val,
    }));

    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleRadioChange = (name: string, value: string) => {
    setFormData((prev) => {
      const newState = { ...prev, [name]: value };
      if (name === 'type' && value === 'Service' && prev.inventoryTracking === 'Batch') {
        newState.inventoryTracking = 'None';
      }
      return newState;
    });
  };

  const handleSelectChange = (name: keyof ItemFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleFrontImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      if (e.target.files[0].size > 2 * 1024 * 1024) {
        alert('Front image exceeds 2 MB limit.');
        return;
      }
      setFrontImageFile(e.target.files[0]);
    }
  };

  const handleRearImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      if (e.target.files[0].size > 2 * 1024 * 1024) {
        alert('Rear image exceeds 2 MB limit.');
        return;
      }
      setRearImageFile(e.target.files[0]);
    }
  };

  const handleOtherImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const validFiles = files.filter((f) => f.size <= 2 * 1024 * 1024);
      if (validFiles.length < files.length) {
        alert('Some images were ignored because they exceed the 2 MB limit.');
      }
      if (validFiles.length > 3) {
        alert('You can only select up to 3 additional images.');
        setOtherImageFiles(validFiles.slice(0, 3));
      } else {
        setOtherImageFiles(validFiles);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      itemFormSchema.parse(formData);
      setErrors({});
      setCustomFieldErrors({});
      createMutation.mutate(formData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors: Record<string, string> = {};
        error.issues.forEach((err: z.ZodIssue) => {
          if (err.path[0]) {
            formattedErrors[err.path[0].toString()] = err.message;
          }
        });
        setErrors(formattedErrors);
      }
    }
  };

  return (
    <div
      style={{
        padding: 0,
        margin: 0,
        background: '#fff',
        width: '100%',
        minHeight: isModal ? 'auto' : '100vh',
        display: 'block',
        paddingBottom: isModal ? '0' : '80px',
      }}
    >
      <div
        style={{
          padding: isModal ? '20px' : '24px 32px 24px',
          maxWidth: isModal ? '100%' : '1200px',
          margin: isModal ? '0' : '0 auto',
        }}
      >
        <h1
          style={{
            fontSize: isModal ? '20px' : '24px',
            fontWeight: 600,
            marginBottom: '24px',
            color: '#1e293b',
          }}
        >
          New Item
        </h1>
      </div>

      <div style={{ padding: isModal ? '0 20px 0px' : '0 32px 32px' }}>
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
        >
          {/* Top Section: Basic Info & Images */}
          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div
              style={{
                flex: 1,
                minWidth: '480px',
                maxWidth: '640px',
                background: '#f8fafc',
                padding: '24px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <label style={{ fontSize: 12, color: '#ef4444', fontWeight: 500 }}>Name*</label>
                <div>
                  <input
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      border: errors.name ? '1px solid #ef4444' : '1px solid #d1d5db',
                      fontSize: 12,
                    }}
                  />
                  {errors.name && (
                    <span
                      style={{ color: '#ef4444', fontSize: 12, marginTop: 4, display: 'block' }}
                    >
                      {errors.name}
                    </span>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Type</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="type"
                      value="Goods"
                      checked={formData.type === 'Goods'}
                      onChange={() => handleRadioChange('type', 'Goods')}
                    />{' '}
                    Goods
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="type"
                      value="Service"
                      checked={formData.type === 'Service'}
                      onChange={() => handleRadioChange('type', 'Service')}
                    />{' '}
                    Service
                  </label>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>SKU</label>
                <div>
                  <input
                    name="sku"
                    value={formData.sku || ''}
                    onChange={handleChange}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      border: errors.sku ? '1px solid #ef4444' : '1px solid #d1d5db',
                      fontSize: 12,
                    }}
                  />
                  {errors.sku && (
                    <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{errors.sku}</div>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Category</label>
                <CategorySelectDropdown
                  value={formData.category || null}
                  onChange={(val) => handleSelectChange('category', val)}
                  error={!!errors.category}
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Unit</label>
                <div>
                  <div
                    style={{
                      display: 'flex',
                      border: errors.unit ? '1px solid #ef4444' : '1px solid #d1d5db',
                      borderRadius: '4px',
                      width: '100%',
                    }}
                  >
                    <div
                      style={{
                        padding: '6px 12px',
                        borderRight: '1px solid #d1d5db',
                        borderTopLeftRadius: '3px',
                        borderBottomLeftRadius: '3px',
                        background: '#f1f5f9',
                        fontSize: 12,
                        color: '#475569',
                        display: 'flex',
                        alignItems: 'center',
                        whiteSpace: 'nowrap',
                        fontWeight: 500,
                      }}
                    >
                      Unit
                    </div>
                    <div style={{ flex: 1 }}>
                      <Select
                        value={formData.stockingUomId ?? ''}
                        /**
                         * 🔴 SETS BOTH. `stockingUomId` is the FK the stock
                         * ledger denominates every lot, challan line and balance
                         * in — one item, one stocking unit (jobwork §5.1) —
                         * while `unit` is the legacy free string this form has
                         * always shown and the lists still render. One dropdown
                         * writes them together so they cannot drift; a second
                         * "unit" control beside the first would be the confusion,
                         * not the fix.
                         */
                        onChange={(val) => {
                          const picked = uoms.find((u) => u.id === val);
                          setFormData((prev) => ({
                            ...prev,
                            stockingUomId: val || null,
                            unit: picked?.unitName ?? '',
                          }));
                        }}
                        options={[
                          ...uoms.map((u) => ({ value: u.id, label: u.unitName })),
                          // An item saved before this field existed carries only
                          // the legacy name, and no id to select by. Show it so
                          // the box is not mysteriously blank; picking anything
                          // replaces it with a real unit.
                          ...(formData.unit && !uoms.some((u) => u.id === formData.stockingUomId)
                            ? [{ value: '', label: `${formData.unit} — no stocking unit set` }]
                            : []),
                        ]}
                        buttonStyle={{ border: 'none' }}
                        actionItem={
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsUomModalOpen(true);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              width: '100%',
                              padding: '8px 12px',
                              color: '#0062ff',
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: 13,
                              textAlign: 'left',
                            }}
                          >
                            <Plus size={14} /> New Unit Group
                          </button>
                        }
                      />
                    </div>
                  </div>
                  {errors.unit && (
                    <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                      {errors.unit}
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>HSN Code</label>
                <input
                  name="hsnCode"
                  value={formData.hsnCode || ''}
                  onChange={handleChange}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: '1px solid #d1d5db',
                    fontSize: 12,
                  }}
                />
              </div>
            </div>

            {/* Image Upload Area */}
            <div
              style={{
                width: '360px',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                gap: '12px',
                background: '#f8fafc',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 6, color: '#1e293b', fontWeight: 500 }}>
                    Front View
                  </div>
                  <input
                    type="file"
                    ref={frontImageRef}
                    onChange={handleFrontImageChange}
                    style={{ display: 'none' }}
                    accept="image/*"
                  />
                  <button
                    type="button"
                    onClick={() => frontImageRef.current?.click()}
                    style={{
                      width: '100%',
                      padding: '16px 8px',
                      border: '1px dashed #cbd5e1',
                      borderRadius: '6px',
                      background: '#ffffff',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: '#0062ff',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                      }}
                    >
                      ↑
                    </div>
                    <div
                      style={{
                        fontWeight: 500,
                        fontSize: 12,
                        color: '#1e293b',
                        textAlign: 'center',
                        wordBreak: 'break-all',
                      }}
                    >
                      {frontImageFile
                        ? frontImageFile.name
                        : formData.frontImage
                          ? (formData.frontImage as ItemImageAttachment).name ||
                            'Existing Front Image'
                          : 'Upload Front Image'}
                    </div>
                  </button>
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 6, color: '#1e293b', fontWeight: 500 }}>
                    Rear View
                  </div>
                  <input
                    type="file"
                    ref={rearImageRef}
                    onChange={handleRearImageChange}
                    style={{ display: 'none' }}
                    accept="image/*"
                  />
                  <button
                    type="button"
                    onClick={() => rearImageRef.current?.click()}
                    style={{
                      width: '100%',
                      padding: '16px 8px',
                      border: '1px dashed #cbd5e1',
                      borderRadius: '6px',
                      background: '#ffffff',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: '#0062ff',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                      }}
                    >
                      ↑
                    </div>
                    <div
                      style={{
                        fontWeight: 500,
                        fontSize: 12,
                        color: '#1e293b',
                        textAlign: 'center',
                        wordBreak: 'break-all',
                      }}
                    >
                      {rearImageFile
                        ? rearImageFile.name
                        : formData.rearImage
                          ? (formData.rearImage as ItemImageAttachment).name ||
                            'Existing Rear Image'
                          : 'Upload Rear Image'}
                    </div>
                  </button>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 12, marginBottom: 6, color: '#1e293b', fontWeight: 500 }}>
                  Other Images
                </div>
                <input
                  type="file"
                  ref={otherImagesRef}
                  onChange={handleOtherImagesChange}
                  style={{ display: 'none' }}
                  accept="image/*"
                  multiple
                />
                <button
                  type="button"
                  onClick={() => otherImagesRef.current?.click()}
                  style={{
                    width: '100%',
                    flex: 1,
                    minHeight: '110px',
                    padding: '12px 8px',
                    border: '1px dashed #cbd5e1',
                    borderRadius: '6px',
                    background: '#ffffff',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: '#0062ff',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                    }}
                  >
                    ↑
                  </div>
                  <div
                    style={{
                      fontWeight: 500,
                      fontSize: 12,
                      color: '#1e293b',
                      textAlign: 'center',
                      wordBreak: 'break-all',
                    }}
                  >
                    {otherImageFiles.length > 0
                      ? `${otherImageFiles.length} new files selected`
                      : formData.images && formData.images.length > 0
                        ? `${formData.images.length} existing image(s)`
                        : 'Drag & Drop Images (Max 3)'}
                  </div>
                  <div
                    style={{ fontSize: 10, color: '#64748b', textAlign: 'center', lineHeight: 1.3 }}
                  >
                    You can add up to 3 images, each not exceeding 2 MB.
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Sales and Purchase Information */}
          <div
            style={{
              background: '#f8fafc',
              padding: '24px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              {/* Sales Information */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#1e293b',
                  }}
                >
                  <input
                    type="checkbox"
                    name="isSalesInfo"
                    checked={formData.isSalesInfo}
                    onChange={handleChange}
                  />
                  Sales Information
                </label>
                {formData.isSalesInfo && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 24 }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontSize: 12, color: '#ef4444', fontWeight: 500 }}>
                        Selling Price*
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        name="sellingPrice"
                        value={formData.sellingPrice || ''}
                        onChange={handleChange}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          border: errors.sellingPrice ? '1px solid #ef4444' : '1px solid #d1d5db',
                          fontSize: 12,
                        }}
                      />
                      {errors.sellingPrice && (
                        <span
                          style={{ color: '#ef4444', fontSize: 12, marginTop: 4, display: 'block' }}
                        >
                          {errors.sellingPrice}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>
                        Sales Description
                      </label>
                      <textarea
                        name="salesDescription"
                        value={formData.salesDescription || ''}
                        onChange={(e) =>
                          handleChange(e as unknown as React.ChangeEvent<HTMLInputElement>)
                        }
                        rows={3}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          border: '1px solid #d1d5db',
                          fontSize: 12,
                          resize: 'vertical',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Purchase Information */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#1e293b',
                  }}
                >
                  <input
                    type="checkbox"
                    name="isPurchaseInfo"
                    checked={formData.isPurchaseInfo}
                    onChange={handleChange}
                  />
                  Purchase Information
                </label>
                {formData.isPurchaseInfo && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 24 }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontSize: 12, color: '#ef4444', fontWeight: 500 }}>
                        Cost Price*
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        name="costPrice"
                        value={formData.costPrice || ''}
                        onChange={handleChange}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          border: errors.costPrice ? '1px solid #ef4444' : '1px solid #d1d5db',
                          fontSize: 12,
                        }}
                      />
                      {errors.costPrice && (
                        <span
                          style={{ color: '#ef4444', fontSize: 12, marginTop: 4, display: 'block' }}
                        >
                          {errors.costPrice}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>
                        Purchase Description
                      </label>
                      <textarea
                        name="purchaseDescription"
                        value={formData.purchaseDescription || ''}
                        onChange={(e) =>
                          handleChange(e as unknown as React.ChangeEvent<HTMLInputElement>)
                        }
                        rows={3}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          border: '1px solid #d1d5db',
                          fontSize: 12,
                          resize: 'vertical',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Inventory Tracking */}
          <div
            style={{
              maxWidth: '640px',
              background: '#f8fafc',
              padding: '24px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 13,
                fontWeight: 600,
                color: '#1e293b',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                name="trackInventory"
                checked={formData.trackInventory}
                onChange={handleChange}
                style={{ marginTop: 2 }}
              />
              <div>
                Track Inventory for this item
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 400, marginTop: 4 }}>
                  You cannot enable/disable inventory tracking once you've created transactions for
                  this item
                </div>
              </div>
            </label>

            {formData.trackInventory && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  paddingTop: 8,
                  borderTop: '1px solid #e2e8f0',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '160px 1fr',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>
                    Inventory Tracking
                  </label>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="radio"
                        name="inventoryTracking"
                        value="None"
                        checked={formData.inventoryTracking === 'None'}
                        onChange={() => handleRadioChange('inventoryTracking', 'None')}
                      />{' '}
                      None
                    </label>
                    {formData.type !== 'Service' && (
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="radio"
                          name="inventoryTracking"
                          value="Batch"
                          checked={formData.inventoryTracking === 'Batch'}
                          onChange={() => handleRadioChange('inventoryTracking', 'Batch')}
                        />{' '}
                        Batch
                      </label>
                    )}
                  </div>
                </div>

                {formData.inventoryTracking === 'None' && (
                  <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>
                        Opening Stock
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        name="openingStock"
                        value={formData.openingStock || ''}
                        onChange={handleChange}
                        style={{
                          width: '100%',
                          minWidth: '160px',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          border: '1px solid #d1d5db',
                          fontSize: 12,
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>
                        Value of Opening Stock (per quantity)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        name="openingStockValuePerUnit"
                        value={formData.openingStockValuePerUnit || ''}
                        onChange={handleChange}
                        style={{
                          width: '100%',
                          minWidth: '200px',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          border: '1px solid #d1d5db',
                          fontSize: 12,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Custom Fields */}
          {orgId && (
            <div
              style={{
                maxWidth: '640px',
                background: '#f8fafc',
                padding: '24px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
              }}
            >
              <h3
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  color: '#1e293b',
                }}
              >
                Custom Fields
                {customFields.some((f) => f.isRequired) && (
                  <span style={{ color: '#ef4444' }}>*</span>
                )}
              </h3>
              <CustomFieldsSection
                orgId={orgId}
                entityType="item"
                values={(formData.customFields as Record<string, unknown>) ?? {}}
                onChange={(v) => setFormData((prev) => ({ ...prev, customFields: v }))}
                errors={customFieldErrors}
                applyDefaults
              />
            </div>
          )}

          <div
            style={{
              height: '56px',
              boxSizing: 'border-box',
              position: isModal ? 'sticky' : 'fixed',
              bottom: 0,
              left: isModal ? 0 : 220,
              right: 0,
              background: '#fff',
              padding: isModal ? '0 20px' : '0 32px',
              margin: isModal ? '20px -20px 0 -20px' : 0,
              borderTop: '1px solid #cbd5e1',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              zIndex: 100,
              boxShadow: '0 -2px 10px rgba(0,0,0,0.05)',
            }}
          >
            <button
              type="submit"
              disabled={createMutation.isPending}
              style={{
                padding: '8px 24px',
                background: '#0062ff',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                fontSize: '13px',
                opacity: createMutation.isPending ? 0.7 : 1,
              }}
            >
              {createMutation.isPending ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              disabled={createMutation.isPending}
              onClick={() =>
                isModal && onCancel ? onCancel() : navigate(`/organizations/${orgId}/items`)
              }
              style={{
                padding: '8px 24px',
                background: 'white',
                color: createMutation.isPending ? '#94a3b8' : '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                fontSize: '13px',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
      <UomFormModal
        orgId={orgId!}
        isOpen={isUomModalOpen}
        onClose={() => setIsUomModalOpen(false)}
      />
    </div>
  );
}
