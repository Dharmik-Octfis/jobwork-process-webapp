import { useState } from 'react';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Select } from '../../../components/ui/Select';
import { CategorySelectDropdown } from '../../items/components/CategorySelectDropdown';
import { compositeItemsApi } from './compositeItems.api';
import type { CreateCompositeItemDto } from './compositeItems.api';
import type { ItemFormData, Item } from '../../items/items.schemas';
import { itemFormSchema } from '../../items/items.schemas';
import { z } from 'zod';
import { CustomFieldsSection } from '../../custom-fields/CustomFieldsSection';
import { useUoms } from '../uom/uom.api';
import { UomFormModal } from '../uom/UomFormModal';
import { Plus, Trash2 } from 'lucide-react';
import { ItemComboBox } from '../../../components/ui/ItemComboBox';

import { MultiSelectItemModal } from '../../items/components/MultiSelectItemModal';

interface ComponentRow {
  componentItemId: string;
  qtyPerUnit: number;
  itemDetails?: Item;
}

interface CreateCompositeItemPageProps {
  isModal?: boolean;
  onSuccess?: (itemId: string) => void;
  onCancel?: () => void;
}

export function CreateCompositeItemPage({
  isModal = false,
  onSuccess,
  onCancel,
}: CreateCompositeItemPageProps = {}) {
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
        itemType: (itemToClone.itemType || 'goods') as 'goods' | 'service',
        category: itemToClone.category || '',
        hsnCode: itemToClone.hsnCode || '',
        itemStructure: 'composite',
        unit: itemToClone.unit || '',
        stockingUomId: itemToClone.stockingUomId ?? null,
        sku: itemToClone.sku || '',
        isSalesInfo: true,
        sellingPrice:
          itemToClone.sellingPrice !== null && itemToClone.sellingPrice !== undefined
            ? Number(itemToClone.sellingPrice)
            : (null as unknown as number),
        salesDescription: itemToClone.salesDescription || itemToClone.salesDescription || '',
        isPurchaseInfo: true,
        costPrice:
          itemToClone.costPrice !== null && itemToClone.costPrice !== undefined
            ? Number(itemToClone.costPrice)
            : (null as unknown as number),
        purchaseDescription:
          itemToClone.purchaseDescription || itemToClone.purchaseDescription || '',
        packaging: itemToClone.packaging || '',
        frontImage: itemToClone.frontImage || null,
        rearImage: itemToClone.rearImage || null,
        images: itemToClone.images || [],
        trackInventory: true,
        inventoryTracking: (itemToClone.inventoryTracking ?? 'none').toLowerCase(),
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
          itemToClone.customFields ||
          (itemToClone.customFields as unknown as Record<string, unknown>) ||
          null,
      };
    }
    return {
      name: '',
      itemType: 'goods',
      category: '',
      hsnCode: '',
      itemStructure: 'composite',
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
    };
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});

  const [components, setComponents] = useState<ComponentRow[]>([
    { componentItemId: '', qtyPerUnit: 1 },
  ]);

  const [isMultiSelectItemModalOpen, setIsMultiSelectItemModalOpen] = useState(false);
  const [multiSelectTargetIndex, setMultiSelectTargetIndex] = useState<number | null>(null);

  const [services, setServices] = useState<ComponentRow[]>([]);
  const [isMultiSelectServiceModalOpen, setIsMultiSelectServiceModalOpen] = useState(false);
  const [multiSelectServiceTargetIndex, setMultiSelectServiceTargetIndex] = useState<number | null>(
    null,
  );

  const handleAddService = () => {
    setServices((prev) => [...prev, { componentItemId: '', qtyPerUnit: 1 }]);
  };

  const handleRemoveService = (index: number) => {
    setServices((prev) => prev.filter((_, i) => i !== index));
  };

  const handleServiceChange = <K extends keyof ComponentRow>(
    index: number,
    field: K,
    value: ComponentRow[K],
    itemDetails?: Item | null,
  ) => {
    setServices((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (itemDetails !== undefined) {
        if (itemDetails === null) {
          delete updated[index].itemDetails;
        } else {
          updated[index].itemDetails = itemDetails;
        }
      }
      return updated;
    });
  };

  const handleAddComponent = () => {
    setComponents((prev) => [...prev, { componentItemId: '', qtyPerUnit: 1 }]);
  };

  const handleRemoveComponent = (index: number) => {
    setComponents((prev) => prev.filter((_, i) => i !== index));
  };

  const handleComponentChange = <K extends keyof ComponentRow>(
    index: number,
    field: K,
    value: ComponentRow[K],
    itemDetails?: Item | null,
  ) => {
    setComponents((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (itemDetails !== undefined) {
        if (itemDetails === null) {
          delete updated[index].itemDetails;
        } else {
          updated[index].itemDetails = itemDetails;
        }
      }
      return updated;
    });
  };

  const createMutation = useMutation({
    mutationFn: (data: ItemFormData) =>
      compositeItemsApi.createItem(orgId!, {
        ...data,
        components: [...components, ...services]
          .filter((c) => c.componentItemId && c.componentItemId.trim() !== '')
          .map((c) => ({
            componentItemId: c.componentItemId,
            qtyPerUnit: Number(c.qtyPerUnit) || 1,
          })),
      } as CreateCompositeItemDto),
    onSuccess: async (createdItem) => {
      queryClient.invalidateQueries({ queryKey: ['compositeItems', orgId] });
      const itemId = createdItem.id;

      if (isModal && onSuccess) {
        onSuccess(itemId);
      } else {
        navigate(`/organizations/${orgId}/composite-items`);
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

  const handleCopySellingPriceFromTotal = () => {
    let total = 0;
    components.forEach((c) => {
      const price = Number(c.itemDetails?.sellingPrice || 0);
      total += price * (c.qtyPerUnit || 1);
    });
    services.forEach((s) => {
      const price = Number(s.itemDetails?.sellingPrice || 0);
      total += price * (s.qtyPerUnit || 1);
    });
    setFormData((prev) => ({ ...prev, sellingPrice: total }));
  };

  const handleCopyCostPriceFromTotal = () => {
    let total = 0;
    components.forEach((c) => {
      const price = Number(c.itemDetails?.costPrice || 0);
      total += price * (c.qtyPerUnit || 1);
    });
    services.forEach((s) => {
      const price = Number(s.itemDetails?.costPrice || 0);
      total += price * (s.qtyPerUnit || 1);
    });
    setFormData((prev) => ({ ...prev, costPrice: total }));
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
      <style>{`
        .composite-item-row {
          transition: background-color 0.2s ease;
        }
        .composite-item-row:hover {
          background-color: #f1f5f9;
        }
        .composite-item-row .delete-btn {
          opacity: 0;
          transition: opacity 0.2s ease-in-out;
        }
        .composite-item-row:hover .delete-btn {
          opacity: 1;
        }
        .qty-input {
          border: 1px solid transparent;
          background-color: transparent;
          border-radius: 4px;
          transition: all 0.2s ease;
        }
        .qty-input:hover, .qty-input:focus {
          border-color: #d1d5db;
          background-color: #ffffff;
        }
      `}</style>
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
            color: '#1e293b',
          }}
        >
          New Composite Item
        </h1>
      </div>

      <div>
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
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
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
                <div />
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    cursor: 'pointer',
                    color: '#4b5563',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!formData.customFields?.returnableItem}
                    onChange={(e) => {
                      setFormData((prev) => ({
                        ...prev,
                        customFields: {
                          ...prev.customFields,
                          returnableItem: e.target.checked,
                        },
                      }));
                    }}
                  />
                  Returnable Item
                </label>
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* Associate Items */}
            <div
              style={{
                background: '#f8fafc',
                padding: '24px 48px 24px 24px',
                borderRadius: services.length > 0 ? '8px 8px 0 0' : '8px',
                border: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                maxWidth: '850px',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: '#ef4444' }}>
                Associate Items*
              </div>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  border: '1px solid #cbd5e1',
                  marginTop: '8px',
                }}
              >
                <thead style={{ background: '#f8fafc' }}>
                  <tr>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '12px',
                        fontSize: 12,
                        fontWeight: 500,
                        color: '#64748b',
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      Item Details
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '12px',
                        fontSize: 12,
                        fontWeight: 500,
                        color: '#64748b',
                        border: '1px solid #cbd5e1',
                        width: '100px',
                      }}
                    >
                      Quantity
                    </th>
                    <th
                      style={{
                        textAlign: 'right',
                        padding: '12px',
                        fontSize: 12,
                        fontWeight: 500,
                        color: '#64748b',
                        border: '1px solid #cbd5e1',
                        width: '120px',
                      }}
                    >
                      Selling Price
                    </th>
                    <th
                      style={{
                        textAlign: 'right',
                        padding: '12px',
                        fontSize: 12,
                        fontWeight: 500,
                        color: '#64748b',
                        border: '1px solid #cbd5e1',
                        width: '120px',
                      }}
                    >
                      Cost Price
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((comp, idx) => (
                    <tr key={idx} className="composite-item-row">
                      <td style={{ padding: '12px', border: '1px solid #cbd5e1' }}>
                        <ItemComboBox
                          orgId={orgId!}
                          value={comp.componentItemId || ''}
                          initialItem={comp.itemDetails}
                          onChange={(item) =>
                            handleComponentChange(
                              idx,
                              'componentItemId',
                              item?.id || '',
                              item ?? null,
                            )
                          }
                          onOpenMultiSelect={() => {
                            setMultiSelectTargetIndex(idx);
                            setIsMultiSelectItemModalOpen(true);
                          }}
                          hasError={!comp.componentItemId && Object.keys(errors).length > 0}
                        />
                        {comp.itemDetails?.sku && (
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                            SKU: {comp.itemDetails.sku}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px', border: '1px solid #cbd5e1' }}>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={comp.qtyPerUnit || ''}
                          onChange={(e) =>
                            handleComponentChange(
                              idx,
                              'qtyPerUnit',
                              parseFloat(e.target.value) || 0,
                            )
                          }
                          className="qty-input"
                          style={{
                            width: '100%',
                            height: '34px',
                            padding: '6px',
                            textAlign: 'right',
                            fontSize: 14,
                            fontWeight: 500,
                            color: '#1e293b',
                            outline: 'none',
                          }}
                        />
                        <div
                          style={{
                            fontSize: 11,
                            color: '#64748b',
                            marginTop: 4,
                            textAlign: 'right',
                          }}
                        >
                          ₹{Number(comp.itemDetails?.sellingPrice ?? 0).toFixed(2)} per unit
                        </div>
                      </td>
                      <td
                        style={{
                          padding: '12px',
                          border: '1px solid #cbd5e1',
                          textAlign: 'right',
                          fontSize: 12,
                        }}
                      >
                        {(
                          Number(comp.itemDetails?.sellingPrice ?? 0) * (comp.qtyPerUnit || 0)
                        ).toFixed(2)}
                      </td>
                      <td
                        style={{
                          position: 'relative',
                          padding: '12px',
                          border: '1px solid #cbd5e1',
                          textAlign: 'right',
                          fontSize: 12,
                        }}
                      >
                        {(
                          Number(comp.itemDetails?.costPrice ?? 0) * (comp.qtyPerUnit || 0)
                        ).toFixed(2)}
                        <button
                          type="button"
                          className="delete-btn"
                          onClick={() => handleRemoveComponent(idx)}
                          style={{
                            position: 'absolute',
                            left: '100%',
                            marginLeft: '12px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            color: '#ef4444',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot
                  style={{
                    background: '#f8fafc',
                    borderTop: '1px solid #cbd5e1',
                    border: '1px solid #cbd5e1',
                  }}
                >
                  <tr>
                    <td
                      colSpan={2}
                      style={{
                        padding: '12px',
                        textAlign: 'right',
                        fontSize: 13,
                        color: '#64748b',
                        fontWeight: 500,
                      }}
                    >
                      Total (₹)
                    </td>
                    <td
                      style={{ padding: '12px', textAlign: 'right', fontSize: 13, fontWeight: 600 }}
                    >
                      {components
                        .reduce(
                          (sum, c) =>
                            sum + Number(c.itemDetails?.sellingPrice ?? 0) * (c.qtyPerUnit || 0),
                          0,
                        )
                        .toFixed(2)}
                    </td>
                    <td
                      style={{ padding: '12px', textAlign: 'right', fontSize: 13, fontWeight: 600 }}
                    >
                      {components
                        .reduce(
                          (sum, c) =>
                            sum + Number(c.itemDetails?.costPrice ?? 0) * (c.qtyPerUnit || 0),
                          0,
                        )
                        .toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={handleAddComponent}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#0062ff',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  <Plus size={14} /> Add New Row
                </button>
                <button
                  type="button"
                  onClick={handleAddService}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#0062ff',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  <Plus size={14} /> Add Services
                </button>
              </div>
            </div>

            {/* Associate Services */}
            {services.length > 0 && (
              <div
                style={{
                  background: '#f8fafc',
                  padding: '16px 48px 16px 16px',
                  borderRadius: '0 0 8px 8px',
                  border: '1px solid #e2e8f0',
                  borderTop: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  maxWidth: '850px',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: '#ef4444' }}>
                  Associate Services*
                </div>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    border: '1px solid #cbd5e1',
                    marginTop: '8px',
                  }}
                >
                  <thead style={{ background: '#f8fafc' }}>
                    <tr>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '12px',
                          fontSize: 12,
                          fontWeight: 500,
                          color: '#64748b',
                          border: '1px solid #cbd5e1',
                        }}
                      >
                        Service Details
                      </th>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '12px',
                          fontSize: 12,
                          fontWeight: 500,
                          color: '#64748b',
                          border: '1px solid #cbd5e1',
                          width: '100px',
                        }}
                      >
                        Quantity
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '12px',
                          fontSize: 12,
                          fontWeight: 500,
                          color: '#64748b',
                          border: '1px solid #cbd5e1',
                          width: '120px',
                        }}
                      >
                        Selling Price
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '12px',
                          fontSize: 12,
                          fontWeight: 500,
                          color: '#64748b',
                          border: '1px solid #cbd5e1',
                          width: '120px',
                        }}
                      >
                        Cost Price
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((svc, idx) => (
                      <tr key={idx} className="composite-item-row">
                        <td style={{ padding: '12px', border: '1px solid #cbd5e1' }}>
                          <ItemComboBox
                            orgId={orgId!}
                            filter="services"
                            value={svc.componentItemId || ''}
                            initialItem={svc.itemDetails}
                            onChange={(item) =>
                              handleServiceChange(
                                idx,
                                'componentItemId',
                                item?.id || '',
                                item ?? null,
                              )
                            }
                            onOpenMultiSelect={() => {
                              setMultiSelectServiceTargetIndex(idx);
                              setIsMultiSelectServiceModalOpen(true);
                            }}
                            hasError={!svc.componentItemId && Object.keys(errors).length > 0}
                          />
                          {svc.itemDetails?.sku && (
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                              SKU: {svc.itemDetails.sku}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px', border: '1px solid #cbd5e1' }}>
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={svc.qtyPerUnit || ''}
                            onChange={(e) =>
                              handleServiceChange(
                                idx,
                                'qtyPerUnit',
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="qty-input"
                            style={{
                              width: '100%',
                              height: '34px',
                              padding: '6px',
                              textAlign: 'right',
                              fontSize: 14,
                              fontWeight: 500,
                              color: '#1e293b',
                              outline: 'none',
                            }}
                          />
                          <div
                            style={{
                              fontSize: 11,
                              color: '#64748b',
                              marginTop: 4,
                              textAlign: 'right',
                            }}
                          >
                            ₹{Number(svc.itemDetails?.sellingPrice ?? 0).toFixed(2)} per unit
                          </div>
                        </td>
                        <td
                          style={{
                            padding: '12px',
                            border: '1px solid #cbd5e1',
                            textAlign: 'right',
                            fontSize: 12,
                          }}
                        >
                          {(
                            Number(svc.itemDetails?.sellingPrice ?? 0) * (svc.qtyPerUnit || 0)
                          ).toFixed(2)}
                        </td>
                        <td
                          style={{
                            position: 'relative',
                            padding: '12px',
                            border: '1px solid #cbd5e1',
                            textAlign: 'right',
                            fontSize: 12,
                          }}
                        >
                          {(
                            Number(svc.itemDetails?.costPrice ?? 0) * (svc.qtyPerUnit || 0)
                          ).toFixed(2)}
                          <button
                            type="button"
                            className="delete-btn"
                            onClick={() => handleRemoveService(idx)}
                            style={{
                              position: 'absolute',
                              left: '100%',
                              marginLeft: '12px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              color: '#ef4444',
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot
                    style={{
                      background: '#f8fafc',
                      borderTop: '1px solid #cbd5e1',
                      border: '1px solid #cbd5e1',
                    }}
                  >
                    <tr>
                      <td
                        colSpan={2}
                        style={{
                          padding: '12px',
                          textAlign: 'right',
                          fontSize: 13,
                          color: '#64748b',
                          fontWeight: 500,
                        }}
                      >
                        Total (₹)
                      </td>
                      <td
                        style={{
                          padding: '12px',
                          textAlign: 'right',
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        {services
                          .reduce(
                            (sum, svc) =>
                              sum +
                              Number(svc.itemDetails?.sellingPrice ?? 0) * (svc.qtyPerUnit || 0),
                            0,
                          )
                          .toFixed(2)}
                      </td>
                      <td
                        style={{
                          padding: '12px',
                          textAlign: 'right',
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        {services
                          .reduce(
                            (sum, svc) =>
                              sum + Number(svc.itemDetails?.costPrice ?? 0) * (svc.qtyPerUnit || 0),
                            0,
                          )
                          .toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
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
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
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
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '130px 1fr',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <label
                      style={{
                        fontSize: 12,
                        color: formData.isSalesInfo ? '#ef4444' : '#000',
                        fontWeight: 500,
                      }}
                    >
                      Selling Price<span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>
                    </label>
                    <div style={{ position: 'relative', width: '100%' }}>
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
                          padding: '6px 110px 6px 10px',
                          borderRadius: '4px',
                          border: errors.sellingPrice ? '1px solid #ef4444' : '1px solid #d1d5db',
                          fontSize: 12,
                          backgroundColor: formData.isSalesInfo ? '#fff' : '#f1f5f9',
                          color: formData.isSalesInfo ? '#000' : '#94a3b8',
                          cursor: formData.isSalesInfo ? 'text' : 'not-allowed',
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleCopySellingPriceFromTotal}
                        disabled={!formData.isSalesInfo}
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: formData.isSalesInfo ? '#0062ff' : '#94a3b8',
                          fontSize: 12,
                          cursor: formData.isSalesInfo ? 'pointer' : 'not-allowed',
                          padding: 0,
                        }}
                      >
                        Copy from total
                      </button>
                    </div>
                    {errors.sellingPrice && (
                      <span
                        style={{ color: '#ef4444', fontSize: 12, marginTop: 4, display: 'block' }}
                      >
                        {errors.sellingPrice}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '130px 1fr',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>MRP</label>
                    <input
                      type="number"
                      step="0.01"
                      value={(formData.customFields?.mrp as string) || ''}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          customFields: {
                            ...prev.customFields,
                            mrp: parseFloat(e.target.value) || '',
                          },
                        }))
                      }
                      disabled={!formData.isSalesInfo}
                      style={{
                        width: '100%',
                        height: '34px',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        border: '1px solid #d1d5db',
                        fontSize: 12,
                        backgroundColor: formData.isSalesInfo ? '#fff' : '#f1f5f9',
                        color: formData.isSalesInfo ? '#000' : '#94a3b8',
                        cursor: formData.isSalesInfo ? 'text' : 'not-allowed',
                      }}
                    />
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '130px 1fr',
                      alignItems: 'flex-start',
                      gap: 12,
                    }}
                  >
                    <label
                      style={{ fontSize: 12, color: '#4b5563', fontWeight: 500, paddingTop: '8px' }}
                    >
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
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
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
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '130px 1fr',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <label
                      style={{
                        fontSize: 12,
                        color: formData.isPurchaseInfo ? '#ef4444' : '#000',
                        fontWeight: 500,
                      }}
                    >
                      Cost Price<span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>
                    </label>
                    <div style={{ position: 'relative', width: '100%' }}>
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
                          padding: '6px 110px 6px 10px',
                          borderRadius: '4px',
                          border: errors.costPrice ? '1px solid #ef4444' : '1px solid #d1d5db',
                          fontSize: 12,
                          backgroundColor: formData.isPurchaseInfo ? '#fff' : '#f1f5f9',
                          color: formData.isPurchaseInfo ? '#000' : '#94a3b8',
                          cursor: formData.isPurchaseInfo ? 'text' : 'not-allowed',
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleCopyCostPriceFromTotal}
                        disabled={!formData.isPurchaseInfo}
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: formData.isPurchaseInfo ? '#0062ff' : '#94a3b8',
                          fontSize: 12,
                          cursor: formData.isPurchaseInfo ? 'pointer' : 'not-allowed',
                          padding: 0,
                        }}
                      >
                        Copy from total
                      </button>
                    </div>
                    {errors.costPrice && (
                      <span
                        style={{ color: '#ef4444', fontSize: 12, marginTop: 4, display: 'block' }}
                      >
                        {errors.costPrice}
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '130px 1fr',
                      alignItems: 'flex-start',
                      gap: 12,
                    }}
                  >
                    <label
                      style={{ fontSize: 12, color: '#4b5563', fontWeight: 500, paddingTop: '8px' }}
                    >
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                Additional Information
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  color: '#1e293b',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={!!formData.customFields?.trackBinLocation}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      customFields: { ...prev.customFields, trackBinLocation: e.target.checked },
                    }))
                  }
                />
                Track Bin location for this item
              </label>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                marginTop: '16px',
                paddingTop: '16px',
                borderTop: '1px solid #e2e8f0',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                Advanced Inventory Tracking
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
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
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
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
                  Track Batches
                </label>
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
                isModal && onCancel
                  ? onCancel()
                  : navigate(`/organizations/${orgId}/composite-items`)
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

      <MultiSelectItemModal
        isOpen={isMultiSelectItemModalOpen}
        onClose={() => {
          setIsMultiSelectItemModalOpen(false);
          setMultiSelectTargetIndex(null);
        }}
        orgId={orgId!}
        onAssign={(selectedItems) => {
          if (selectedItems.length === 0 || multiSelectTargetIndex === null) return;

          setComponents((prev) => {
            const newComponents = [...prev];
            const targetIndex = multiSelectTargetIndex;

            selectedItems.forEach((item, i) => {
              const isFirst = i === 0;
              const targetRow = newComponents[targetIndex];
              const isEmptyRow = !targetRow?.componentItemId;

              const qty = Number(item._quantity) || 1;

              if (isFirst && isEmptyRow) {
                newComponents[targetIndex] = {
                  ...targetRow,
                  componentItemId: item.id,
                  itemDetails: item,
                  qtyPerUnit: qty,
                };
              } else {
                newComponents.push({
                  componentItemId: item.id,
                  itemDetails: item,
                  qtyPerUnit: qty,
                });
              }
            });
            return newComponents;
          });

          setIsMultiSelectItemModalOpen(false);
          setMultiSelectTargetIndex(null);
        }}
      />

      <MultiSelectItemModal
        isOpen={isMultiSelectServiceModalOpen}
        onClose={() => {
          setIsMultiSelectServiceModalOpen(false);
          setMultiSelectServiceTargetIndex(null);
        }}
        orgId={orgId!}
        filter="services"
        onAssign={(selectedItems) => {
          if (selectedItems.length === 0 || multiSelectServiceTargetIndex === null) return;

          setServices((prev) => {
            const newServices = [...prev];
            const targetIndex = multiSelectServiceTargetIndex;

            selectedItems.forEach((item, i) => {
              const isFirst = i === 0;
              const targetRow = newServices[targetIndex];
              const isEmptyRow = !targetRow?.componentItemId;

              const qty = Number(item._quantity) || 1;

              if (isFirst && isEmptyRow) {
                newServices[targetIndex] = {
                  ...targetRow,
                  componentItemId: item.id,
                  itemDetails: item,
                  qtyPerUnit: qty,
                };
              } else {
                newServices.push({
                  componentItemId: item.id,
                  itemDetails: item,
                  qtyPerUnit: qty,
                });
              }
            });
            return newServices;
          });

          setIsMultiSelectServiceModalOpen(false);
          setMultiSelectServiceTargetIndex(null);
        }}
      />

      <UomFormModal
        orgId={orgId!}
        isOpen={isUomModalOpen}
        onClose={() => setIsUomModalOpen(false)}
      />
    </div>
  );
}
