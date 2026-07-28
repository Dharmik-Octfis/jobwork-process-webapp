import { useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Trash } from 'lucide-react';
import { itemsApi } from './items.api.ts';
import type { ItemFormData } from './items.schemas.ts';
import { itemFormSchema } from './items.schemas.ts';
import { z } from 'zod';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { CustomFieldsSection } from '../custom-fields/CustomFieldsSection.tsx';


export function EditItemPage() {
  const { id, orgId } = useParams<{ id: string; orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<ItemFormData>({
    name: '',

    type: 'Goods',
    category: '',
    brand: '',
    manufacturer: '',
    hsnCode: '',
    taxPreference: 'Taxable',
    itemType: 'Single Item',
    unit: '',
    sku: '',
    isSalesInfo: false,
    sellingPrice: null,
    salesAccount: '',
    isPurchaseInfo: false,
    costPrice: null,
    purchaseAccount: '',
    packaging: '',
    deliveryDate: '',
    frontImage: null,
    rearImage: null,
    images: [],
    trackInventory: false,
    binLocationTracking: 'No',
    inventoryTracking: 'None',
    inventoryAccount: '',
    inventoryValuationMethod: 'FIFO (First In, First Out)',
    customFields: {},
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [initializedId, setInitializedId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
      type: ((rawItem.type || rawItem.product_type || 'Goods') as 'Goods' | 'Service'),
      category: (rawItem.category as string) || '',
      brand: (rawItem.brand as string) || '',
      manufacturer: rawItem.manufacturer || '',
      hsnCode: rawItem.hsnCode || rawItem.hsn_or_sac || '',
      taxPreference: (rawItem.taxPreference || rawItem.taxability_type || (rawItem.is_taxable ? 'Taxable' : 'Non-Taxable') || 'Taxable') as 'Taxable' | 'Non-Taxable',
      itemType: (rawItem.itemType || rawItem.item_type || 'Single Item') as 'Single Item' | 'Contains Variants',
      unit: rawItem.unit || '',
      sku: rawItem.sku || '',
      isSalesInfo: rawItem.isSalesInfo ?? rawItem.can_be_sold ?? false,
      sellingPrice: rawItem.sellingPrice !== null && rawItem.sellingPrice !== undefined
        ? Number(rawItem.sellingPrice)
        : (rawItem.rate !== null && rawItem.rate !== undefined ? Number(rawItem.rate) : null),
      salesAccount: rawItem.salesAccount || rawItem.account_id || '',
      isPurchaseInfo: rawItem.isPurchaseInfo ?? rawItem.can_be_purchased ?? false,
      costPrice: rawItem.costPrice !== null && rawItem.costPrice !== undefined
        ? Number(rawItem.costPrice)
        : (rawItem.purchase_rate !== null && rawItem.purchase_rate !== undefined ? Number(rawItem.purchase_rate) : null),
      purchaseAccount: rawItem.purchaseAccount || rawItem.purchase_account_id || '',
      packaging: rawItem.packaging || '',
      deliveryDate: (rawItem.deliveryDate || rawItem.delivery_date) ? String(rawItem.deliveryDate || rawItem.delivery_date).split('T')[0] : '',
      frontImage: rawItem.frontImage || rawItem.front_image || null,
      rearImage: rawItem.rearImage || rawItem.rear_image || null,
      images: rawItem.images || [],
      trackInventory: rawItem.trackInventory ?? rawItem.track_inventory ?? false,
      binLocationTracking: (rawItem.binLocationTracking === 'Yes' || rawItem.is_storage_location_enabled === true || rawItem.is_storage_location_enabled === 'Yes') ? 'Yes' : 'No',
      inventoryTracking: rawItem.inventoryTracking || rawItem.inventory_tracking || 'None',
      inventoryAccount: rawItem.inventoryAccount || rawItem.inventory_account_id || '',
      inventoryValuationMethod: rawItem.inventoryValuationMethod || rawItem.inventory_valuation_method || 'FIFO (First In, First Out)',
      customFields: (rawItem.customFields || rawItem.custom_fields as Record<string, unknown>) || {},
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
      queryClient.invalidateQueries({ queryKey: ['item', orgId, id] });
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

  const deleteMutation = useMutation({
    mutationFn: () => itemsApi.deleteItem(orgId!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
      navigate(`/organizations/${orgId}/items`);
    },
    onError: (error) => {
      console.error('Failed to delete item:', error);
      alert('Failed to delete item.');
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
    setFormData((prev) => ({ ...prev, [name]: value }));
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
      setFrontImageFile(e.target.files[0]);
    }
  };

  const handleRearImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setRearImageFile(e.target.files[0]);
    }
  };

  const handleOtherImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setOtherImageFiles(Array.from(e.target.files));
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
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              color: '#dc2626',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            <Trash size={14} /> Delete
          </button>
        </div>
      </div>

      <div style={{ padding: '0 24px 24px' }}>
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
        >
          {/* Top Section: Basic Info & Images */}
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 360px', gap: '64px' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                background: '#f8fafc',
                padding: '24px',
                borderRadius: '8px',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 400px',
                  alignItems: 'center',
                }}
              >
                <label style={{ fontSize: 12, color: '#dc2626' }}>Name*</label>
                <div>
                  <input
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      border: '1px solid #d1d5db',
                      fontSize: 12,
                    }}
                  />
                  {errors.name && (
                    <span style={{ color: 'red', fontSize: 12, marginTop: 4, display: 'block' }}>
                      {errors.name}
                    </span>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 400px',
                  alignItems: 'center',
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563' }}>Type</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <input
                      type="radio"
                      name="type"
                      value="Goods"
                      checked={formData.type === 'Goods'}
                      onChange={() => handleRadioChange('type', 'Goods')}
                    />{' '}
                    Goods
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
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
                  gridTemplateColumns: '140px 400px',
                  alignItems: 'center',
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563' }}>Category</label>
                <Select
                  value={formData.category || ''}
                  onChange={(val) => handleSelectChange('category', val)}
                  options={[
                    { value: '', label: 'Select a category' },
                    { value: 'Electronics', label: 'Electronics' },
                    { value: 'Furniture', label: 'Furniture' },
                    { value: 'Foot wear', label: 'Foot wear' },
                    ...(formData.category && !['Electronics', 'Furniture', 'Foot wear'].includes(formData.category)
                      ? [{ value: formData.category, label: formData.category }]
                      : []),
                  ]}
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 400px',
                  alignItems: 'center',
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563' }}>Brand</label>
                <Select
                  value={formData.brand || ''}
                  onChange={(val) => handleSelectChange('brand', val)}
                  options={[
                    { value: '', label: 'Select or Add Brand' },
                    { value: 'Apple', label: 'Apple' },
                    { value: 'Samsung', label: 'Samsung' },
                    ...(formData.brand && !['Apple', 'Samsung'].includes(formData.brand)
                      ? [{ value: formData.brand, label: formData.brand }]
                      : []),
                  ]}
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 400px',
                  alignItems: 'center',
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563' }}>Manufacturer</label>
                <Select
                  value={formData.manufacturer || ''}
                  onChange={(val) => handleSelectChange('manufacturer', val)}
                  options={[
                    { value: '', label: 'Select or Add Manufacturer' },
                    { value: 'Foxconn', label: 'Foxconn' },
                    ...(formData.manufacturer && !['Foxconn'].includes(formData.manufacturer)
                      ? [{ value: formData.manufacturer, label: formData.manufacturer }]
                      : []),
                  ]}
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 400px',
                  alignItems: 'center',
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563' }}>HSN Code</label>
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
                border: '1px solid #eef0f3',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 6, color: '#1e293b' }}>Front View</div>
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
                      padding: '24px',
                      border: '1px dashed #d1d5db',
                      borderRadius: '6px',
                      background: '#f8fafc',
                      color: '#0062ff',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                    }}
                  >
                    <span>
                      {frontImageFile
                        ? frontImageFile.name
                        : formData.frontImage
                          ? 'Change Front Image'
                          : '↑ Upload Front Image'}
                    </span>
                  </button>
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 6, color: '#1e293b' }}>Rear View</div>
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
                      padding: '24px',
                      border: '1px dashed #d1d5db',
                      borderRadius: '6px',
                      background: '#f8fafc',
                      color: '#0062ff',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                    }}
                  >
                    <span>
                      {rearImageFile
                        ? rearImageFile.name
                        : formData.rearImage
                          ? 'Change Rear Image'
                          : '↑ Upload Rear Image'}
                    </span>
                  </button>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, marginBottom: 6, color: '#1e293b' }}>Other Images</div>
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
                    height: 'calc(100% - 26px)',
                    padding: '24px',
                    border: '1px dashed #d1d5db',
                    borderRadius: '6px',
                    background: '#f8fafc',
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
                    }}
                  >
                    ↑
                  </div>
                  <div style={{ fontWeight: 500, fontSize: 12, color: '#1e293b' }}>
                    {otherImageFiles.length > 0
                      ? `${otherImageFiles.length} files selected`
                      : formData.images && formData.images.length > 0
                        ? `${formData.images.length} existing images (Click to replace)`
                        : 'Drag & Drop Images'}
                  </div>
                  <div
                    style={{ fontSize: 11, color: '#64748b', textAlign: 'center', lineHeight: 1.5 }}
                  >
                    You can add up to 3 images, each not exceeding 2 MB.
                  </div>
                </button>
              </div>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #cbd5e1' }} />

          {/* Item Details Section */}
          <div>
            <h3
              style={{ fontSize: '16px', fontWeight: 500, marginBottom: '12px', color: '#1e293b' }}
            >
              Item Details
            </h3>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 400px',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <label style={{ fontSize: 12, color: '#4b5563' }}>Item Type</label>
              <div style={{ display: 'flex', gap: 12 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    padding: '8px 16px',
                    border:
                      formData.itemType === 'Single Item'
                        ? '1px solid #0062ff'
                        : '1px solid #eef0f3',
                    borderRadius: 6,
                    background: formData.itemType === 'Single Item' ? '#f0f6ff' : 'white',
                    color: formData.itemType === 'Single Item' ? '#0062ff' : '#4b5563',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="itemType"
                    value="Single Item"
                    checked={formData.itemType === 'Single Item'}
                    onChange={() => handleRadioChange('itemType', 'Single Item')}
                    style={{ display: 'none' }}
                  />
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: formData.itemType === 'Single Item' ? '#0062ff' : '#eef0f3',
                      border: '2px solid white',
                      boxShadow:
                        '0 0 0 1px ' +
                        (formData.itemType === 'Single Item' ? '#0062ff' : '#d1d5db'),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {formData.itemType === 'Single Item' && (
                      <div
                        style={{ width: 6, height: 6, borderRadius: '50%', background: 'white' }}
                      />
                    )}
                  </div>
                  Single Item
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    padding: '8px 16px',
                    border:
                      formData.itemType === 'Contains Variants'
                        ? '1px solid #0062ff'
                        : '1px solid #eef0f3',
                    borderRadius: 6,
                    background: formData.itemType === 'Contains Variants' ? '#f0f6ff' : 'white',
                    color: formData.itemType === 'Contains Variants' ? '#0062ff' : '#4b5563',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="itemType"
                    value="Contains Variants"
                    checked={formData.itemType === 'Contains Variants'}
                    onChange={() => handleRadioChange('itemType', 'Contains Variants')}
                    style={{ display: 'none' }}
                  />
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: formData.itemType === 'Contains Variants' ? '#0062ff' : '#eef0f3',
                      border: '2px solid white',
                      boxShadow:
                        '0 0 0 1px ' +
                        (formData.itemType === 'Contains Variants' ? '#0062ff' : '#d1d5db'),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {formData.itemType === 'Contains Variants' && (
                      <div
                        style={{ width: 6, height: 6, borderRadius: '50%', background: 'white' }}
                      />
                    )}
                  </div>
                  Contains Variants
                </label>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '130px 240px 130px 240px',
                alignItems: 'center',
                gap: '12px 16px',
              }}
            >
              <label style={{ fontSize: 12, color: '#dc2626' }}>Unit*</label>
              <div
                style={{
                  display: 'flex',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div style={{
                  padding: '5px 8px',
                  borderRight: '1px solid #d1d5db',
                  background: '#f8fafc',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  Unit Group
                </div>
                <div style={{ flex: 1 }}>
                  <Select
                    value={formData.unit}
                    onChange={(val) => handleSelectChange('unit', val)}
                    options={[
                      { value: '', label: 'Select Unit' },
                      { value: 'pcs', label: 'pcs' },
                      { value: 'kg', label: 'kg' },
                      { value: 'box', label: 'box' },
                      ...(formData.unit && !['pcs', 'kg', 'box'].includes(formData.unit)
                        ? [{ value: formData.unit, label: formData.unit }]
                        : []),
                    ]}
                    buttonStyle={{ border: 'none' }}
                  />
                </div>
              </div>

              <label style={{ fontSize: 12, color: '#dc2626' }}>SKU*</label>
              <input
                name="sku"
                value={formData.sku}
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
            {errors.unit && (
              <div style={{ color: 'red', fontSize: 12, marginTop: 4, marginLeft: 150 }}>
                {errors.unit}
              </div>
            )}
            {errors.sku && (
              <div
                style={{
                  color: 'red',
                  fontSize: 12,
                  marginTop: 4,
                  marginLeft: 'calc(150px * 2 + 1fr + 48px)',
                }}
              >
                {errors.sku}
              </div>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #cbd5e1' }} />

          {/* Inventory Tracking */}
          <div>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
                fontSize: 13,
                fontWeight: 500,
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
                  marginTop: 12,
                  paddingLeft: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '200px 1fr',
                    alignItems: 'center',
                  }}
                >
                  <label style={{ fontSize: 12, color: '#4b5563' }}>Bin Location Tracking</label>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input
                        type="radio"
                        name="binLocationTracking"
                        value="Yes"
                        checked={formData.binLocationTracking === 'Yes'}
                        onChange={() => handleRadioChange('binLocationTracking', 'Yes')}
                      />{' '}
                      Yes
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input
                        type="radio"
                        name="binLocationTracking"
                        value="No"
                        checked={formData.binLocationTracking === 'No'}
                        onChange={() => handleRadioChange('binLocationTracking', 'No')}
                      />{' '}
                      No
                    </label>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '200px 1fr',
                    alignItems: 'center',
                  }}
                >
                  <label style={{ fontSize: 12, color: '#4b5563' }}>Inventory Tracking</label>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input
                        type="radio"
                        name="inventoryTracking"
                        value="None"
                        checked={formData.inventoryTracking === 'None'}
                        onChange={() => handleRadioChange('inventoryTracking', 'None')}
                      />{' '}
                      None
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input
                        type="radio"
                        name="inventoryTracking"
                        value="Serial"
                        checked={formData.inventoryTracking === 'Serial'}
                        onChange={() => handleRadioChange('inventoryTracking', 'Serial')}
                      />{' '}
                      Serial
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input
                        type="radio"
                        name="inventoryTracking"
                        value="Batch"
                        checked={formData.inventoryTracking === 'Batch'}
                        onChange={() => handleRadioChange('inventoryTracking', 'Batch')}
                      />{' '}
                      Batch
                    </label>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '200px 1fr 200px 1fr',
                    alignItems: 'center',
                    gap: '12px 16px',
                    marginTop: 12,
                  }}
                >
                  <label style={{ fontSize: 12, color: '#dc2626' }}>Inventory Account*</label>
                  <Select
                    value={formData.inventoryAccount || ''}
                    onChange={(val) => handleSelectChange('inventoryAccount', val)}
                    options={[
                      { value: '', label: 'Select an account' },
                      { value: 'Inventory Asset', label: 'Inventory Asset' },
                    ]}
                  />

                  <label style={{ fontSize: 12, color: '#dc2626' }}>
                    Inventory Valuation Method*
                  </label>
                  <Select
                    value={formData.inventoryValuationMethod || ''}
                    onChange={(val) => handleSelectChange('inventoryValuationMethod', val)}
                    options={[
                      { value: 'FIFO (First In, First Out)', label: 'FIFO (First In, First Out)' },
                      { value: 'Moving Average', label: 'Moving Average' },
                    ]}
                  />
                </div>
              </div>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #cbd5e1' }} />

          {/* Sales and Purchase Information */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <input
                type="checkbox"
                name="isSalesInfo"
                checked={formData.isSalesInfo}
                onChange={handleChange}
              />
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#1e293b' }}>
                Sales Information
              </h3>
            </div>
            {formData.isSalesInfo && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '130px 240px 130px 240px',
                  alignItems: 'center',
                  gap: '12px 16px',
                  paddingLeft: 16,
                  marginBottom: 12,
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563' }}>Selling Price</label>
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
                    border: '1px solid #d1d5db',
                    fontSize: 12,
                  }}
                />

                <label style={{ fontSize: 12, color: '#4b5563' }}>Sales Account</label>
                <Select
                  value={formData.salesAccount || ''}
                  onChange={(val) => handleSelectChange('salesAccount', val)}
                  options={[
                    { value: '', label: 'Select Account' },
                    { value: 'Sales', label: 'Sales' },
                    { value: 'General Income', label: 'General Income' },
                  ]}
                />
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <input
                type="checkbox"
                name="isPurchaseInfo"
                checked={formData.isPurchaseInfo}
                onChange={handleChange}
              />
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#1e293b' }}>
                Purchase Information
              </h3>
            </div>
            {formData.isPurchaseInfo && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '130px 240px 130px 240px',
                  alignItems: 'center',
                  gap: '12px 16px',
                  paddingLeft: 16,
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563' }}>Cost Price</label>
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
                    border: '1px solid #d1d5db',
                    fontSize: 12,
                  }}
                />

                <label style={{ fontSize: 12, color: '#4b5563' }}>Purchase Account</label>
                <Select
                  value={formData.purchaseAccount || ''}
                  onChange={(val) => handleSelectChange('purchaseAccount', val)}
                  options={[
                    { value: '', label: 'Select Account' },
                    { value: 'Cost of Goods Sold', label: 'Cost of Goods Sold' },
                    { value: 'Inventory', label: 'Inventory' },
                  ]}
                />
              </div>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #cbd5e1' }} />

          {/* Custom Fields */}
          {orgId && (
            <div>
              <h3
                style={{
                  fontSize: '16px',
                  fontWeight: 500,
                  marginBottom: '12px',
                  color: '#1e293b',
                }}
              >
                Custom Fields
              </h3>
              <CustomFieldsSection
                orgId={orgId}
                entityType="item"
                values={(formData.customFields as Record<string, unknown>) ?? {}}
                onChange={(v) => setFormData((prev) => ({ ...prev, customFields: v }))}
                errors={customFieldErrors}
              />
            </div>
          )}

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
              borderTop: '1px solid #cbd5e1',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              zIndex: 100,
            }}
          >
            <button
              type="submit"
              disabled={updateMutation.isPending}
              style={{
                padding: '6px 20px',
                background: '#0062ff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: updateMutation.isPending ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                fontSize: '12px',
                opacity: updateMutation.isPending ? 0.7 : 1,
              }}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/organizations/${orgId}/items`)}
              style={{
                padding: '6px 20px',
                background: 'white',
                color: '#333',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: '12px',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Item"
        message="Are you sure you want to delete this item? This action cannot be undone."
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
