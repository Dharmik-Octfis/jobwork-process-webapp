import { useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { itemsApi } from './items.api.ts';
import type { ItemFormData, ItemImageAttachment } from './items.schemas.ts';
import { itemFormSchema } from './items.schemas.ts';
import { z } from 'zod';
import { Select } from '../../components/ui/Select.tsx';
import { CategorySelectDropdown } from './components/CategorySelectDropdown.tsx';
import { CustomFieldsSection } from '../custom-fields/CustomFieldsSection.tsx';
import { useUoms } from '../inventory/uom/uom.api.ts';
import { useActiveCustomFields } from '../custom-fields/customFields.api.ts';
import { UomFormModal } from '../inventory/uom/UomFormModal.tsx';
import { Plus } from 'lucide-react';

export function EditItemPage() {
  const { id, orgId } = useParams<{ id: string; orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: uoms = [] } = useUoms(orgId!);
  const { data: customFields = [] } = useActiveCustomFields(orgId!, 'item');
  const [isUomModalOpen, setIsUomModalOpen] = useState(false);

  const [formData, setFormData] = useState<ItemFormData>({
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
    inventoryTracking: 'none',
    openingStock: null,
    openingStockValuePerUnit: null,
    customFields: {},
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [initializedId, setInitializedId] = useState<string | null>(null);

  const frontImageRef = useRef<HTMLInputElement>(null);
  const rearImageRef = useRef<HTMLInputElement>(null);
  const otherImagesRef = useRef<HTMLInputElement>(null);

  const [frontImageFile, setFrontImageFile] = useState<File | null>(null);
  const [rearImageFile, setRearImageFile] = useState<File | null>(null);
  const [otherImageFiles, setOtherImageFiles] = useState<File[]>([]);

  const { data: item, isLoading } = useQuery({
    queryKey: ['item', orgId, id],
    queryFn: () => itemsApi.getItem(orgId!, id!),
    enabled: !!id && !!orgId,
  });

  // Initialize form data directly during render when item is loaded.
  // This avoids the cascading render problem caused by setting state in useEffect.
  if (item && initializedId !== id) {
    const rawItem = item as typeof item & Record<string, unknown>;
    setInitializedId(id!);
    setFormData({
      name: (rawItem.name as string) || '',
      type: (rawItem.type || rawItem.product_type || 'Goods') as 'Goods' | 'Service',
      category: (rawItem.category as string) || '',
      hsnCode: rawItem.hsnCode || rawItem.hsn_or_sac || '',
      itemType: 'Single Item',
      unit: rawItem.unit || '',
      stockingUomId: rawItem.stockingUomId ?? null,
      sku: rawItem.sku || '',
      isSalesInfo: true,
      sellingPrice:
        rawItem.sellingPrice !== null && rawItem.sellingPrice !== undefined
          ? Number(rawItem.sellingPrice)
          : rawItem.rate !== null && rawItem.rate !== undefined
            ? Number(rawItem.rate)
            : (null as unknown as number),
      salesDescription:
        (rawItem.salesDescription as string) || '',
      isPurchaseInfo: true,
      costPrice:
        rawItem.costPrice !== null && rawItem.costPrice !== undefined
          ? Number(rawItem.costPrice)
          : rawItem.purchase_rate !== null && rawItem.purchase_rate !== undefined
            ? Number(rawItem.purchase_rate)
            : (null as unknown as number),
      purchaseDescription:
        (rawItem.purchaseDescription as string) || '',
      packaging: rawItem.packaging || '',
      frontImage: rawItem.frontImage || null,
      rearImage: rawItem.rearImage || null,
      images: rawItem.images || [],
      trackInventory: true,
      inventoryTracking: (rawItem.inventoryTracking ?? 'none').toLowerCase(),
      openingStock:
        rawItem.openingStock !== null && rawItem.openingStock !== undefined
          ? Number(rawItem.openingStock)
          : null,
      openingStockValuePerUnit:
        rawItem.openingStockValuePerUnit !== null && rawItem.openingStockValuePerUnit !== undefined
          ? Number(rawItem.openingStockValuePerUnit)
          : null,
      customFields:
        rawItem.customFields || (rawItem.customFields as unknown as Record<string, unknown>) || null,
    });
  }

  const updateMutation = useMutation({
    mutationFn: (data: ItemFormData) => itemsApi.updateItem({ orgId: orgId!, id: id!, data }),
    onSuccess: async () => {
      // Upload images if there are any
      if (frontImageFile || rearImageFile || otherImageFiles.length > 0) {
        const formDataUpload = new FormData();
        if (frontImageFile) formDataUpload.append('frontImage', frontImageFile);
        if (rearImageFile) formDataUpload.append('rearImage', rearImageFile);
        otherImageFiles.forEach((file) => formDataUpload.append('images', file));
        try {
          await itemsApi.uploadImages(orgId!, id!, formDataUpload);
        } catch (error) {
          console.error('Failed to upload images:', error);
          alert('Item updated, but image upload failed.');
        }
      }
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
      queryClient.removeQueries({ queryKey: ['item', orgId, id] });
      navigate(`/organizations/${orgId}/items`);
    },
    onError: (error) => {
      const err = error as {
        response?: { data?: { error?: string; message?: string; details?: unknown } };
      };
      const details = err.response?.data?.details;
      if (details && typeof details === 'object' && !Array.isArray(details)) {
        setCustomFieldErrors(details as Record<string, string>);
        return;
      }
      console.error('Failed to update item:', error);
      alert(err.response?.data?.error || err.response?.data?.message || 'Failed to update item.');
    },
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement;
    const val =
      type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : type === 'number'
          ? value === '' || isNaN(Number(value))
            ? null
            : Number(value)
          : value;

    setFormData((prev) => {
      const next = { ...prev, [name]: val };
      // An item that is not stocked cannot be batch-tracked: the two controls are
      // one setting, and inventory_tracking is what the backend actually reads.
      if (name === 'trackInventory' && val === false) next.inventoryTracking = 'none';
      return next;
    });

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
      if (name === 'type' && value === 'Service' && prev.inventoryTracking === 'batch') {
        newState.inventoryTracking = 'none';
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
      updateMutation.mutate(formData);
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

  if (isLoading) {
    return <div style={{ padding: 40, textAlign: 'center' }}>Loading item details...</div>;
  }

  return (
    <div
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
      <div style={{ padding: '16px 24px' }}>
        <button
          type="button"
          onClick={() => navigate(`/organizations/${orgId}/items`)}
          style={{
            background: 'none',
            border: 'none',
            color: '#0062ff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 0,
            marginBottom: '12px',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <ArrowLeft size={14} /> Back to Items
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 400, margin: 0, color: '#000' }}>Edit Item</h1>
        </div>
      </div>

      <div style={{ padding: '0 32px 32px' }}>
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
                         * ledger denominates every batch, challan line and balance
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
                        value="none"
                        checked={formData.inventoryTracking === 'none'}
                        onChange={() => handleRadioChange('inventoryTracking', 'none')}
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
                          value="batch"
                          checked={formData.inventoryTracking === 'batch'}
                          onChange={() => handleRadioChange('inventoryTracking', 'batch')}
                        />{' '}
                        Batch
                      </label>
                    )}
                  </div>
                </div>

                {formData.inventoryTracking === 'none' && (
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
                values={(formData.customFields as unknown as Record<string, unknown>) ?? {}}
                onChange={(v) => setFormData((prev) => ({ ...prev, customFields: v }))}
                errors={customFieldErrors}
              />
            </div>
          )}

          <div
            style={{
              height: '56px',
              boxSizing: 'border-box',
              position: 'fixed',
              bottom: 0,
              left: 220,
              right: 0,
              background: '#fff',
              padding: '0 32px',
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
              disabled={updateMutation.isPending}
              style={{
                padding: '8px 24px',
                background: '#0062ff',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: updateMutation.isPending ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                fontSize: '13px',
                opacity: updateMutation.isPending ? 0.7 : 1,
              }}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              disabled={updateMutation.isPending}
              onClick={() => navigate(`/organizations/${orgId}/items`)}
              style={{
                padding: '8px 24px',
                background: 'white',
                color: updateMutation.isPending ? '#94a3b8' : '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                cursor: updateMutation.isPending ? 'not-allowed' : 'pointer',
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
