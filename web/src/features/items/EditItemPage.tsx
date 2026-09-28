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
import {
  Check,
  TrendingUp,
  ArrowLeft,
  Loader2,
  Plus,
  Package,
  Layers,
  Sparkles,
  Warehouse,
} from 'lucide-react';

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

  // Calculate live profit margin for the Executive Metrics Strip
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

  const fieldLabelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    display: 'block',
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    height: 36,
    padding: '6px 12px',
    borderRadius: 4,
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    fontSize: 13,
    color: '#0f172a',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  };

  return (
    <div className="page-container">
      {/* 1. Top Header */}
      <div className="page-header" style={{ padding: '14px 28px' }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#0f172a' }}>
                Edit Item
              </h1>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  padding: '1px 8px',
                  borderRadius: 10,
                  background: formData.itemType === 'goods' ? '#f0f9ff' : '#faf5ff',
                  color: formData.itemType === 'goods' ? '#0284c7' : '#9333ea',
                  border: formData.itemType === 'goods' ? '1px solid #bae6fd' : '1px solid #e9d5ff',
                }}
              >
                {formData.itemType}
              </span>
            </div>
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
            {updateMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} strokeWidth={2.5} />
            )}
            {updateMutation.isPending ? 'Updating...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* 2. Executive Inline Metrics Strip (Matching ItemDetail UI 3 — Seamless, Zero Boxes) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          padding: '10px 28px',
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        {/* Metric 1: Selling Price */}
        <div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Selling Rate
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 1 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
              ₹
              {formData.isSalesInfo && formData.sellingPrice
                ? Number(formData.sellingPrice).toFixed(2)
                : '0.00'}
            </span>
            <span style={{ fontSize: 11.5, color: '#64748b' }}>/ {formData.unit || 'unit'}</span>
          </div>
        </div>

        <div style={{ width: 1, height: 24, background: '#cbd5e1' }} />

        {/* Metric 2: Cost Price */}
        <div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Purchase Rate
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 1 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
              ₹
              {formData.isPurchaseInfo && formData.costPrice
                ? Number(formData.costPrice).toFixed(2)
                : '0.00'}
            </span>
            <span style={{ fontSize: 11.5, color: '#64748b' }}>/ {formData.unit || 'unit'}</span>
          </div>
        </div>

        <div style={{ width: 1, height: 24, background: '#cbd5e1' }} />

        {/* Metric 3: Live Margin */}
        <div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <TrendingUp size={12} color="#0284c7" />
              Live Gross Margin
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 1 }}>
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: marginMetrics
                  ? marginMetrics.isProfitable
                    ? '#0284c7'
                    : '#dc2626'
                  : '#64748b',
              }}
            >
              {marginMetrics ? `₹${marginMetrics.margin.toFixed(2)}` : '—'}
            </span>
            {marginMetrics && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: marginMetrics.isProfitable ? '#0369a1' : '#dc2626',
                  background: marginMetrics.isProfitable ? '#f0f9ff' : '#fef2f2',
                  padding: '1px 6px',
                  borderRadius: 10,
                  border: marginMetrics.isProfitable ? '1px solid #bae6fd' : '1px solid #fecaca',
                }}
              >
                {marginMetrics.marginPercent.toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        <div style={{ width: 1, height: 24, background: '#cbd5e1' }} />

        {/* Metric 4: Inventory Tracking */}
        <div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Tracking Mode
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
            <Warehouse size={13} color="#64748b" />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
              {formData.itemType === 'goods' && formData.trackInventory
                ? formData.inventoryTracking === 'batch'
                  ? `${singular} Tracking`
                  : 'Standard Tracking'
                : 'Non-inventory'}
            </span>
          </div>
        </div>

        {formData.sku && (
          <>
            <div style={{ width: 1, height: 24, background: '#cbd5e1' }} />
            <div>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                SKU / Code
              </div>
              <div style={{ marginTop: 1 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    color: '#475569',
                  }}
                >
                  {formData.sku}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 3. Main Form Body — Seamless Layout Without Card Boxes */}
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
            gridTemplateColumns: 'minmax(0, 1.45fr) minmax(380px, 1fr)',
            gap: 48,
            alignItems: 'start',
            width: '100%',
            maxWidth: 1400,
            margin: '0 auto',
          }}
        >
          {/* LEFT: Primary Form Fields */}
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
                }}
              >
                General Information
              </div>

              {/* Type Switcher */}
              <div style={{ marginBottom: 18 }}>
                <label style={fieldLabelStyle}>Item Type</label>
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
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
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
                    <Package size={14} />
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
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
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
                    <Layers size={14} />
                    Service
                  </button>
                </div>
              </div>

              {/* Item Name */}
              <div style={{ marginBottom: 18 }}>
                <label style={fieldLabelStyle}>
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
                  <label style={fieldLabelStyle}>SKU / Item Code</label>
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
                  <label style={fieldLabelStyle}>Category</label>
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
                  <label style={fieldLabelStyle}>
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
                  <label style={fieldLabelStyle}>
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
                        <label style={fieldLabelStyle}>
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
                        <label style={fieldLabelStyle}>Sales Description</label>
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
                        <label style={fieldLabelStyle}>
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
                        <label style={fieldLabelStyle}>Purchase Description</label>
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
                          <label style={fieldLabelStyle}>Opening Stock Quantity</label>
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
                          <label style={fieldLabelStyle}>Value per Unit (₹)</label>
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

          {/* RIGHT: Media & Photos — Seamless Canvas, No Box Borders */}
          <div
            style={{
              position: 'sticky',
              top: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
          >
            {/* Item Images Section Header */}
            <div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#0f172a',
                  paddingBottom: 8,
                  marginBottom: 16,
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Sparkles size={15} color="#0284c7" />
                <span>Item Images</span>
              </div>

              {/* Real Item Images Gallery without outer card box */}
              {item && <ItemImageGallery orgId={orgId!} itemId={id!} item={item} />}
            </div>
          </div>
        </form>
      </div>

      {/* 4. Docked Page Footer */}
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
