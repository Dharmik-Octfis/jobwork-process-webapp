import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { compositeItemsApi } from './compositeItems.api';
import type { UpdateCompositeItemDto } from './compositeItems.api';
import type { ItemFormData } from '../../items/items.schemas';
import { itemFormSchema } from '../../items/items.schemas';
import { z } from 'zod';
import { Select } from '../../../components/ui/Select';
import { CategorySelectDropdown } from '../../items/components/CategorySelectDropdown';
import { CustomFieldsSection } from '../../custom-fields/CustomFieldsSection';
import { useUoms } from '../uom/uom.api';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';
import { UomFormModal } from '../uom/UomFormModal';
import { Plus } from 'lucide-react';
import { CompositeItemsList } from './CompositeItemsList.tsx';

export function EditCompositeItemPage() {
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
    itemType: 'Composite Item',
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
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [initializedId, setInitializedId] = useState<string | null>(null);

  const { data: item, isLoading } = useQuery({
    queryKey: ['item', orgId, id],
    queryFn: () => compositeItemsApi.getItem(orgId!, id!),
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
      itemType: (rawItem.itemType || rawItem.item_type || 'Composite Item') as
        | 'Single Item'
        | 'Contains Variants',
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
        (rawItem.salesDescription as string) || (rawItem.sales_description as string) || '',
      isPurchaseInfo: true,
      costPrice:
        rawItem.costPrice !== null && rawItem.costPrice !== undefined
          ? Number(rawItem.costPrice)
          : rawItem.purchase_rate !== null && rawItem.purchase_rate !== undefined
            ? Number(rawItem.purchase_rate)
            : (null as unknown as number),
      purchaseDescription:
        (rawItem.purchaseDescription as string) || (rawItem.purchase_description as string) || '',
      packaging: rawItem.packaging || '',
      frontImage: rawItem.frontImage || rawItem.front_image || null,
      rearImage: rawItem.rearImage || rawItem.rear_image || null,
      images: rawItem.images || [],
      trackInventory: true,
      inventoryTracking: rawItem.inventoryTracking || rawItem.inventory_tracking || 'None',
      openingStock:
        rawItem.openingStock !== null && rawItem.openingStock !== undefined
          ? Number(rawItem.openingStock)
          : null,
      openingStockValuePerUnit:
        rawItem.openingStockValuePerUnit !== null && rawItem.openingStockValuePerUnit !== undefined
          ? Number(rawItem.openingStockValuePerUnit)
          : null,
      customFields:
        rawItem.customFields || (rawItem.custom_fields as Record<string, unknown>) || {},
    });
  }

  const updateMutation = useMutation({
    mutationFn: (data: Partial<ItemFormData>) =>
      compositeItemsApi.updateItem({
        orgId: orgId!,
        id: id!,
        data: data as UpdateCompositeItemDto,
      }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['compositeItems', orgId] });
      queryClient.invalidateQueries({ queryKey: ['item', orgId, id] });
      queryClient.invalidateQueries({ queryKey: ['itemActivities', orgId, id] });
      navigate(`/organizations/${orgId}/composite-items`);
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
        height: '34px',
        minHeight: '100vh',
        display: 'block',
        paddingBottom: '80px',
      }}
    >
      <div style={{ padding: '16px 24px' }}>
        <button
          type="button"
          onClick={() => navigate(`/organizations/${orgId}/composite-items`)}
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
          <ArrowLeft size={14} /> Back to Composite Items
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 400, margin: 0, color: '#000' }}>
            Edit Composite Item
          </h1>
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
                background: '#f8fafc',
                padding: '24px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                columnGap: '40px',
                rowGap: '14px',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 524px',
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
                      height: '34px',
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
                  gridTemplateColumns: '140px 524px',
                  alignItems: 'flex-start',
                  gap: '12px',
                }}
              >
                <label
                  style={{ fontSize: 13, color: '#ef4444', fontWeight: 500, paddingTop: '2px' }}
                >
                  Item Type*
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="customFields.compositeItemType"
                      value="Assembly Item"
                      checked={
                        formData.customFields?.compositeItemType === 'Assembly Item' ||
                        !formData.customFields?.compositeItemType
                      }
                      onChange={(e) => {
                        setFormData((prev) => ({
                          ...prev,
                          customFields: {
                            ...prev.customFields,
                            compositeItemType: e.target.value,
                          },
                        }));
                      }}
                      style={{ marginTop: '2px' }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#000' }}>
                        Assembly Item
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: '2px' }}>
                        A group of items combined together to be tracked and managed as a single
                        item.
                      </div>
                    </div>
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="customFields.compositeItemType"
                      value="Kit Item"
                      checked={formData.customFields?.compositeItemType === 'Kit Item'}
                      onChange={(e) => {
                        setFormData((prev) => ({
                          ...prev,
                          customFields: {
                            ...prev.customFields,
                            compositeItemType: e.target.value,
                          },
                        }));
                      }}
                      style={{ marginTop: '2px' }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#000' }}>Kit Item</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: '2px' }}>
                        Individual items sold together as one kit.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 524px',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <label style={{ fontSize: 12, color: '#ef4444', fontWeight: 500 }}>SKU*</label>
                <div>
                  <input
                    name="sku"
                    value={formData.sku || ''}
                    onChange={handleChange}
                    style={{
                      width: '100%',
                      height: '34px',
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
                  gridTemplateColumns: '140px 524px',
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
                  gridTemplateColumns: '140px 524px',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <label style={{ fontSize: 12, color: '#ef4444', fontWeight: 500 }}>Unit*</label>
                <div>
                  <div
                    style={{
                      display: 'flex',
                      border: errors.unit ? '1px solid #ef4444' : '1px solid #d1d5db',
                      borderRadius: '4px',
                      width: '100%',
                      height: '34px',
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
                              height: '34px',
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
                  gridTemplateColumns: '140px 524px',
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
                    height: '34px',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: '1px solid #d1d5db',
                    fontSize: 12,
                  }}
                />
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                    Sales Information
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    <input
                      type="checkbox"
                      name="isSalesInfo"
                      checked={formData.isSalesInfo}
                      onChange={handleChange}
                    />
                    Sellable
                  </label>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 24 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', alignItems: 'center', gap: 12 }}>
                    <label style={{ fontSize: 12, color: '#ef4444', fontWeight: 500 }}>
                      Selling Price*
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      name="sellingPrice"
                      value={formData.sellingPrice || ''}
                      onChange={handleChange}
                      disabled={!formData.isSalesInfo}
                      style={{
                        width: '100%',
                        height: '34px',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        border: errors.sellingPrice ? '1px solid #ef4444' : '1px solid #d1d5db',
                        fontSize: 12,
                        backgroundColor: formData.isSalesInfo ? '#fff' : '#f1f5f9',
                        color: formData.isSalesInfo ? '#000' : '#94a3b8',
                        cursor: formData.isSalesInfo ? 'text' : 'not-allowed',
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
                  <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', alignItems: 'flex-start', gap: 12 }}>
                    <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500, paddingTop: '8px' }}>
                      Sales Description
                    </label>
                    <textarea
                      name="salesDescription"
                      value={formData.salesDescription || ''}
                      onChange={(e) =>
                        handleChange(e as unknown as React.ChangeEvent<HTMLInputElement>)
                      }
                      rows={3}
                      disabled={!formData.isSalesInfo}
                      style={{
                        width: '100%',
                        height: '34px',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        border: '1px solid #d1d5db',
                        fontSize: 12,
                        resize: 'vertical',
                        backgroundColor: formData.isSalesInfo ? '#fff' : '#f1f5f9',
                        color: formData.isSalesInfo ? '#000' : '#94a3b8',
                        cursor: formData.isSalesInfo ? 'text' : 'not-allowed',
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Purchase Information */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                    Purchase Information
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    <input
                      type="checkbox"
                      name="isPurchaseInfo"
                      checked={formData.isPurchaseInfo}
                      onChange={handleChange}
                    />
                    Purchasable
                  </label>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 24 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', alignItems: 'center', gap: 12 }}>
                    <label style={{ fontSize: 12, color: '#ef4444', fontWeight: 500 }}>
                      Cost Price*
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      name="costPrice"
                      value={formData.costPrice || ''}
                      onChange={handleChange}
                      disabled={!formData.isPurchaseInfo}
                      style={{
                        width: '100%',
                        height: '34px',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        border: errors.costPrice ? '1px solid #ef4444' : '1px solid #d1d5db',
                        fontSize: 12,
                        backgroundColor: formData.isPurchaseInfo ? '#fff' : '#f1f5f9',
                        color: formData.isPurchaseInfo ? '#000' : '#94a3b8',
                        cursor: formData.isPurchaseInfo ? 'text' : 'not-allowed',
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
                  <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', alignItems: 'flex-start', gap: 12 }}>
                    <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500, paddingTop: '8px' }}>
                      Purchase Description
                    </label>
                    <textarea
                      name="purchaseDescription"
                      value={formData.purchaseDescription || ''}
                      onChange={(e) =>
                        handleChange(e as unknown as React.ChangeEvent<HTMLInputElement>)
                      }
                      rows={3}
                      disabled={!formData.isPurchaseInfo}
                      style={{
                        width: '100%',
                        height: '34px',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        border: '1px solid #d1d5db',
                        fontSize: 12,
                        resize: 'vertical',
                        backgroundColor: formData.isPurchaseInfo ? '#fff' : '#f1f5f9',
                        color: formData.isPurchaseInfo ? '#000' : '#94a3b8',
                        cursor: formData.isPurchaseInfo ? 'text' : 'not-allowed',
                      }}
                    />
                  </div>
                </div>
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
                          height: '34px',
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
                          height: '34px',
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
              onClick={() => navigate(`/organizations/${orgId}/composite-items`)}
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
        <div style={{ marginTop: 40, borderTop: '1px solid #e5e7eb', paddingTop: 40 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: '#111827', marginBottom: 24 }}>
            Recipe Components
          </h2>
          <CompositeItemsList itemId={id!} />
        </div>
      </div>

      <UomFormModal
        orgId={orgId!}
        isOpen={isUomModalOpen}
        onClose={() => setIsUomModalOpen(false)}
      />
    </div>
  );
}
