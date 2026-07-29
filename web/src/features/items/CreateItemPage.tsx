import { useState, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Select } from '../../components/ui/Select';
import { itemsApi } from './items.api.ts';
import type { ItemFormData, Item } from './items.schemas.ts';
import { itemFormSchema } from './items.schemas.ts';
import { z } from 'zod';
import { CustomFieldsSection } from '../custom-fields/CustomFieldsSection.tsx';

export function CreateItemPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const itemToClone = (location.state as { itemToClone?: Partial<Item> & Record<string, unknown> })?.itemToClone;

  const [formData, setFormData] = useState<ItemFormData>(() => {
    if (itemToClone) {
      return {
        name: itemToClone.name || '',
        type: (itemToClone.type || itemToClone.product_type || 'Goods') as 'Goods' | 'Service',
        category: itemToClone.category || '',
        brand: itemToClone.brand || '',
        manufacturer: itemToClone.manufacturer || '',
        hsnCode: itemToClone.hsnCode || itemToClone.hsn_or_sac || '',
        taxPreference: (itemToClone.taxPreference || itemToClone.taxability_type || (itemToClone.is_taxable ? 'Taxable' : 'Non-Taxable') || 'Taxable') as 'Taxable' | 'Non-Taxable',
        itemType: (itemToClone.itemType || itemToClone.item_type || 'Single Item') as 'Single Item' | 'Contains Variants',
        unit: itemToClone.unit || '',
        sku: itemToClone.sku || '',
        isSalesInfo: itemToClone.isSalesInfo ?? itemToClone.can_be_sold ?? false,
        sellingPrice: itemToClone.sellingPrice !== null && itemToClone.sellingPrice !== undefined
          ? Number(itemToClone.sellingPrice)
          : (itemToClone.rate !== null && itemToClone.rate !== undefined ? Number(itemToClone.rate) : null),
        salesAccount: itemToClone.salesAccount || itemToClone.account_id || '',
        isPurchaseInfo: itemToClone.isPurchaseInfo ?? itemToClone.can_be_purchased ?? false,
        costPrice: itemToClone.costPrice !== null && itemToClone.costPrice !== undefined
          ? Number(itemToClone.costPrice)
          : (itemToClone.purchase_rate !== null && itemToClone.purchase_rate !== undefined ? Number(itemToClone.purchase_rate) : null),
        purchaseAccount: itemToClone.purchaseAccount || itemToClone.purchase_account_id || '',
        packaging: itemToClone.packaging || '',
        deliveryDate: (itemToClone.deliveryDate || itemToClone.delivery_date) ? String(itemToClone.deliveryDate || itemToClone.delivery_date).split('T')[0] : '',
        frontImage: itemToClone.frontImage || itemToClone.front_image || null,
        rearImage: itemToClone.rearImage || itemToClone.rear_image || null,
        images: itemToClone.images || [],
        trackInventory: itemToClone.trackInventory ?? itemToClone.track_inventory ?? false,
        binLocationTracking: (itemToClone.binLocationTracking === 'Yes' || itemToClone.is_storage_location_enabled === true || itemToClone.is_storage_location_enabled === 'Yes') ? 'Yes' : 'No',
        inventoryTracking: itemToClone.inventoryTracking || itemToClone.inventory_tracking || 'None',
        inventoryAccount: itemToClone.inventoryAccount || itemToClone.inventory_account_id || '',
        inventoryValuationMethod: itemToClone.inventoryValuationMethod || itemToClone.inventory_valuation_method || 'FIFO (First In, First Out)',
        customFields: (itemToClone.customFields || itemToClone.custom_fields as Record<string, unknown>) || {},
      };
    }
    return {
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
      navigate(`/organizations/${orgId}/items`);
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
        <h1 style={{ fontSize: '22px', fontWeight: 400, margin: 0, color: '#000' }}>New Item</h1>
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
                <label style={{ fontSize: 12, color: '#dc2626', fontWeight: 500 }}>Name*</label>
                <div>
                  <input
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    style={{
                      width: '100%',
                      maxWidth: '400px',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      border: errors.name ? '1px solid #ef4444' : '1px solid #d1d5db',
                      fontSize: 12,
                    }}
                  />
                  {errors.name && (
                    <span style={{ color: '#ef4444', fontSize: 12, marginTop: 4, display: 'block' }}>
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
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="type"
                      value="Goods"
                      checked={formData.type === 'Goods'}
                      onChange={() => handleRadioChange('type', 'Goods')}
                    />{' '}
                    Goods
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
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
                <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Category</label>
                <div style={{ maxWidth: '400px' }}>
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
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Brand</label>
                <div style={{ maxWidth: '400px' }}>
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
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Manufacturer</label>
                <div style={{ maxWidth: '400px' }}>
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
                    maxWidth: '400px',
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
                  <div style={{ fontSize: 12, marginBottom: 6, color: '#1e293b', fontWeight: 500 }}>Front View</div>
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
                      padding: '12px 8px',
                      border: '1px dashed #cbd5e1',
                      borderRadius: '6px',
                      background: '#ffffff',
                      color: '#0062ff',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 500 }}>
                      {frontImageFile ? frontImageFile.name : '↑ Upload Front Image'}
                    </span>
                  </button>
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 6, color: '#1e293b', fontWeight: 500 }}>Rear View</div>
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
                      padding: '12px 8px',
                      border: '1px dashed #cbd5e1',
                      borderRadius: '6px',
                      background: '#ffffff',
                      color: '#0062ff',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 500 }}>
                      {rearImageFile ? rearImageFile.name : '↑ Upload Rear Image'}
                    </span>
                  </button>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 12, marginBottom: 6, color: '#1e293b', fontWeight: 500 }}>Other Images</div>
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
                    style={{ fontWeight: 500, fontSize: 12, color: '#1e293b', textAlign: 'center' }}
                  >
                    {otherImageFiles.length > 0
                      ? `${otherImageFiles.length} files selected`
                      : 'Drag & Drop Images'}
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

          <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '8px 0' }} />

          {/* Item Details Section */}
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
            <h3
              style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: '#1e293b' }}
            >
              Item Details
            </h3>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Item Type</label>
              <div style={{ display: 'flex', gap: 12 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    padding: '6px 14px',
                    border:
                      formData.itemType === 'Single Item'
                        ? '1px solid #0062ff'
                        : '1px solid #cbd5e1',
                    borderRadius: 6,
                    background: formData.itemType === 'Single Item' ? '#f0f6ff' : 'white',
                    color: formData.itemType === 'Single Item' ? '#0062ff' : '#4b5563',
                    cursor: 'pointer',
                    fontWeight: 500,
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
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: formData.itemType === 'Single Item' ? '#0062ff' : '#e2e8f0',
                      border: '2px solid white',
                      boxShadow:
                        '0 0 0 1px ' +
                        (formData.itemType === 'Single Item' ? '#0062ff' : '#cbd5e1'),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {formData.itemType === 'Single Item' && (
                      <div
                        style={{ width: 4, height: 4, borderRadius: '50%', background: 'white' }}
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
                    padding: '6px 14px',
                    border:
                      formData.itemType === 'Contains Variants'
                        ? '1px solid #0062ff'
                        : '1px solid #cbd5e1',
                    borderRadius: 6,
                    background: formData.itemType === 'Contains Variants' ? '#f0f6ff' : 'white',
                    color: formData.itemType === 'Contains Variants' ? '#0062ff' : '#4b5563',
                    cursor: 'pointer',
                    fontWeight: 500,
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
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: formData.itemType === 'Contains Variants' ? '#0062ff' : '#e2e8f0',
                      border: '2px solid white',
                      boxShadow:
                        '0 0 0 1px ' +
                        (formData.itemType === 'Contains Variants' ? '#0062ff' : '#cbd5e1'),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {formData.itemType === 'Contains Variants' && (
                      <div
                        style={{ width: 4, height: 4, borderRadius: '50%', background: 'white' }}
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
                gridTemplateColumns: '140px 1fr',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <label style={{ fontSize: 12, color: '#dc2626', fontWeight: 500 }}>Unit*</label>
              <div>
                <div
                  style={{
                    display: 'flex',
                    border: errors.unit ? '1px solid #ef4444' : '1px solid #d1d5db',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    maxWidth: '400px',
                  }}
                >
                  <div
                    style={{
                      padding: '6px 12px',
                      borderRight: '1px solid #d1d5db',
                      background: '#f1f5f9',
                      fontSize: 12,
                      color: '#475569',
                      display: 'flex',
                      alignItems: 'center',
                      whiteSpace: 'nowrap',
                      fontWeight: 500,
                    }}
                  >
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
              <label style={{ fontSize: 12, color: '#dc2626', fontWeight: 500 }}>SKU*</label>
              <div>
                <input
                  name="sku"
                  value={formData.sku}
                  onChange={handleChange}
                  style={{
                    width: '100%',
                    maxWidth: '400px',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: errors.sku ? '1px solid #ef4444' : '1px solid #d1d5db',
                    fontSize: 12,
                  }}
                />
                {errors.sku && (
                  <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                    {errors.sku}
                  </div>
                )}
              </div>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '8px 0' }} />

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
                  <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Bin Location Tracking</label>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="binLocationTracking"
                        value="Yes"
                        checked={formData.binLocationTracking === 'Yes'}
                        onChange={() => handleRadioChange('binLocationTracking', 'Yes')}
                      />{' '}
                      Yes
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
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
                    gridTemplateColumns: '160px 1fr',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Inventory Tracking</label>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="inventoryTracking"
                        value="None"
                        checked={formData.inventoryTracking === 'None'}
                        onChange={() => handleRadioChange('inventoryTracking', 'None')}
                      />{' '}
                      None
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="inventoryTracking"
                        value="Serial"
                        checked={formData.inventoryTracking === 'Serial'}
                        onChange={() => handleRadioChange('inventoryTracking', 'Serial')}
                      />{' '}
                      Serial
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
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
                    gridTemplateColumns: '160px 1fr',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <label style={{ fontSize: 12, color: '#dc2626', fontWeight: 500 }}>Inventory Account*</label>
                  <div style={{ maxWidth: '400px' }}>
                    <Select
                      value={formData.inventoryAccount || ''}
                      onChange={(val) => handleSelectChange('inventoryAccount', val)}
                      options={[
                        { value: '', label: 'Select an account' },
                        { value: 'Inventory Asset', label: 'Inventory Asset' },
                      ]}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '160px 1fr',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <label style={{ fontSize: 12, color: '#dc2626', fontWeight: 500 }}>
                    Inventory Valuation Method*
                  </label>
                  <div style={{ maxWidth: '400px' }}>
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
              </div>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '8px 0' }} />

          {/* Sales and Purchase Information */}
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
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1e293b' }}>
              Sales & Purchase Information
            </h3>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#334155', marginBottom: formData.isSalesInfo ? 12 : 0 }}>
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
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                    paddingLeft: 24,
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '140px 1fr',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Selling Price</label>
                    <input
                      type="number"
                      step="0.01"
                      name="sellingPrice"
                      value={formData.sellingPrice || ''}
                      onChange={handleChange}
                      style={{
                        width: '100%',
                        maxWidth: '400px',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        border: '1px solid #d1d5db',
                        fontSize: 12,
                      }}
                    />
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '140px 1fr',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Sales Account</label>
                    <div style={{ maxWidth: '400px' }}>
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
                  </div>
                </div>
              )}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '4px 0' }} />

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#334155', marginBottom: formData.isPurchaseInfo ? 12 : 0 }}>
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
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                    paddingLeft: 24,
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '140px 1fr',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Cost Price</label>
                    <input
                      type="number"
                      step="0.01"
                      name="costPrice"
                      value={formData.costPrice || ''}
                      onChange={handleChange}
                      style={{
                        width: '100%',
                        maxWidth: '400px',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        border: '1px solid #d1d5db',
                        fontSize: 12,
                      }}
                    />
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '140px 1fr',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Purchase Account</label>
                    <div style={{ maxWidth: '400px' }}>
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
                  </div>
                </div>
              )}
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '8px 0' }} />

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
              {createMutation.isPending ? 'Saving...' : 'Save Item'}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/organizations/${orgId}/items`)}
              style={{
                padding: '8px 24px',
                background: 'white',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: '13px',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
