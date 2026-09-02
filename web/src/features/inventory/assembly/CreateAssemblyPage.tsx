import React, { useState, useRef, useMemo } from 'react';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Settings, Info, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import { useForm, Controller, useWatch, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'react-hot-toast';

import { DateInput } from '../../../components/ui/DateInput';
import { Input } from '../../../components/ui/Input';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { Select } from '../../../components/ui/Select';
import { ItemComboBox } from '../../../components/ui/ItemComboBox';
import { assembliesApi, createAssemblySchema, type CreateAssemblyDto } from './assemblies.api';
import { compositeItemsApi } from '../composite-items/compositeItems.api';
import { fetchLocations } from '../../configuration/locations/locations.api';
import { AssemblyNumberConfigModal } from './AssemblyNumberConfigModal';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function CreateAssemblyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams] = useSearchParams();
  const defaultItemId = searchParams.get('itemId');
  const queryClient = useQueryClient();

  const form = useForm<CreateAssemblyDto>({
    resolver: zodResolver(createAssemblySchema),
    defaultValues: {
      compositeItemId: defaultItemId || '',
      assemblyNumber: '',
      remarks: '',
      assemblyDate: new Date().toISOString().split('T')[0],
      qty: 1,
      locationId: '',
      projectId: '',
      lines: [],
    },
  });

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = form;
  const compositeItemId = useWatch({ control, name: 'compositeItemId' });
  const qty = useWatch({ control, name: 'qty' });

  const { data: compositeItemsResponse } = useQuery({
    queryKey: ['compositeItems', orgId],
    queryFn: () => compositeItemsApi.getItems(orgId!),
    enabled: !!orgId,
  });
  const compositeItems = compositeItemsResponse?.results || [];

  const { data: locations } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: !!orgId,
  });

  const { data: components, isLoading: componentsLoading } = useQuery({
    queryKey: ['compositeComponents', orgId, compositeItemId],
    queryFn: () => compositeItemsApi.getComponents(orgId!, compositeItemId),
    enabled: !!orgId && !!compositeItemId,
  });

  const [isNumberConfigOpen, setIsNumberConfigOpen] = useState(false);
  const lastPrefilledNumberRef = useRef('');

  const { data: preference } = useQuery({
    queryKey: ['assembly-number-preference', orgId],
    queryFn: () => assembliesApi.getNumberPreference(orgId!),
    enabled: !!orgId,
  });

  const currentAssemblyNumber = useWatch({ control, name: 'assemblyNumber' });

  useEffect(() => {
    if (preference) {
      const generatedNumber = `${preference.prefix}${preference.nextNumber.toString().padStart(5, '0')}`;

      if (!currentAssemblyNumber || currentAssemblyNumber === lastPrefilledNumberRef.current) {
        form.setValue('assemblyNumber', generatedNumber, { shouldValidate: true });
        lastPrefilledNumberRef.current = generatedNumber;
      }
    }
  }, [preference, currentAssemblyNumber, form]);

  const updatePreferenceMutation = useMutation({
    mutationFn: (data: { prefix: string; nextNumber: number }) =>
      assembliesApi.updateNumberPreference(orgId!, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['assembly-number-preference', orgId], data);
      form.setValue(
        'assemblyNumber',
        `${data.prefix}${data.nextNumber.toString().padStart(5, '0')}`,
        { shouldValidate: true },
      );
      setIsNumberConfigOpen(false);
    },
  });

  const [services, setServices] = useState<
    { itemId: string; qtyRequired: number; costPrice?: number }[]
  >([]);
  const [extraItems, setExtraItems] = useState<
    { itemId: string; qtyRequired: number; costPrice?: number }[]
  >([]);
  const [overrides, setOverrides] = useState<
    Record<string, { type: 'perUnit' | 'total'; value: string }>
  >({});

  const goodsComponents = useMemo(() => {
    return components?.filter((c) => c.component?.type?.toLowerCase() !== 'service') || [];
  }, [components]);

  const serviceComponents = useMemo(() => {
    return components?.filter((c) => c.component?.type?.toLowerCase() === 'service') || [];
  }, [components]);

  const handleAddExtraItem = () => {
    setExtraItems((prev) => [...prev, { itemId: '', qtyRequired: 1 }]);
  };

  const handleRemoveExtraItem = (index: number) => {
    setExtraItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleExtraItemChange = <
    K extends keyof { itemId: string; qtyRequired: number; costPrice?: number },
  >(
    index: number,
    field: K,
    value: { itemId: string; qtyRequired: number; costPrice?: number }[K],
  ) => {
    setExtraItems((prev) => {
      const newItems = [...prev];
      newItems[index] = { ...newItems[index], [field]: value };
      return newItems;
    });
  };

  const handleAddService = () => {
    setServices((prev) => [...prev, { itemId: '', qtyRequired: 1 }]);
  };

  const handleRemoveService = (index: number) => {
    setServices((prev) => prev.filter((_, i) => i !== index));
  };

  const handleServiceChange = <
    K extends keyof { itemId: string; qtyRequired: number; costPrice?: number },
  >(
    index: number,
    field: K,
    value: { itemId: string; qtyRequired: number; costPrice?: number }[K],
  ) => {
    setServices((prev) => {
      const newServices = [...prev];
      newServices[index] = { ...newServices[index], [field]: value };
      return newServices;
    });
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateAssemblyDto) => assembliesApi.createAssembly({ orgId: orgId!, data }),
    meta: { suppressToast: true },
    onSuccess: (resData) => {
      queryClient.invalidateQueries({ queryKey: ['assembly-number-preference', orgId] });
      navigate(`/organizations/${orgId}/inventory/assembly?id=${resData.id}`);
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(
        err.response?.data?.message ||
          (error instanceof Error ? error.message : 'Failed to create assembly'),
      );
    },
  });

  const onSubmit = (data: CreateAssemblyDto) => {
    // Generate lines dynamically from fetched components
    const lines = (components || []).map((comp) => {
      const override = overrides[comp.id];
      let finalQtyRequired = Number(comp.qtyPerUnit) * Number(data.qty);
      if (override) {
        if (override.type === 'total') {
          finalQtyRequired = parseFloat(override.value) || 0;
        } else {
          finalQtyRequired = (parseFloat(override.value) || 0) * Number(data.qty);
        }
      }

      return {
        itemId: comp.componentItemId,
        qtyRequired: finalQtyRequired,
      };
    });

    const validServices = services.filter((s) => s.itemId);
    const validExtraItems = extraItems.filter((i) => i.itemId);
    const combinedLines = [...lines, ...validExtraItems, ...validServices];

    if (combinedLines.length === 0) {
      toast.error('Composite item has no components and no additional items/services selected.');
      return;
    }

    createMutation.mutate({
      ...data,
      lines: combinedLines,
    });
  };

  const onValidationError = (formErrors: FieldErrors<CreateAssemblyDto>) => {
    console.error('Form validation errors:', formErrors);
    toast.error('Please check the highlighted mandatory fields.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      {/* Header */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid #eef0f3',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <PackageIcon />
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#1e293b' }}>
          New Assembly
        </h1>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <form
          id="create-assembly-form"
          onSubmit={handleSubmit(onSubmit, onValidationError)}
          style={{ maxWidth: '900px' }}
        >
          {/* Header Form */}
          <div className="form-field-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '200px 1fr',
              gap: '24px',
              alignItems: 'start',
              marginBottom: '40px',
            }}
          >
            <div style={{ fontSize: '13px', color: '#dc2626', fontWeight: 500, paddingTop: '8px' }}>
              Composite Item*
            </div>
            <div style={{ maxWidth: '400px' }}>
              <Controller
                name="compositeItemId"
                control={control}
                render={({ field }) => (
                  <SearchableSelect
                    value={field.value}
                    onChange={field.onChange}
                    options={(compositeItems || []).map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                    placeholder="Select or type to add"
                    hasError={!!errors.compositeItemId}
                  />
                )}
              />
              {errors.compositeItemId && (
                <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>
                  {errors.compositeItemId.message}
                </div>
              )}
              {compositeItemId && (
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  SKU: {compositeItems?.find((i) => i.id === compositeItemId)?.sku || '-'}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              transition: 'all 0.3s ease',
              opacity: compositeItemId ? 1 : 0.4,
              filter: compositeItemId ? 'none' : 'blur(0.5px)',
              pointerEvents: compositeItemId ? 'auto' : 'none',
              userSelect: compositeItemId ? 'auto' : 'none',
            }}
          >
            <div className="form-field-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: '200px 1fr',
                gap: '24px',
                alignItems: 'start',
                marginBottom: '40px',
              }}
            >
              <div
                style={{ fontSize: '13px', color: '#dc2626', fontWeight: 500, paddingTop: '8px' }}
              >
                Assembly#*
              </div>
              <div style={{ maxWidth: '400px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    overflow: 'hidden',
                  }}
                >
                  <input
                    type="text"
                    {...form.register('assemblyNumber')}
                    style={{
                      flex: 1,
                      border: 'none',
                      padding: '8px 12px',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                    placeholder="Auto Generated"
                  />
                  <button
                    type="button"
                    onClick={() => setIsNumberConfigOpen(true)}
                    style={{
                      background: '#f8fafc',
                      border: 'none',
                      borderLeft: '1px solid #d1d5db',
                      padding: '8px 12px',
                      cursor: 'pointer',
                    }}
                  >
                    <Settings size={14} color="#0062ff" />
                  </button>
                </div>
                {errors.assemblyNumber && (
                  <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>
                    {errors.assemblyNumber.message}
                  </div>
                )}
              </div>

              <div style={{ fontSize: '13px', color: '#1e293b', paddingTop: '8px' }}>
                Description
              </div>
              <div style={{ maxWidth: '400px' }}>
                <textarea
                  {...form.register('remarks')}
                  rows={3}
                  style={{
                    width: '100%',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    padding: '8px 12px',
                    fontSize: '13px',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div
                style={{ fontSize: '13px', color: '#dc2626', fontWeight: 500, paddingTop: '8px' }}
              >
                Assembled Date*
              </div>
              <div style={{ maxWidth: '400px' }}>
                <Controller
                  name="assemblyDate"
                  control={control}
                  render={({ field }) => (
                    <DateInput
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      ariaLabel="Assembled date"
                      hasError={Boolean(errors.assemblyDate)}
                    />
                  )}
                />
                {errors.assemblyDate && (
                  <div style={{ color: '#e54d4d', fontSize: '12px', marginTop: '4px' }}>
                    {errors.assemblyDate.message}
                  </div>
                )}
              </div>

              <div
                style={{ fontSize: '13px', color: '#dc2626', fontWeight: 500, paddingTop: '8px' }}
              >
                Quantity to Assemble*
              </div>
              <div style={{ maxWidth: '400px' }}>
                <Input
                  type="number"
                  min="1"
                  step="any"
                  label=""
                  error={errors.qty?.message}
                  {...form.register('qty', { valueAsNumber: true })}
                />
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                  You can Assemble <strong style={{ color: '#1e293b' }}>0</strong> unit from the
                  available stock.
                </div>
              </div>

              <div
                style={{ fontSize: '13px', color: '#dc2626', fontWeight: 500, paddingTop: '8px' }}
              >
                Location*
              </div>
              <div style={{ maxWidth: '400px' }}>
                <Controller
                  name="locationId"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onChange={field.onChange}
                      options={(locations || []).map((l) => ({ value: l.id, label: l.name }))}
                      placeholder="Add Location"
                      hasError={!!errors.locationId}
                    />
                  )}
                />
                {errors.locationId && (
                  <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>
                    {errors.locationId.message}
                  </div>
                )}
              </div>

              <div style={{ fontSize: '13px', color: '#1e293b', paddingTop: '8px' }}>Project</div>
              <div style={{ maxWidth: '400px' }}>
                <Select options={[]} placeholder="Select a project" value="" onChange={() => {}} />
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #eef0f3', margin: '40px 0' }} />

            {/* Associated Items */}
            <div style={{ marginBottom: '16px' }}>
              <div
                style={{
                  fontSize: '13px',
                  color: '#dc2626',
                  fontWeight: 500,
                  marginBottom: '16px',
                }}
              >
                Associated Items*
              </div>

              <div
                style={{
                  background: '#eff6ff',
                  padding: '12px 16px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  marginBottom: '24px',
                  fontSize: '13px',
                  color: '#1e40af',
                }}
              >
                <Info size={16} style={{ marginTop: '2px', flexShrink: 0 }} />
                <div>
                  If you've incurred an addition cost while assembling this item such as rent,
                  labour, or scrap; you can <strong>add it as a service item</strong> to associate
                  that cost to the item.
                </div>
              </div>

              <div className="responsive-table-wrapper">
                    <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  border: '1px solid #d1d5db',
                  fontSize: '13px',
                }}
              >
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #d1d5db' }}>
                    <th
                      style={{
                        padding: '12px 16px',
                        textAlign: 'left',
                        fontWeight: 500,
                        color: '#475569',
                        borderRight: '1px solid #d1d5db',
                      }}
                    >
                      Item Details
                    </th>
                    <th
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        fontWeight: 500,
                        color: '#475569',
                        borderRight: '1px solid #d1d5db',
                        width: '160px',
                      }}
                    >
                      Quantity Required
                    </th>
                    <th
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        fontWeight: 500,
                        color: '#475569',
                        borderRight: '1px solid #d1d5db',
                        width: '140px',
                      }}
                    >
                      Total Qty required
                    </th>
                    <th
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        fontWeight: 500,
                        color: '#475569',
                        width: '140px',
                      }}
                    >
                      Quantity Available
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {componentsLoading ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}
                      >
                        Loading components...
                      </td>
                    </tr>
                  ) : !goodsComponents || goodsComponents.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}
                      >
                        Select a composite item to view components.
                      </td>
                    </tr>
                  ) : (
                    goodsComponents.map((comp) => {
                      const override = overrides[comp.id];
                      const baseQty = Number(qty) || 1;

                      let requiredPerUnitStr: string | number = Number(comp.qtyPerUnit);
                      let totalRequiredStr: string | number = requiredPerUnitStr * baseQty;

                      if (override) {
                        if (override.type === 'perUnit') {
                          requiredPerUnitStr = override.value;
                          totalRequiredStr = (parseFloat(override.value) || 0) * baseQty;
                        } else {
                          totalRequiredStr = override.value;
                          // Optional: recalculate perUnit based on total, or just let it be.
                          // It's usually better to just show the recalculated value.
                          requiredPerUnitStr = (parseFloat(override.value) || 0) / baseQty;
                        }
                      }

                      return (
                        <React.Fragment key={comp.id}>
                          <tr style={{ borderBottom: '1px solid #eef0f3' }}>
                            <td style={{ padding: '16px', borderRight: '1px solid #eef0f3' }}>
                              <div
                                style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}
                              >
                                <div
                                  style={{
                                    width: '40px',
                                    height: '40px',
                                    background: '#f1f5f9',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '4px',
                                    border: '1px solid #eef0f3',
                                  }}
                                >
                                  <ImageIcon size={20} color="#94a3b8" />
                                </div>
                                <div>
                                  <div style={{ fontWeight: 500, color: '#1e293b' }}>
                                    {comp.component?.name}
                                  </div>
                                  <div
                                    style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}
                                  >
                                    SKU: {comp.component?.sku || '-'}
                                  </div>
                                </div>
                              </div>
                              <div style={{ marginTop: '16px' }}>
                                <input
                                  type="text"
                                  placeholder="Add a description to your item"
                                  style={{
                                    width: '100%',
                                    border: 'none',
                                    background: 'transparent',
                                    outline: 'none',
                                    fontSize: '13px',
                                    color: '#475569',
                                  }}
                                />
                              </div>
                            </td>
                            <td
                              style={{
                                padding: '16px',
                                textAlign: 'right',
                                borderRight: '1px solid #eef0f3',
                                verticalAlign: 'top',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'flex-end',
                                  gap: '4px',
                                }}
                              >
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  value={requiredPerUnitStr}
                                  onChange={(e) => {
                                    setOverrides((prev) => ({
                                      ...prev,
                                      [comp.id]: { type: 'perUnit', value: e.target.value },
                                    }));
                                  }}
                                  style={{
                                    width: '80px',
                                    padding: '6px',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '4px',
                                    outline: 'none',
                                    textAlign: 'right',
                                  }}
                                />
                                <div style={{ fontSize: '11px', color: '#64748b' }}>
                                  x {qty || 1} assemblies
                                </div>
                              </div>
                            </td>
                            <td
                              style={{
                                padding: '16px',
                                textAlign: 'right',
                                borderRight: '1px solid #eef0f3',
                                verticalAlign: 'top',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'flex-end',
                                }}
                              >
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  value={totalRequiredStr}
                                  onChange={(e) => {
                                    setOverrides((prev) => ({
                                      ...prev,
                                      [comp.id]: { type: 'total', value: e.target.value },
                                    }));
                                  }}
                                  style={{
                                    width: '90px',
                                    padding: '6px',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '4px',
                                    outline: 'none',
                                    textAlign: 'right',
                                    fontWeight: 500,
                                    color: '#1e293b',
                                  }}
                                />
                                {Number(totalRequiredStr) > (comp.component?.stockOnHand || 0) && (
                                  <div
                                    style={{
                                      marginTop: '6px',
                                      color: '#ef4444',
                                      fontSize: '14px',
                                      display: 'flex',
                                      justifyContent: 'center',
                                      width: '90px', // aligns with input width
                                      position: 'relative',
                                      cursor: 'pointer',
                                    }}
                                    onMouseEnter={(e) => {
                                      const tooltip = e.currentTarget.querySelector(
                                        '.warning-tooltip',
                                      ) as HTMLElement;
                                      if (tooltip) {
                                        tooltip.style.visibility = 'visible';
                                        tooltip.style.opacity = '1';
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      const tooltip = e.currentTarget.querySelector(
                                        '.warning-tooltip',
                                      ) as HTMLElement;
                                      if (tooltip) {
                                        tooltip.style.visibility = 'hidden';
                                        tooltip.style.opacity = '0';
                                      }
                                    }}
                                  >
                                    ⚠️
                                    <div
                                      className="warning-tooltip"
                                      style={{
                                        visibility: 'hidden',
                                        opacity: 0,
                                        transition: 'opacity 0.2s, visibility 0.2s',
                                        position: 'absolute',
                                        bottom: '100%',
                                        left: '50%',
                                        transform: 'translateX(-50%)',
                                        marginBottom: '8px',
                                        width: 'max-content',
                                        maxWidth: '250px',
                                        backgroundColor: '#1e293b',
                                        color: '#fff',
                                        textAlign: 'center',
                                        padding: '8px 12px',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        fontWeight: 400,
                                        zIndex: 50,
                                        boxShadow:
                                          '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                                        lineHeight: 1.4,
                                      }}
                                    >
                                      The available stock for this item is less than the total
                                      quantity required for this assembly.
                                      <div
                                        style={{
                                          content: '""',
                                          position: 'absolute',
                                          top: '100%',
                                          left: '50%',
                                          marginLeft: '-5px',
                                          borderWidth: '5px',
                                          borderStyle: 'solid',
                                          borderColor:
                                            '#1e293b transparent transparent transparent',
                                        }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td
                              style={{
                                padding: '16px',
                                textAlign: 'right',
                                borderRight: '1px solid #eef0f3',
                                verticalAlign: 'top',
                              }}
                            >
                              <div style={{ fontSize: '13px', color: '#1e293b' }}>
                                {comp.component?.stockOnHand || 0} {comp.component?.unit || ''}
                              </div>
                            </td>
                            <td
                              style={{
                                padding: '16px',
                                textAlign: 'center',
                                verticalAlign: 'top',
                                color: '#64748b',
                              }}
                            >
                              <span style={{ fontSize: 11 }}>(From Recipe)</span>
                            </td>
                          </tr>
                          {/* Cost Price row */}
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #d1d5db' }}>
                            <td
                              colSpan={5}
                              style={{ padding: '4px 16px', fontSize: '11px', color: '#64748b' }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span>Tag</span> Cost Price : -
                              </div>
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })
                  )}
                  {extraItems.map((item, idx) => {
                    const costPrice = item.costPrice || 0;
                    const totalCost = costPrice * (item.qtyRequired || 0);
                    return (
                      <tr key={`extra-${idx}`} style={{ borderBottom: '1px solid #eef0f3' }}>
                        <td style={{ padding: '16px', borderRight: '1px solid #eef0f3' }}>
                          <ItemComboBox
                            orgId={orgId!}
                            filter="goods"
                            value={item.itemId}
                            onChange={(opt) => {
                              handleExtraItemChange(idx, 'itemId', opt?.id || '');
                              handleExtraItemChange(idx, 'costPrice', opt?.costPrice || 0);
                            }}
                            placeholder="Select an item"
                          />
                        </td>
                        <td
                          colSpan={2}
                          style={{ padding: '16px', borderRight: '1px solid #eef0f3' }}
                        >
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={item.qtyRequired}
                            onChange={(e) =>
                              handleExtraItemChange(
                                idx,
                                'qtyRequired',
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            style={{
                              width: '100%',
                              padding: '6px',
                              border: '1px solid #cbd5e1',
                              borderRadius: '4px',
                              outline: 'none',
                            }}
                          />
                        </td>
                        <td
                          style={{
                            padding: '16px',
                            textAlign: 'right',
                            borderRight: '1px solid #eef0f3',
                            verticalAlign: 'top',
                          }}
                        >
                          <div style={{ fontWeight: 500, color: '#1e293b' }}>{costPrice}</div>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                            Total Cost:
                            <br />₹ {totalCost.toLocaleString('en-IN')}
                          </div>
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleRemoveExtraItem(idx)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '4px',
                              borderRadius: '4px',
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
                  </div>
              <button
                type="button"
                onClick={handleAddExtraItem}
                style={{
                  marginTop: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'transparent',
                  border: 'none',
                  color: '#3b82f6',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                <Plus size={16} /> Add Items
              </button>
            </div>

            {/* Associate Services */}
            {(services.length > 0 || serviceComponents.length > 0) && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 500, color: '#dc2626' }}>
                  Associate Services*
                </div>
                <div className="responsive-table-wrapper">
                    <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    border: '1px solid #d1d5db',
                    fontSize: '13px',
                    marginTop: '8px',
                  }}
                >
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #d1d5db' }}>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontWeight: 500,
                          color: '#475569',
                          borderRight: '1px solid #d1d5db',
                        }}
                      >
                        Service Details
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontWeight: 500,
                          color: '#475569',
                          borderRight: '1px solid #d1d5db',
                          width: '160px',
                        }}
                      >
                        Quantity Required
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontWeight: 500,
                          color: '#475569',
                          borderRight: '1px solid #d1d5db',
                          width: '140px',
                        }}
                      >
                        Total Qty required
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontWeight: 500,
                          color: '#475569',
                          borderRight: '1px solid #d1d5db',
                          width: '140px',
                        }}
                      >
                        Cost per unit
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'center',
                          fontWeight: 500,
                          color: '#475569',
                          width: '40px',
                        }}
                      ></th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceComponents.map((comp) => {
                      const requiredPerUnit = Number(comp.qtyPerUnit);
                      const totalRequired = requiredPerUnit * (Number(qty) || 0);
                      return (
                        <React.Fragment key={comp.id}>
                          <tr style={{ borderBottom: '1px solid #eef0f3' }}>
                            <td style={{ padding: '16px', borderRight: '1px solid #eef0f3' }}>
                              <div
                                style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}
                              >
                                <div
                                  style={{
                                    width: '40px',
                                    height: '40px',
                                    background: '#f1f5f9',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '4px',
                                    border: '1px solid #eef0f3',
                                  }}
                                >
                                  <ImageIcon size={20} color="#94a3b8" />
                                </div>
                                <div>
                                  <div style={{ fontWeight: 500, color: '#1e293b' }}>
                                    {comp.component?.name}
                                  </div>
                                  <div
                                    style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}
                                  >
                                    SKU: {comp.component?.sku || '-'}
                                  </div>
                                </div>
                              </div>
                              <div style={{ marginTop: '16px' }}>
                                <input
                                  type="text"
                                  placeholder="Add a description to your service"
                                  style={{
                                    width: '100%',
                                    border: 'none',
                                    background: 'transparent',
                                    outline: 'none',
                                    fontSize: '13px',
                                    color: '#475569',
                                  }}
                                />
                              </div>
                            </td>
                            <td
                              style={{
                                padding: '16px',
                                textAlign: 'right',
                                borderRight: '1px solid #eef0f3',
                                verticalAlign: 'top',
                              }}
                            >
                              <div style={{ fontWeight: 500, color: '#1e293b' }}>
                                {requiredPerUnit}
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                                x 1 assemblies
                              </div>
                            </td>
                            <td
                              style={{
                                padding: '16px',
                                textAlign: 'right',
                                borderRight: '1px solid #eef0f3',
                                verticalAlign: 'top',
                                fontWeight: 500,
                                color: '#1e293b',
                              }}
                            >
                              {totalRequired}
                            </td>
                            <td
                              style={{
                                padding: '16px',
                                textAlign: 'right',
                                borderRight: '1px solid #eef0f3',
                                verticalAlign: 'top',
                              }}
                            >
                              <div style={{ fontWeight: 500, color: '#1e293b' }}>
                                {comp.component?.costPrice || 0}
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                                Total Cost:
                                <br />₹{' '}
                                {((comp.component?.costPrice || 0) * totalRequired).toLocaleString(
                                  'en-IN',
                                )}
                              </div>
                            </td>
                            <td
                              style={{
                                padding: '16px',
                                textAlign: 'center',
                                verticalAlign: 'top',
                                color: '#64748b',
                              }}
                            >
                              <span style={{ fontSize: 11 }}>(From Recipe)</span>
                            </td>
                          </tr>
                          {/* Cost Price row */}
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #d1d5db' }}>
                            <td
                              colSpan={5}
                              style={{ padding: '4px 16px', fontSize: '11px', color: '#64748b' }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span>Tag</span> Cost Price : -
                              </div>
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                    {services.map((svc, idx) => {
                      const costPrice = svc.costPrice || 0;
                      const totalCost = costPrice * (svc.qtyRequired || 0);
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #eef0f3' }}>
                          <td style={{ padding: '16px', borderRight: '1px solid #eef0f3' }}>
                            <ItemComboBox
                              orgId={orgId!}
                              filter="services"
                              value={svc.itemId}
                              onChange={(item) => {
                                handleServiceChange(idx, 'itemId', item?.id || '');
                                handleServiceChange(idx, 'costPrice', item?.costPrice || 0);
                              }}
                              placeholder="Select a service"
                            />
                          </td>
                          <td
                            colSpan={2}
                            style={{ padding: '16px', borderRight: '1px solid #eef0f3' }}
                          >
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={svc.qtyRequired}
                              onChange={(e) =>
                                handleServiceChange(
                                  idx,
                                  'qtyRequired',
                                  parseFloat(e.target.value) || 0,
                                )
                              }
                              style={{
                                width: '100%',
                                padding: '6px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                outline: 'none',
                              }}
                            />
                          </td>
                          <td
                            style={{
                              padding: '16px',
                              textAlign: 'right',
                              borderRight: '1px solid #eef0f3',
                              verticalAlign: 'top',
                            }}
                          >
                            <div style={{ fontWeight: 500, color: '#1e293b' }}>{costPrice}</div>
                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                              Total Cost:
                              <br />₹ {totalCost.toLocaleString('en-IN')}
                            </div>
                          </td>
                          <td style={{ padding: '16px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleRemoveService(idx)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#ef4444',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '100%',
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                  </div>
              </div>
            )}

            <div
              style={{
                padding: '16px',
                border: '1px solid #e2e8f0',
                borderTop:
                  services.length > 0 || serviceComponents.length > 0
                    ? 'none'
                    : '1px solid #e2e8f0',
                borderRadius:
                  services.length > 0 || serviceComponents.length > 0 ? '0 0 8px 8px' : '8px',
                background: '#f8fafc',
                marginTop: services.length > 0 || serviceComponents.length > 0 ? 0 : '16px',
              }}
            >
              <button
                type="button"
                onClick={handleAddService}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'transparent',
                  border: 'none',
                  color: '#3b82f6',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                <Plus size={16} /> Add Services
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Footer Actions */}
      <div
        className="form-actions-footer page-footer"
        style={{
          height: '44px',
          boxSizing: 'border-box',
          position: 'sticky',
          bottom: 0,
          right: 0,
          background: '#fff',
          padding: '0 24px',
          borderTop: '1px solid #eef0f3',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          zIndex: 100,
        }}
      >
        <button
          type="submit"
          form="create-assembly-form"
          disabled={createMutation.isPending}
          style={{
            padding: '6px 20px',
            background: '#0062ff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
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
          onClick={() => {
            const returnUrl = (location.state as { returnUrl?: string })?.returnUrl;
            if (returnUrl) {
              navigate(returnUrl);
            } else {
              navigate(-1);
            }
          }}
          style={{
            padding: '6px 20px',
            background: 'white',
            color: createMutation.isPending ? '#94a3b8' : '#333',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            fontSize: '13px',
          }}
        >
          Cancel
        </button>
      </div>

      <AssemblyNumberConfigModal
        isOpen={isNumberConfigOpen}
        onClose={() => setIsNumberConfigOpen(false)}
        onSave={(prefix, nextNumber) =>
          updatePreferenceMutation.mutate({ prefix, nextNumber: Number(nextNumber) })
        }
        initialPrefix={preference?.prefix}
        initialNextNumber={preference?.nextNumber.toString().padStart(5, '0')}
      />
    </div>
  );
}

function PackageIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}
