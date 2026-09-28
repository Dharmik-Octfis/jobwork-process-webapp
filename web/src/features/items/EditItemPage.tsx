import { useState, useMemo } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { itemsApi } from './items.api.ts';
import type { ItemFormData } from './items.schemas.ts';
import { itemFormSchema } from './items.schemas.ts';
import { z } from 'zod';
import { Select } from '../../components/ui/Select.tsx';
import { CategorySelectDropdown } from './components/CategorySelectDropdown.tsx';
import { CustomFieldsSection } from '../custom-fields/CustomFieldsSection.tsx';
import { useUoms } from '../inventory/uom/uom.api.ts';
import { useActiveCustomFields } from '../custom-fields/customFields.api.ts';
import { UomFormModal } from '../inventory/uom/UomFormModal.tsx';
import { useTrackingLabel } from '../../hooks/useTrackingLabel.ts';
import { ItemImageGallery } from './components/ItemImageGallery.tsx';
import { Check, TrendingUp, ArrowLeft, Loader2, Plus } from 'lucide-react';

export function EditItemPage() {
  const { id, orgId } = useParams<{ id: string; orgId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: uoms = [] } = useUoms(orgId!);
  const { data: customFields = [] } = useActiveCustomFields(orgId!, 'item');
  const [isUomModalOpen, setIsUomModalOpen] = useState(false);
  const { singular } = useTrackingLabel();

  const [formData, setFormData] = useState<ItemFormData>({
    name: '',
    itemType: 'goods',
    category: '',
    hsnCode: '',
    itemStructure: 'single',
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

  const { data: item, isLoading } = useQuery({
    queryKey: ['item', orgId, id],
    queryFn: () => itemsApi.getItem(orgId!, id!),
    enabled: !!id && !!orgId,
  });

  if (item && initializedId !== id) {
    const rawItem = item as typeof item & Record<string, unknown>;
    setInitializedId(id!);
    setFormData({
      name: (rawItem.name as string) || '',
      itemType: (rawItem.itemType || 'goods') as 'goods' | 'service',
      category: (rawItem.category as string) || '',
      hsnCode: rawItem.hsnCode || '',
      itemStructure: 'single',
      unit: rawItem.unit || '',
      stockingUomId: rawItem.stockingUomId ?? null,
      sku: rawItem.sku || '',
      isSalesInfo: true,
      sellingPrice:
        rawItem.sellingPrice !== null && rawItem.sellingPrice !== undefined
          ? Number(rawItem.sellingPrice)
          : (null as unknown as number),
      salesDescription: (rawItem.salesDescription as string) || '',
      isPurchaseInfo: true,
      costPrice:
        rawItem.costPrice !== null && rawItem.costPrice !== undefined
          ? Number(rawItem.costPrice)
          : (null as unknown as number),
      purchaseDescription: (rawItem.purchaseDescription as string) || '',
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
        rawItem.customFields || (rawItem.customFields as unknown as Record<string, unknown>) || {},
    });
  }

  // Calculate live profit margin
  const marginMetrics = useMemo(() => {
    const sp = Number(formData.sellingPrice);
    const cp = Number(formData.costPrice);
    if (!isNaN(sp) && !isNaN(cp) && sp > 0 && formData.isSalesInfo && formData.isPurchaseInfo) {
      const margin = sp - cp;
      const marginPercent = (margin / sp) * 100;
      return { margin, marginPercent, isProfitable: margin >= 0 };
    }
    return null;
  }, [formData.sellingPrice, formData.costPrice, formData.isSalesInfo, formData.isPurchaseInfo]);

  const updateMutation = useMutation({
    mutationFn: (data: ItemFormData) => {
      const currentImages = {
        frontImage: item?.frontImage ?? data.frontImage,
        rearImage: item?.rearImage ?? data.rearImage,
        images: item?.images ?? data.images,
      };
      return itemsApi.updateItem({ orgId: orgId!, id: id!, data: { ...data, ...currentImages } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
      queryClient.invalidateQueries({ queryKey: ['item', orgId, id] });
      navigate(`/organizations/${orgId}/items/${id}`);
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
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          gap: 12,
          color: '#64748b',
        }}
      >
        <Loader2 className="animate-spin" size={32} color="#0284c7" />
        <div style={{ fontSize: 14, fontWeight: 500 }}>Loading item details...</div>
      </div>
    );
  }

  const fieldLabelStyle = {
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
  };

  const inputStyle = {
    height: 36,
    padding: '6px 12px',
    borderRadius: 4,
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    fontSize: 13,
    color: '#0f172a',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  };

  return (
    <div className="page-container">
      {/* Top Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={() => navigate(`/organizations/${orgId}/items/${id}`)}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
            }}
            title="Back to Item"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 2 }}>
              Items Catalog / {formData.name || 'Item'} / Edit
            </div>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#0f172a' }}>
              Edit Item
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              const returnUrl = (location.state as { returnUrl?: string })?.returnUrl;
              if (returnUrl) navigate(returnUrl);
              else navigate(`/organizations/${orgId}/items/${id}`);
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            form="edit-item-form"
            type="submit"
            disabled={updateMutation.isPending}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 18px',
              borderRadius: 4,
              border: 'none',
              background: '#0284c7',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              cursor: updateMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: updateMutation.isPending ? 0.7 : 1,
            }}
          >
            <Check size={14} strokeWidth={2.5} />
            {updateMutation.isPending ? 'Updating...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Main Scrollable Body — balanced professional 2-column layout */}
      <div
        className="page-body"
        style={{
          padding: '24px 36px 80px',
          background: '#ffffff',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <form
          id="edit-item-form"
          onSubmit={handleSubmit}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.35fr) minmax(420px, 1fr)',
            gap: 36,
            alignItems: 'start',
            width: '100%',
          }}
        >
          {/* LEFT: Primary Form Details */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {/* Section 1: General Details */}
            <div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#0f172a',
                  paddingBottom: 8,
                  marginBottom: 20,
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>General Information</span>
                {marginMetrics && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: marginMetrics.isProfitable ? '#0284c7' : '#dc2626',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      background: '#f0f9ff',
                      padding: '2px 10px',
                      borderRadius: 12,
                    }}
                  >
                    <TrendingUp size={13} />
                    Margin: ₹{marginMetrics.margin.toFixed(2)} (
                    {marginMetrics.marginPercent.toFixed(1)}%)
                  </span>
                )}
              </div>

              {/* Type */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ ...fieldLabelStyle, display: 'block', marginBottom: 6 }}>
                  Item Type
                </label>
                <div
                  style={{
                    display: 'inline-flex',
                    background: '#f1f5f9',
                    padding: 3,
                    borderRadius: 6,
                    gap: 4,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, itemType: 'goods' }))}
                    style={{
                      padding: '6px 20px',
                      borderRadius: 4,
                      border: 'none',
                      background: formData.itemType === 'goods' ? '#0284c7' : 'transparent',
                      color: formData.itemType === 'goods' ? '#ffffff' : '#475569',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Goods
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        itemType: 'service',
                        inventoryTracking: 'none',
                      }))
                    }
                    style={{
                      padding: '6px 20px',
                      borderRadius: 4,
                      border: 'none',
                      background: formData.itemType === 'service' ? '#0284c7' : 'transparent',
                      color: formData.itemType === 'service' ? '#ffffff' : '#475569',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Service
                  </button>
                </div>
              </div>

              {/* Item Name */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ ...fieldLabelStyle, display: 'block', marginBottom: 6 }}>
                  Item Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Enter item name (e.g. SS 304 Round Bar 25mm or CNC Machining)"
                  style={{
                    ...inputStyle,
                    borderColor: errors.name ? '#ef4444' : '#cbd5e1',
                  }}
                />
                {errors.name && (
                  <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{errors.name}</div>
                )}
              </div>

              {/* Row: SKU & Category */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 16,
                  marginBottom: 18,
                }}
              >
                <div>
                  <label style={{ ...fieldLabelStyle, display: 'block', marginBottom: 6 }}>
                    SKU / Item Code
                  </label>
                  <input
                    name="sku"
                    value={formData.sku || ''}
                    onChange={handleChange}
                    placeholder="e.g. ITM-001"
                    style={{
                      ...inputStyle,
                      borderColor: errors.sku ? '#ef4444' : '#cbd5e1',
                    }}
                  />
                  {errors.sku && (
                    <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{errors.sku}</div>
                  )}
                </div>

                <div>
                  <label style={{ ...fieldLabelStyle, display: 'block', marginBottom: 6 }}>
                    Category
                  </label>
                  <CategorySelectDropdown
                    value={formData.category || null}
                    onChange={(val) => handleSelectChange('category', val)}
                    error={!!errors.category}
                  />
                </div>
              </div>

              {/* Row: Stocking Unit & HSN/SAC */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ ...fieldLabelStyle, display: 'block', marginBottom: 6 }}>
                    Stocking Unit <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                          if (errors.unit) {
                            setErrors((prev) => {
                              const n = { ...prev };
                              delete n.unit;
                              return n;
                            });
                          }
                        }}
                        options={[
                          ...uoms.map((u) => ({ value: u.id, label: u.unitName })),
                          ...(formData.unit && !uoms.some((u) => u.id === formData.stockingUomId)
                            ? [{ value: '', label: `${formData.unit} — no stocking unit set` }]
                            : []),
                        ]}
                        placeholder="Select unit..."
                        portal={true}
                        buttonStyle={{ height: 36, fontSize: 13 }}
                        hasError={!!errors.unit}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setIsUomModalOpen(true);
                      }}
                      style={{
                        height: 36,
                        padding: '0 12px',
                        borderRadius: 4,
                        border: '1px solid #0284c7',
                        background: '#f0f7fd',
                        color: '#0284c7',
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      <Plus size={14} /> Add Unit
                    </button>
                  </div>
                  {errors.unit && (
                    <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                      {errors.unit}
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ ...fieldLabelStyle, display: 'block', marginBottom: 6 }}>
                    {formData.itemType === 'service' ? 'SAC Code' : 'HSN Code'}
                  </label>
                  <input
                    name="hsnCode"
                    value={formData.hsnCode || ''}
                    onChange={handleChange}
                    placeholder={formData.itemType === 'service' ? 'e.g. 998898' : 'e.g. 84818030'}
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Pricing & Commercials */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#0f172a',
                  marginBottom: 16,
                }}
              >
                Pricing & Commercials
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 24,
                }}
              >
                {/* Sales Side */}
                <div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#0f172a',
                      cursor: 'pointer',
                      marginBottom: 14,
                    }}
                  >
                    <input
                      type="checkbox"
                      name="isSalesInfo"
                      checked={formData.isSalesInfo}
                      onChange={handleChange}
                      style={{ accentColor: '#0284c7', width: 16, height: 16, cursor: 'pointer' }}
                    />
                    Sales Information
                  </label>

                  {formData.isSalesInfo && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div>
                        <label style={{ ...fieldLabelStyle, display: 'block', marginBottom: 4 }}>
                          Selling Price (₹) <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          name="sellingPrice"
                          value={formData.sellingPrice ?? ''}
                          onChange={handleChange}
                          placeholder="0.00"
                          style={{
                            ...inputStyle,
                            borderColor: errors.sellingPrice ? '#ef4444' : '#cbd5e1',
                          }}
                        />
                        {errors.sellingPrice && (
                          <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                            {errors.sellingPrice}
                          </div>
                        )}
                      </div>

                      <div>
                        <label style={{ ...fieldLabelStyle, display: 'block', marginBottom: 4 }}>
                          Sales Description
                        </label>
                        <textarea
                          name="salesDescription"
                          value={formData.salesDescription || ''}
                          onChange={(e) =>
                            handleChange(e as unknown as React.ChangeEvent<HTMLInputElement>)
                          }
                          rows={3}
                          placeholder="Description for invoices and quotes"
                          style={{
                            ...inputStyle,
                            height: 'auto',
                            resize: 'vertical',
                            padding: '8px 12px',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Purchase Side */}
                <div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#0f172a',
                      cursor: 'pointer',
                      marginBottom: 14,
                    }}
                  >
                    <input
                      type="checkbox"
                      name="isPurchaseInfo"
                      checked={formData.isPurchaseInfo}
                      onChange={handleChange}
                      style={{ accentColor: '#0284c7', width: 16, height: 16, cursor: 'pointer' }}
                    />
                    Purchase Information
                  </label>

                  {formData.isPurchaseInfo && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div>
                        <label style={{ ...fieldLabelStyle, display: 'block', marginBottom: 4 }}>
                          Cost Price (₹) <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          name="costPrice"
                          value={formData.costPrice ?? ''}
                          onChange={handleChange}
                          placeholder="0.00"
                          style={{
                            ...inputStyle,
                            borderColor: errors.costPrice ? '#ef4444' : '#cbd5e1',
                          }}
                        />
                        {errors.costPrice && (
                          <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                            {errors.costPrice}
                          </div>
                        )}
                      </div>

                      <div>
                        <label style={{ ...fieldLabelStyle, display: 'block', marginBottom: 4 }}>
                          Purchase Description
                        </label>
                        <textarea
                          name="purchaseDescription"
                          value={formData.purchaseDescription || ''}
                          onChange={(e) =>
                            handleChange(e as unknown as React.ChangeEvent<HTMLInputElement>)
                          }
                          rows={3}
                          placeholder="Description for purchase orders and bills"
                          style={{
                            ...inputStyle,
                            height: 'auto',
                            resize: 'vertical',
                            padding: '8px 12px',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Section 3: Inventory & Stock Tracking (Goods Only) */}
            {formData.itemType === 'goods' && (
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#0f172a',
                    marginBottom: 14,
                  }}
                >
                  Inventory Tracking
                </div>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#0f172a',
                    cursor: 'pointer',
                    marginBottom: 16,
                  }}
                >
                  <input
                    type="checkbox"
                    name="trackInventory"
                    checked={formData.trackInventory}
                    onChange={handleChange}
                    style={{ accentColor: '#0284c7', width: 16, height: 16, cursor: 'pointer' }}
                  />
                  Track inventory for this item
                </label>

                {formData.trackInventory && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingLeft: 24 }}
                  >
                    <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 13,
                          cursor: 'pointer',
                          color: '#334155',
                        }}
                      >
                        <input
                          type="radio"
                          name="inventoryTracking"
                          value="none"
                          checked={formData.inventoryTracking === 'none'}
                          onChange={() =>
                            setFormData((prev) => ({ ...prev, inventoryTracking: 'none' }))
                          }
                          style={{ accentColor: '#0284c7' }}
                        />
                        Standard Tracking (Quantity only)
                      </label>

                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 13,
                          cursor: 'pointer',
                          color: '#334155',
                        }}
                      >
                        <input
                          type="radio"
                          name="inventoryTracking"
                          value="batch"
                          checked={formData.inventoryTracking === 'batch'}
                          onChange={() =>
                            setFormData((prev) => ({ ...prev, inventoryTracking: 'batch' }))
                          }
                          style={{ accentColor: '#0284c7' }}
                        />
                        {singular} Tracking (Batch / Serial / Lot)
                      </label>
                    </div>

                    {formData.inventoryTracking === 'none' && (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 16,
                          marginTop: 4,
                        }}
                      >
                        <div>
                          <label style={{ ...fieldLabelStyle, display: 'block', marginBottom: 4 }}>
                            Opening Stock Quantity
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            name="openingStock"
                            value={formData.openingStock ?? ''}
                            onChange={handleChange}
                            placeholder="0.00"
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <label style={{ ...fieldLabelStyle, display: 'block', marginBottom: 4 }}>
                            Value per Unit (₹)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            name="openingStockValuePerUnit"
                            value={formData.openingStockValuePerUnit ?? ''}
                            onChange={handleChange}
                            placeholder="0.00"
                            style={inputStyle}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Section 4: Custom Fields */}
            {orgId && customFields.length > 0 && (
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#0f172a',
                    marginBottom: 16,
                  }}
                >
                  Custom Fields
                </div>
                <CustomFieldsSection
                  orgId={orgId}
                  entityType="item"
                  values={(formData.customFields as unknown as Record<string, unknown>) ?? {}}
                  onChange={(v) => setFormData((prev) => ({ ...prev, customFields: v }))}
                  errors={customFieldErrors}
                  applyDefaults={false}
                />
              </div>
            )}
          </div>

          {/* RIGHT: Media & Live Intelligence Sidebar */}
          <div
            style={{
              position: 'sticky',
              top: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
          >
            {/* Real Item Images Gallery (matching Detail page with full view, upload & delete support) */}
            {item && <ItemImageGallery orgId={orgId!} itemId={id!} item={item} />}

            {/* Live Profitability Card */}
            {marginMetrics && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderLeft: `3px solid ${marginMetrics.isProfitable ? '#0284c7' : '#ef4444'}`,
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#64748b',
                    textTransform: 'uppercase',
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>Profit Margin</span>
                  <TrendingUp
                    size={14}
                    color={marginMetrics.isProfitable ? '#0284c7' : '#ef4444'}
                  />
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: marginMetrics.isProfitable ? '#0284c7' : '#ef4444',
                  }}
                >
                  ₹{marginMetrics.margin.toFixed(2)}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  Margin Percentage: <strong>{marginMetrics.marginPercent.toFixed(1)}%</strong>
                </div>
              </div>
            )}

            {/* Item Configuration Overview */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 10 }}>
                Item Overview
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Item Type:</span>
                  <strong style={{ color: '#0f172a', textTransform: 'capitalize' }}>
                    {formData.itemType}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Inventory:</span>
                  <strong
                    style={{
                      color:
                        formData.itemType === 'goods' && formData.trackInventory
                          ? '#16a34a'
                          : '#64748b',
                    }}
                  >
                    {formData.itemType === 'goods' && formData.trackInventory
                      ? 'Tracked'
                      : 'Not Tracked'}
                  </strong>
                </div>
                {formData.unit && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748b' }}>Stocking Unit:</span>
                    <strong style={{ color: '#0f172a' }}>{formData.unit}</strong>
                  </div>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* Docked Page Footer — Standard across the whole application */}
      <div className="form-actions-footer page-footer">
        <button
          form="edit-item-form"
          type="submit"
          disabled={updateMutation.isPending}
          style={{
            padding: '7px 22px',
            background: '#0284c7',
            color: '#ffffff',
            border: 'none',
            borderRadius: 4,
            cursor: updateMutation.isPending ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: 13,
            opacity: updateMutation.isPending ? 0.7 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Check size={14} strokeWidth={2.5} />
          {updateMutation.isPending ? 'Updating...' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={() => {
            const returnUrl = (location.state as { returnUrl?: string })?.returnUrl;
            if (returnUrl) navigate(returnUrl);
            else navigate(`/organizations/${orgId}/items/${id}`);
          }}
          style={{
            padding: '7px 18px',
            background: '#ffffff',
            color: '#334155',
            border: '1px solid #cbd5e1',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: 13,
          }}
        >
          Cancel
        </button>
      </div>

      <UomFormModal
        orgId={orgId!}
        isOpen={isUomModalOpen}
        onClose={() => setIsUomModalOpen(false)}
      />
    </div>
  );
}
