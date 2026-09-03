 
import { useEffect, useState } from 'react';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { AxiosError } from 'axios';
import {
  Plus,
  Trash2,
  Pencil,
  Settings,
  Mail,
  Phone,
  PlusCircle,
  Check,
  Image,
  Upload,
  ChevronDown,
  FileText,
  X,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPaymentTerms } from './payment-terms.api';
import { MultiSelectItemModal } from '../../items/components/MultiSelectItemModal';
import { DateInput } from '../../../components/ui/DateInput';
import { ItemComboBox } from '../../../components/ui/ItemComboBox';
import { Select } from '../../../components/ui/Select';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import type { CreatePurchaseOrderData, PurchaseOrderItem } from './purchase-orders.schemas';
import {
  createPurchaseOrder,
  fetchPurchaseOrderById,
  updatePurchaseOrder,
  fetchLocations,
  uploadPOAttachments,
  fetchPONumberPreference,
  updatePONumberPreference,
  type POAttachment,
} from './purchase-orders.api';
import { fetchVendors } from '../vendors/vendors.api';
import { itemsApi } from '../../items/items.api';
import type { Location } from '../../configuration/locations/locations.api';
import { fetchCustomers, type Customer } from '../../sales/customers/customers.api';
import { PurchaseOrderNumberConfigModal } from './PurchaseOrderNumberConfigModal';
import { PaymentTermModal } from '../../sales/customers/PaymentTermModal';
import { DeliveryAddressModal } from './DeliveryAddressModal';
import { CreateVendorModal } from '../vendors/CreateVendorModal';
import { CreateItemModal } from '../../items/CreateItemModal';
function getImageKey(img: unknown): string | null {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (
    typeof img === 'object' &&
    img !== null &&
    'key' in img &&
    typeof (img as { key: unknown }).key === 'string'
  ) {
    return (img as { key: string }).key;
  }
  return null;
}

function ItemImage({
  orgId,
  itemId,
  imageKey,
  alt = 'Item',
  iconSize = 18,
}: {
  orgId?: string;
  itemId?: string;
  imageKey?: string | { key: string; name?: string; size?: number; type?: string } | null;
  alt?: string;
  iconSize?: number;
}) {
  const resolvedKey = getImageKey(imageKey);
  const isDirectUrl = Boolean(
    resolvedKey &&
    (resolvedKey.startsWith('http://') ||
      resolvedKey.startsWith('https://') ||
      resolvedKey.startsWith('data:')),
  );

  const { data: signedUrl } = useQuery({
    queryKey: ['signedUrl', orgId, itemId, resolvedKey],
    queryFn: () => itemsApi.getSignedUrl(orgId!, itemId!, resolvedKey!),
    enabled: Boolean(orgId && itemId && resolvedKey && !isDirectUrl),
    staleTime: 1000 * 60 * 30,
  });

  const finalSrc = isDirectUrl ? resolvedKey : signedUrl;

  if (!finalSrc) {
    return <Image size={iconSize} color="#94a3b8" />;
  }

  return (
    <img
      src={finalSrc}
      alt={alt}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}

export function CreatePurchaseOrder() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId, id } = useParams<{ orgId: string; id?: string }>();
  const [searchParams] = useSearchParams();
  const cloneFrom = searchParams.get('cloneFrom');
  const queryClient = useQueryClient();

  const poIdToFetch = id || cloneFrom;
  const isEdit = Boolean(id);
  const isClone = Boolean(cloneFrom);

  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [itemModalIndex, setItemModalIndex] = useState<number | null>(null);
  const [isMultiSelectItemModalOpen, setIsMultiSelectItemModalOpen] = useState(false);
  const [multiSelectTargetIndex, setMultiSelectTargetIndex] = useState<number | null>(null);

  const { data: existingPo, isLoading: isFetchingPo } = useQuery({
    queryKey: ['purchaseOrder', orgId, poIdToFetch],
    queryFn: () => fetchPurchaseOrderById(orgId!, poIdToFetch!),
    enabled: Boolean(orgId && poIdToFetch),
  });

  const { data: vendorsPage } = useQuery({
    queryKey: ['vendors', orgId],
    queryFn: () => fetchVendors(orgId!),
  });
  const vendors = vendorsPage?.results || [];

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
  });

  const { data: paymentTerms } = useQuery({
    queryKey: ['payment-terms', orgId],
    queryFn: () => fetchPaymentTerms(orgId!),
  });

  const { data: customersPage } = useQuery({
    queryKey: ['customers', orgId],
    queryFn: () => fetchCustomers(orgId!),
  });
  const customers = customersPage?.results || [];

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    trigger,
    formState: { errors },
  } = useForm<CreatePurchaseOrderData>({
    defaultValues: {
      status: 'Draft',
      date: new Date().toISOString().split('T')[0],
      deliveryType: 'Location',
      lineItems: [
        {
          itemId: '',
          quantity: '' as unknown as number,
          rate: '' as unknown as number,
          discountValue: '' as unknown as number,
          discountType: 'percentage',
          itemTotal: 0,
        } as PurchaseOrderItem,
      ],
      subTotal: 0,
      totalAmount: 0,
    },
  });

  useEffect(() => {
    if (existingPo) {
      const formattedLineItems = (existingPo.lineItems || []).map((item) => {
        const discountVal =
          item.discountValue !== undefined && item.discountValue !== null
            ? item.discountValue
            : item.discountPercentage || item.discount || 0;
        return {
          itemId: item.itemId,
          item: item.item,
          quantity: item.quantity || ('' as unknown as number),
          rate: item.rate || ('' as unknown as number),
          discountValue: discountVal || ('' as unknown as number),
          discountType: item.discountType || (item.discountPercentage ? 'percentage' : 'fixed'),
          itemTotal: item.itemTotal || 0,
        };
      });

      const resetData: CreatePurchaseOrderData = {
        vendorId: existingPo.vendorId || '',
        poNumber: isClone ? '' : existingPo.poNumber || '',
        date: isClone
          ? new Date().toISOString().split('T')[0]
          : existingPo.date
            ? new Date(existingPo.date).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
        deliveryDate: existingPo.deliveryDate
          ? new Date(existingPo.deliveryDate).toISOString().split('T')[0]
          : '',
        paymentTerms: existingPo.paymentTerms || '',
        deliveryType: existingPo.deliveryType || 'Location',
        deliveryLocationId: existingPo.deliveryLocationId || '',
        deliveryCustomerId: existingPo.deliveryCustomerId || '',
        notes: existingPo.notes || '',
        termsAndConditions: existingPo.termsAndConditions || '',
        status: isClone ? 'Draft' : existingPo.status || 'Draft',
        customFields: existingPo.customFields || null,
        lineItems:
          formattedLineItems.length > 0
            ? (formattedLineItems as unknown as PurchaseOrderItem[])
            : [
                {
                  itemId: '',
                  quantity: '' as unknown as number,
                  rate: '' as unknown as number,
                  discountValue: '' as unknown as number,
                  discountType: 'percentage',
                  itemTotal: 0,
                } as PurchaseOrderItem,
              ],
        subTotal: Number(existingPo.subTotal) || 0,
        totalAmount: Number(existingPo.totalAmount) || 0,
      };

      if (existingPo.poNumber && !isClone) {
        resetData.poNumber = existingPo.poNumber;
      }

      reset(resetData);

      if (existingPo.documents && Array.isArray(existingPo.documents)) {
        setAttachedFiles(existingPo.documents);
      }
    }
  }, [existingPo, isClone, reset]);

  const {
    fields: itemFields,
    append: appendItem,
    remove: removeItem,
  } = useFieldArray({
    control,
    name: 'lineItems',
  });

  const watchItems = useWatch({ control, name: 'lineItems' });
  const watchDeliveryType = watch('deliveryType');
  const watchDeliveryLocationId = watch('deliveryLocationId');
  const watchDeliveryCustomerId = watch('deliveryCustomerId');
  const watchLocationId = watch('locationId');
  const watchPoDate = watch('date');
  const watchPaymentTerms = watch('paymentTerms');

  useEffect(() => {
    if (watchPoDate && watchPaymentTerms && paymentTerms) {
      const term = paymentTerms.find((pt) => pt.id.toString() === watchPaymentTerms);
      if (term && term.dueAfterDays !== undefined && term.dueAfterDays !== null) {
        const d = new Date(watchPoDate);
        d.setDate(d.getDate() + term.dueAfterDays);
        setValue('deliveryDate', d.toISOString().split('T')[0], {
          shouldValidate: true,
          shouldDirty: true,
        });
      }
    }
  }, [watchPoDate, watchPaymentTerms, paymentTerms, setValue]);

  const [poPrefix, setPoPrefix] = useState('PO-');
  const [isNumberConfigOpen, setIsNumberConfigOpen] = useState(false);
  const [isPaymentTermModalOpen, setIsPaymentTermModalOpen] = useState(false);
  const [isDeliveryAddressModalOpen, setIsDeliveryAddressModalOpen] = useState(false);
  const [isEditingDeliveryName, setIsEditingDeliveryName] = useState(false);
  const [customDeliveryName, setCustomDeliveryName] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<POAttachment[]>([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileUploadError(null);
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const currentCount = attachedFiles.length;
    const newFilesArray = Array.from(files);

    if (currentCount + newFilesArray.length > 2) {
      setFileUploadError('You can upload a maximum of 2 files.');
      return;
    }

    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit per file
    for (const f of newFilesArray) {
      if (f.size > MAX_FILE_SIZE) {
        setFileUploadError(`"${f.name}" exceeds the 5MB size limit.`);
        return;
      }
    }

    try {
      setIsUploadingFile(true);
      const formData = new FormData();
      for (const f of newFilesArray) {
        formData.append('files', f);
      }
      const uploadedAttachments = await uploadPOAttachments(orgId!, formData);
      setAttachedFiles((prev) => [...prev, ...uploadedAttachments]);
    } catch (err: unknown) {
      const errorMsg =
        (err as AxiosError<{ message?: string }>)?.response?.data?.message ||
        'Failed to upload attachment.';
      setFileUploadError(errorMsg);
    } finally {
      setIsUploadingFile(false);
      e.target.value = '';
    }
  };

  const handleRemoveFile = (fileIndex: number) => {
    setAttachedFiles((prev) => prev.filter((_, idx) => idx !== fileIndex));
    setFileUploadError(null);
  };

  const selectedLocation = locations.find((l: Location) => l.id === watchDeliveryLocationId);
  const selectedCustomer = customers.find((c: Customer) => c.id === watchDeliveryCustomerId);

  useEffect(() => {
    setCustomDeliveryName('');
    setIsEditingDeliveryName(false);
  }, [watchDeliveryLocationId, watchDeliveryCustomerId, watchDeliveryType]);

  useEffect(() => {
    if (locations.length > 0) {
      const defaultLocation =
        locations.find((l: Location) => l.isPrimary) ||
        locations.find((l: Location) => !l.parentId);
      if (defaultLocation) {
        if (!watchLocationId) {
          setValue('locationId', defaultLocation.id);
        }
        if (!watchDeliveryLocationId && watchDeliveryType === 'Location') {
          setValue('deliveryLocationId', defaultLocation.id);
        }
      }
    }
  }, [locations, watchLocationId, watchDeliveryLocationId, watchDeliveryType, setValue]);

  let computedSubTotal = 0;
  let computedTotalDiscount = 0;
  (watchItems || []).forEach((item: PurchaseOrderItem) => {
    const qty = isNaN(Number(item?.quantity)) ? 0 : Number(item?.quantity);
    const rate = isNaN(Number(item?.rate)) ? 0 : Number(item?.rate);
    const basePrice = qty * rate;
    const discountVal = isNaN(Number(item?.discountValue)) ? 0 : Number(item?.discountValue);
    const discType = item?.discountType || 'percentage';

    const discountAmount =
      discType === 'percentage' ? (basePrice * discountVal) / 100 : discountVal;
    computedSubTotal += basePrice;
    computedTotalDiscount += discountAmount;
  });
  const computedTotalAmount = Math.max(0, computedSubTotal - computedTotalDiscount);

  useEffect(() => {
    setValue('subTotal', computedSubTotal);
    setValue('totalAmount', computedTotalAmount);
  }, [computedSubTotal, computedTotalAmount, setValue]);

  const { data: preference } = useQuery({
    queryKey: ['po-number-preference', orgId],
    queryFn: () => fetchPONumberPreference(orgId!),
    enabled: !!orgId,
  });

  const [lastPrefilledNumber, setLastPrefilledNumber] = useState('');

  useEffect(() => {
    if (preference && !isEdit) {
      const generatedNumber = `${preference.prefix}${preference.nextNumber.toString().padStart(5, '0')}`;
      const currentValue = watch('poNumber');

      if (!currentValue || currentValue === lastPrefilledNumber) {
        setValue('poNumber', generatedNumber);
        setLastPrefilledNumber(generatedNumber);
        setPoPrefix(preference.prefix);
      }
    }
  }, [preference, setValue, watch, lastPrefilledNumber, isEdit]);

  const updatePreferenceMutation = useMutation({
    mutationFn: (data: { prefix: string; nextNumber: number }) =>
      updatePONumberPreference(orgId!, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['po-number-preference', orgId], data);
      setValue('poNumber', `${data.prefix}${data.nextNumber.toString().padStart(5, '0')}`);
      setPoPrefix(data.prefix);
      setIsNumberConfigOpen(false);
    },
  });

  const mutation = useMutation({
    mutationFn: (data: CreatePurchaseOrderData) => {
      if (isEdit && id) {
        return updatePurchaseOrder({ orgId: orgId!, id, data });
      }
      return createPurchaseOrder(orgId!, data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders', orgId] });
      if (id) {
        queryClient.invalidateQueries({ queryKey: ['purchaseOrder', orgId, id] });
      }
      queryClient.invalidateQueries({ queryKey: ['po-number-preference', orgId] });
      navigate(
        `/organizations/${orgId}/purchases/purchase-orders?id=${isEdit && id ? id : data?.id}`,
      );
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      alert(
        error.response?.data?.message ||
          error.message ||
          `Failed to ${isEdit ? 'update' : 'create'} purchase order`,
      );
    },
  });

  const onSubmit = (data: CreatePurchaseOrderData) => {
    const finalItems = (data.lineItems || []).map((item) => {
      const qty = isNaN(Number(item?.quantity)) ? 0 : Number(item?.quantity);
      const rate = isNaN(Number(item?.rate)) ? 0 : Number(item?.rate);
      const basePrice = qty * rate;
      const discountVal = isNaN(Number(item?.discountValue)) ? 0 : Number(item?.discountValue);
      const discType = item?.discountType || 'percentage';
      const discountAmount =
        discType === 'percentage' ? (basePrice * discountVal) / 100 : discountVal;
      const itemTotal = Math.max(0, basePrice - discountAmount);
      return {
        ...item,
        quantity: qty,
        rate: rate,
        itemTotal: itemTotal,
        discount: discountAmount,
        discountPercentage: discType === 'percentage' ? discountVal : null,
      };
    });

    const finalData = {
      ...data,
      deliveryCustomerId: data.deliveryCustomerId || null,
      deliveryLocationId: data.deliveryLocationId || null,
      deliveryDate: data.deliveryDate || null,
      paymentTerms: data.paymentTerms || null,
      notes: data.notes || null,
      termsAndConditions: data.termsAndConditions || null,
      lineItems: finalItems,
      subTotal: computedSubTotal,
      totalAmount: computedTotalAmount,
      documents: attachedFiles,
      customFields: {
        ...data.customFields,
        ...(customDeliveryName ? { customDeliveryName } : {}),
      },
    };
    console.log('Submitting PO data:', finalData);
    mutation.mutate(finalData);
  };

  const labelStyle = {
    paddingTop: '0',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: '#111',
  };
  const inputStyle = {
    width: '100%',
    maxWidth: '440px',
    padding: '8px 12px',
    fontSize: '13px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    background: '#fff',
  };
  const searchableSelectStyle = { width: '100%', maxWidth: '440px' };

  if (isFetchingPo) {
    return (
      <div style={{ padding: '64px', textAlign: 'center', color: '#64748b' }}>
        Loading purchase order details...
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <h1 style={{ fontSize: '20px', fontWeight: 600, margin: 0, color: '#1e293b' }}>
          {isEdit
            ? `Edit Purchase Order (${existingPo?.poNumber || ''})`
            : isClone
              ? 'Clone Purchase Order'
              : 'New Purchase Order'}
        </h1>
        <button
          type="button"
          onClick={() => navigate((location.state as { returnUrl?: string })?.returnUrl || `/organizations/${orgId}/purchases/purchase-orders`)}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px',
            borderRadius: '4px',
          }}
        >
          <X size={20} />
        </button>
      </div>

      <div className="page-body">
        <form
          id="create-po-form"
          onSubmit={handleSubmit(onSubmit, (errs) => console.log('Validation errors:', errs))}
          noValidate
        >
        {/* Main Details Section */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '24px 28px',
            marginBottom: '32px',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div className="form-field-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '200px 1fr',
              rowGap: '20px',
              columnGap: '16px',
              alignItems: 'center',
              fontSize: '13px',
            }}
          >
            <label style={{ ...labelStyle, color: '#ef4444' }}>Vendor Name*</label>
            <div>
              <input type="hidden" {...register('vendorId', { required: true })} />
              <SearchableSelect
                options={vendors.map((v) => ({ label: v.contactName, value: v.id }))}
                value={watch('vendorId') || undefined}
                onChange={(val) => setValue('vendorId', val, { shouldValidate: true })}
                placeholder="Select a Vendor"
                renderOption={(option, isSelected) => {
                  const vendor = vendors.find((v) => v.id === option.value);
                  if (!vendor) return <>{option.label}</>;
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '50%',
                          backgroundColor: isSelected ? '#bfdbfe' : '#e2e8f0',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: isSelected ? '#1e40af' : '#64748b',
                          fontWeight: 500,
                          fontSize: '14px',
                          flexShrink: 0,
                        }}
                      >
                        {vendor.contactName.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 500 }}>{vendor.contactName}</span>
                          <span style={{ color: isSelected ? '#bfdbfe' : '#94a3b8' }}>|</span>
                          <span
                            style={{ fontSize: '12px', color: isSelected ? '#dbeafe' : '#64748b' }}
                          >
                            {vendor.contactNumber}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            marginTop: '4px',
                            fontSize: '12px',
                            color: isSelected ? '#bfdbfe' : '#94a3b8',
                          }}
                        >
                          {vendor.email && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Mail size={12} /> {vendor.email}
                            </span>
                          )}
                          {vendor.mobile && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Phone size={12} /> {vendor.mobile}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }}

                footerAction={{
                  text: 'New Vendor',
                  icon: <PlusCircle size={16} />,
                  onClick: () => setIsVendorModalOpen(true),
                }}
                style={searchableSelectStyle}
              />
              {errors.vendorId && (
                <div style={{ color: '#e54d4d', fontSize: '12px', marginTop: '4px' }}>
                  Vendor Name is required
                </div>
              )}
            </div>

            <label style={labelStyle}>Location</label>
            <SearchableSelect
              options={locations.map((l: Location) => ({ label: l.name, value: l.id }))}
              value={watch('locationId') || undefined}
              onChange={(val) => setValue('locationId', val)}
              placeholder="Select Location"
              footerAction={{
                text: 'New Location',
                icon: <PlusCircle size={16} />,
                onClick: () => navigate(`/organizations/${orgId}/settings/locations/new`),
              }}
              style={searchableSelectStyle}
            />

            <label style={{ ...labelStyle, alignSelf: 'flex-start', color: '#ef4444' }}>
              Delivery Address*
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div
                style={{ display: 'flex', gap: '16px', alignItems: 'center', minHeight: '20px' }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    margin: 0,
                    lineHeight: 1,
                  }}
                >
                  <input
                    type="radio"
                    value="Location"
                    {...register('deliveryType')}
                    style={{ margin: 0, cursor: 'pointer' }}
                  />{' '}
                  Locations
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    margin: 0,
                    lineHeight: 1,
                  }}
                >
                  <input
                    type="radio"
                    value="Customer"
                    {...register('deliveryType')}
                    style={{ margin: 0, cursor: 'pointer' }}
                  />{' '}
                  Customer
                </label>
              </div>

              {watchDeliveryType === 'Location' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <SearchableSelect
                    options={locations.map((l: Location) => ({ label: l.name, value: l.id }))}
                    value={watch('deliveryLocationId') || undefined}
                    onChange={(val) => setValue('deliveryLocationId', val)}
                    placeholder="Select Location"
                    footerAction={{
                      text: 'New Location',
                      icon: <PlusCircle size={16} />,
                      onClick: () => navigate(`/organizations/${orgId}/settings/locations/new`),
                    }}
                    style={searchableSelectStyle}
                  />

                  {selectedLocation && (
                    <div
                      style={{
                        padding: '8px 0',
                        color: '#555',
                        fontSize: '13px',
                        lineHeight: '1.6',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 500,
                          fontSize: '14px',
                          marginBottom: '8px',
                          color: '#111',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        {isEditingDeliveryName ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input
                              type="text"
                              value={customDeliveryName}
                              onChange={(e) => setCustomDeliveryName(e.target.value)}
                              onBlur={() => setIsEditingDeliveryName(false)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  setIsEditingDeliveryName(false);
                                }
                              }}
                              autoFocus
                              style={{
                                padding: '4px 8px',
                                fontSize: '14px',
                                fontWeight: 500,
                                border: '1px solid #0062ff',
                                borderRadius: '4px',
                                outline: 'none',
                                color: '#111',
                                minWidth: '200px',
                              }}
                            />
                            <Check
                              size={18}
                              color="#10b981"
                              style={{ cursor: 'pointer' }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setIsEditingDeliveryName(false);
                              }}
                            />
                          </div>
                        ) : (
                          <>
                            <span>{customDeliveryName || selectedLocation.name}</span>
                            <Pencil
                              size={14}
                              color="#0062ff"
                              style={{ cursor: 'pointer' }}
                              onClick={() => {
                                setCustomDeliveryName(customDeliveryName || selectedLocation.name);
                                setIsEditingDeliveryName(true);
                              }}
                            />
                          </>
                        )}
                      </div>
                      <div>
                        {selectedLocation.street1} {selectedLocation.street2}
                      </div>
                      <div>
                        {selectedLocation.city}, {selectedLocation.state}
                      </div>
                      <div>
                        {selectedLocation.country}, {selectedLocation.zip}
                      </div>
                      <div>{selectedLocation.phone}</div>
                      <div
                        style={{
                          marginTop: '12px',
                          color: '#0062ff',
                          cursor: 'pointer',
                          display: 'inline-block',
                          fontWeight: 500,
                        }}
                        onClick={() => setIsDeliveryAddressModalOpen(true)}
                      >
                        Change destination to deliver
                      </div>
                    </div>
                  )}
                </div>
              )}
              {watchDeliveryType === 'Customer' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <SearchableSelect
                    options={customers.map((c: Customer) => ({
                      label: c.contactName,
                      value: c.id,
                    }))}
                    value={watchDeliveryCustomerId || undefined}
                    onChange={(val) => setValue('deliveryCustomerId', val)}
                    placeholder="Select Customer"
                    footerAction={{
                      text: 'New Customer',
                      icon: <PlusCircle size={16} />,
                      onClick: () => navigate(`/organizations/${orgId}/sales/customers/new`),
                    }}
                    style={searchableSelectStyle}
                  />

                  {selectedCustomer && (
                    <div
                      style={{
                        padding: '8px 0',
                        color: '#555',
                        fontSize: '13px',
                        lineHeight: '1.6',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 500,
                          fontSize: '14px',
                          marginBottom: '8px',
                          color: '#333',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        {isEditingDeliveryName ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input
                              type="text"
                              value={customDeliveryName}
                              onChange={(e) => setCustomDeliveryName(e.target.value)}
                              onBlur={() => setIsEditingDeliveryName(false)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  setIsEditingDeliveryName(false);
                                }
                              }}
                              autoFocus
                              style={{
                                padding: '4px 8px',
                                fontSize: '14px',
                                fontWeight: 500,
                                border: '1px solid #0062ff',
                                borderRadius: '4px',
                                outline: 'none',
                                color: '#111',
                                minWidth: '200px',
                              }}
                            />
                            <Check
                              size={18}
                              color="#10b981"
                              style={{ cursor: 'pointer' }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setIsEditingDeliveryName(false);
                              }}
                            />
                          </div>
                        ) : (
                          <>
                            <span>{customDeliveryName || selectedCustomer.contactName}</span>
                            <Pencil
                              size={14}
                              color="#0062ff"
                              style={{ cursor: 'pointer' }}
                              onClick={() => {
                                setCustomDeliveryName(
                                  customDeliveryName || selectedCustomer.contactName,
                                );
                                setIsEditingDeliveryName(true);
                              }}
                            />
                          </>
                        )}
                      </div>
                      <div>
                        {selectedCustomer.shippingStreet1} {selectedCustomer.shippingStreet2}
                      </div>
                      <div>
                        {selectedCustomer.shippingCity}, {selectedCustomer.shippingState}
                      </div>
                      <div>
                        {selectedCustomer.shippingCountry}, {selectedCustomer.shippingPinCode}
                      </div>
                      <div>{selectedCustomer.shippingPhone}</div>
                      <div
                        style={{
                          marginTop: '12px',
                          color: '#0062ff',
                          cursor: 'pointer',
                          display: 'inline-block',
                          fontWeight: 500,
                        }}
                        onClick={() => setIsDeliveryAddressModalOpen(true)}
                      >
                        Change destination to deliver
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <label style={{ ...labelStyle, color: '#ef4444' }}>Purchase Order#*</label>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '440px' }}>
                <input
                  type="text"
                  {...register('poNumber', { required: true })}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => setIsNumberConfigOpen(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#888',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                  }}
                >
                  <Settings size={18} />
                </button>
              </div>
              {errors.poNumber && (
                <div style={{ color: '#e54d4d', fontSize: '12px', marginTop: '4px' }}>
                  Purchase Order# is required
                </div>
              )}
            </div>

            <label style={{ ...labelStyle, color: '#ef4444' }}>Date*</label>
            <div style={{ position: 'relative', width: '100%', maxWidth: '440px' }}>
              <Controller
                name="date"
                control={control}
                rules={{ required: 'Date is required' }}
                render={({ field }) => (
                  <DateInput
                    value={field.value ?? ''}
                    onChange={(next) => {
                      field.onChange(next);
                      // Delivery date is validated against this one, so it has to
                      // be re-checked whenever this moves.
                      if (watch('deliveryDate')) trigger('deliveryDate');
                    }}
                    ariaLabel="Purchase order date"
                    style={{ ...inputStyle, maxWidth: '100%' }}
                  />
                )}
              />
            </div>

            <label style={labelStyle}>Delivery Date</label>
            <div style={{ position: 'relative', width: '100%', maxWidth: '440px' }}>
              <Controller
                name="deliveryDate"
                control={control}
                rules={{
                  validate: (val) => {
                    if (!val || !watchPoDate) return true;
                    return val >= watchPoDate || 'Delivery date must be on or after PO date';
                  },
                }}
                render={({ field }) => (
                  <DateInput
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    min={watchPoDate}
                    ariaLabel="Delivery date"
                    style={{ ...inputStyle, maxWidth: '100%' }}
                  />
                )}
              />
              {errors.deliveryDate && (
                <div style={{ color: '#e54d4d', fontSize: '12px', marginTop: '4px' }}>
                  {errors.deliveryDate.message || 'Delivery date must be on or after PO date'}
                </div>
              )}
            </div>

            <label style={labelStyle}>Payment Terms</label>
            <SearchableSelect
              options={
                paymentTerms?.map((pt) => ({ label: pt.termName, value: pt.id.toString() })) || []
              }
              value={watch('paymentTerms') || undefined}
              onChange={(val) => setValue('paymentTerms', val)}
              placeholder="Select Payment Terms"
              footerAction={{
                text: 'New Payment Term',
                icon: <PlusCircle size={16} />,
                onClick: () => setIsPaymentTermModalOpen(true),
              }}
              style={searchableSelectStyle}
            />
          </div>
        </div>

        {/* Items Table Section */}
        <div
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            background: '#ffffff',
            marginBottom: '32px',
            boxShadow: '0 1px 3px 0 rgba(0,0,0,0.04)',
            overflow: 'visible',
          }}
        >
          <div
            style={{
              padding: '14px 20px',
              borderBottom: '1px solid #e2e8f0',
              background: '#f8fafc',
              fontWeight: 600,
              fontSize: '14px',
              color: '#1e293b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTopLeftRadius: '8px',
              borderTopRightRadius: '8px',
            }}
          >
            <span>Item Details</span>
          </div>
          <div className="responsive-table-wrapper">
<table
            style={{
              width: '100%',
              tableLayout: 'fixed',
              borderCollapse: 'collapse',
              fontSize: '13px',
            }}
          >
            <thead>
              <tr
                style={{
                  background: '#f1f5f9',
                  color: '#475569',
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textAlign: 'left',
                }}
              >
                <th
                  style={{
                    padding: '10px 16px',
                    width: '35%',
                    borderBottom: '1px solid #e2e8f0',
                    borderRight: '1px solid #e2e8f0',
                  }}
                >
                  ITEM DETAILS
                </th>
                <th
                  style={{
                    padding: '10px 16px',
                    width: '13%',
                    textAlign: 'right',
                    borderBottom: '1px solid #e2e8f0',
                    borderRight: '1px solid #e2e8f0',
                  }}
                >
                  QUANTITY
                </th>
                <th
                  style={{
                    padding: '10px 16px',
                    width: '15%',
                    textAlign: 'right',
                    borderBottom: '1px solid #e2e8f0',
                    borderRight: '1px solid #e2e8f0',
                  }}
                >
                  RATE
                </th>
                <th
                  style={{
                    padding: '10px 16px',
                    width: '18%',
                    textAlign: 'right',
                    borderBottom: '1px solid #e2e8f0',
                    borderRight: '1px solid #e2e8f0',
                  }}
                >
                  DISCOUNT
                </th>
                <th
                  style={{
                    padding: '10px 16px',
                    width: '15%',
                    textAlign: 'right',
                    borderBottom: '1px solid #e2e8f0',
                    borderRight: '1px solid #e2e8f0',
                  }}
                >
                  AMOUNT
                </th>
                <th
                  style={{
                    padding: '10px 12px',
                    width: '4%',
                    textAlign: 'center',
                    borderBottom: '1px solid #e2e8f0',
                  }}
                ></th>
              </tr>
            </thead>
            <tbody>
              {itemFields.map((field, index) => {
                const curItem = watchItems?.[index];
                const selectedItem = curItem?.item;
                const itemImageUrl =
                  getImageKey(selectedItem?.frontImage) || getImageKey(selectedItem?.images?.[0]);
                const qty = isNaN(Number(curItem?.quantity)) ? 0 : Number(curItem?.quantity);
                const rate = isNaN(Number(curItem?.rate)) ? 0 : Number(curItem?.rate);
                const basePrice = qty * rate;
                const discountVal = isNaN(Number(curItem?.discountValue))
                  ? 0
                  : Number(curItem?.discountValue);
                const discType = curItem?.discountType || 'percentage';
                const discountAmount =
                  discType === 'percentage' ? (basePrice * discountVal) / 100 : discountVal;
                const calculatedRowAmount = Math.max(0, basePrice - discountAmount);

                return (
                  <tr
                    key={field.id}
                    style={{
                      background: index % 2 === 0 ? '#ffffff' : '#f8fafc',
                      position: 'relative',
                      zIndex: itemFields.length - index + 2,
                    }}
                  >
                    <td
                      style={{
                        padding: '14px 16px',
                        verticalAlign: 'top',
                        borderBottom: '1px solid #e2e8f0',
                        borderRight: '1px solid #e2e8f0',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <ItemComboBox
                            orgId={orgId!}
                            portal={true}
                            value={watchItems?.[index]?.itemId}
                            initialItem={watchItems?.[index]?.item}
                            selectedImage={
                              selectedItem ? (
                                <ItemImage
                                  orgId={orgId}
                                  itemId={selectedItem.id}
                                  imageKey={itemImageUrl}
                                  alt={selectedItem.name}
                                  iconSize={14}
                                />
                              ) : null
                            }
                            onOpenMultiSelect={() => {
                              setMultiSelectTargetIndex(index);
                              setIsMultiSelectItemModalOpen(true);
                            }}
                            onChange={(val) => {
                              setValue(`lineItems.${index}.itemId`, val?.id || '', {
                                shouldValidate: true,
                              });
                              setValue(`lineItems.${index}.item`, val);
                              const selected = val;
                              if (selected) {
                                setValue(
                                  `lineItems.${index}.rate`,
                                  (selected.costPrice ||
                                    selected.sellingPrice ||
                                    '') as unknown as number,
                                );
                                setValue(`lineItems.${index}.quantity`, 1 as unknown as number);
                                setValue(
                                  `lineItems.${index}.description`,
                                  selected.purchaseDescription ||
                                    selected.purchaseDescription ||
                                    selected.salesDescription ||
                                    selected.salesDescription ||
                                    '',
                                );
                              } else {
                                setValue(`lineItems.${index}.rate`, '' as unknown as number);
                                setValue(`lineItems.${index}.quantity`, '' as unknown as number);
                                setValue(
                                  `lineItems.${index}.discountValue`,
                                  '' as unknown as number,
                                );
                                setValue(`lineItems.${index}.discountType`, 'percentage');
                                setValue(`lineItems.${index}.description`, '');
                              }
                            }}
                            placeholder="Type or click to select an item."
                            footerAction={{
                              text: 'New Product',
                              onClick: () => setItemModalIndex(index),
                            }}
                          />
                        </div>

                        {/* Description Field - only shown when an item is selected */}
                        {selectedItem && (
                          <textarea
                            {...register(`lineItems.${index}.description`)}
                            placeholder="Add a description to your item"
                            rows={2}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              borderRadius: '6px',
                              border: '1px solid #e2e8f0',
                              background: '#f8fafc',
                              fontSize: '12px',
                              color: '#334155',
                              resize: 'vertical',
                              outline: 'none',
                              fontFamily: 'inherit',
                              boxSizing: 'border-box',
                            }}
                          />
                        )}

                        {/* Badges: GOODS / SERVICES + HSN Code */}
                        {selectedItem && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '11px',
                              marginTop: '2px',
                            }}
                          >
                            <span
                              style={{
                                background: '#0062ff',
                                color: '#ffffff',
                                padding: '3px 8px',
                                borderRadius: '3px',
                                fontWeight: 700,
                                fontSize: '10px',
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                              }}
                            >
                              {selectedItem.type || 'GOODS'}
                            </span>
                            {selectedItem.hsnCode && (
                              <span style={{ color: '#475569', fontWeight: 500 }}>
                                HSN Code:{' '}
                                <span style={{ color: '#2563eb', fontWeight: 600 }}>
                                  {selectedItem.hsnCode}
                                </span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td
                      style={{
                        padding: '14px 16px',
                        verticalAlign: 'top',
                        borderBottom: '1px solid #e2e8f0',
                        borderRight: '1px solid #e2e8f0',
                        boxSizing: 'border-box',
                      }}
                    >
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0"
                        {...register(`lineItems.${index}.quantity`, {
                          valueAsNumber: true,
                          required: true,
                          min: 0.01,
                        })}
                        style={{
                          ...inputStyle,
                          width: '100%',
                          maxWidth: '100%',
                          boxSizing: 'border-box',
                          textAlign: 'right',
                          borderRadius: '6px',
                        }}
                      />
                    </td>
                    <td
                      style={{
                        padding: '14px 16px',
                        verticalAlign: 'top',
                        borderBottom: '1px solid #e2e8f0',
                        borderRight: '1px solid #e2e8f0',
                        boxSizing: 'border-box',
                      }}
                    >
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...register(`lineItems.${index}.rate`, {
                          valueAsNumber: true,
                          required: true,
                          min: 0,
                        })}
                        style={{
                          ...inputStyle,
                          width: '100%',
                          maxWidth: '100%',
                          boxSizing: 'border-box',
                          textAlign: 'right',
                          borderRadius: '6px',
                        }}
                      />
                    </td>
                    <td
                      style={{
                        padding: '14px 16px',
                        verticalAlign: 'top',
                        borderBottom: '1px solid #e2e8f0',
                        borderRight: '1px solid #e2e8f0',
                        boxSizing: 'border-box',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          width: '100%',
                          boxSizing: 'border-box',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          background: '#ffffff',
                        }}
                      >
                        <input
                          type="number"
                          step="0.01"
                          {...register(`lineItems.${index}.discountValue`, {
                            valueAsNumber: true,
                            min: 0,
                          })}
                          style={{
                            border: 'none',
                            outline: 'none',
                            padding: '8px 10px',
                            width: '100%',
                            minWidth: 0,
                            textAlign: 'right',
                            fontSize: '13px',
                            background: 'transparent',
                            font: 'inherit',
                            color: '#0f172a',
                            boxSizing: 'border-box',
                          }}
                          placeholder="0.00"
                        />
                        <Select
                          value={watchItems?.[index]?.discountType || 'percentage'}
                          onChange={(val) => {
                            setValue(
                              `lineItems.${index}.discountType`,
                              val as 'percentage' | 'fixed',
                            );
                          }}
                          options={[
                            { value: 'percentage', label: '%' },
                            { value: 'fixed', label: '₹' },
                          ]}
                          minWidth={50}
                          fullWidth={false}
                          containerStyle={{ flexShrink: 0, height: '100%' }}
                          buttonStyle={{
                            border: 'none',
                            borderLeft: '1px solid #eef0f3',
                            background: '#f8fafc',
                            padding: '8px 8px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#475569',
                            borderRadius: '0 6px 6px 0',
                            height: '100%',
                            gap: '4px',
                          }}
                        />
                      </div>
                    </td>
                    <td
                      style={{
                        padding: '14px 16px',
                        textAlign: 'right',
                        fontWeight: 600,
                        color: '#0f172a',
                        fontSize: '13px',
                        verticalAlign: 'top',
                        fontVariantNumeric: 'tabular-nums',
                        borderBottom: '1px solid #e2e8f0',
                        borderRight: '1px solid #e2e8f0',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        boxSizing: 'border-box',
                      }}
                    >
                      ₹{calculatedRowAmount.toFixed(2)}
                    </td>
                    <td
                      style={{
                        padding: '14px 12px',
                        textAlign: 'center',
                        verticalAlign: 'top',
                        borderBottom: '1px solid #e2e8f0',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        title="Remove item"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          padding: '6px',
                          borderRadius: '6px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
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

          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid #e2e8f0',
              background: '#ffffff',
              borderBottomLeftRadius: '8px',
              borderBottomRightRadius: '8px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <button
              type="button"
              onClick={() =>
                appendItem(
                  {
                    itemId: '',
                    quantity: '' as unknown as number,
                    rate: '' as unknown as number,
                    discountValue: '' as unknown as number,
                    discountType: 'percentage',
                    itemTotal: 0,
                  } as PurchaseOrderItem,
                  { shouldFocus: false },
                )
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                background: '#eff6ff',
                color: '#2563eb',
                border: '1px solid #bfdbfe',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: '13px',
              }}
            >
              <Plus size={15} /> Add another line
            </button>
          </div>
        </div>

        {/* Footer Notes and Totals */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '24px',
            fontSize: '13px',
          }}
        >
          <div style={{ flex: 1, maxWidth: '500px' }}>
            <label style={{ ...labelStyle, marginBottom: '8px', color: '#475569' }}>
              Customer / Vendor Notes
            </label>
            <textarea
              {...register('notes')}
              placeholder="Will be displayed on the purchase order document"
              style={{
                ...inputStyle,
                maxWidth: '100%',
                height: '90px',
                resize: 'vertical',
                borderRadius: '6px',
              }}
            />
          </div>
          <div
            style={{
              width: '320px',
              background: '#f8fafc',
              padding: '20px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '10px',
                color: '#475569',
              }}
            >
              <span>Sub Total</span>
              <span
                style={{ fontWeight: 600, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}
              >
                ₹{computedSubTotal.toFixed(2)}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '14px',
                color: '#16a34a',
              }}
            >
              <span>Total Discount</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                -₹{computedTotalDiscount.toFixed(2)}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingTop: '12px',
                borderTop: '1px solid #cbd5e1',
                fontWeight: 700,
                fontSize: '15px',
                color: '#0f172a',
              }}
            >
              <span>Total (₹)</span>
              <span style={{ color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                ₹{computedTotalAmount.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Terms & Conditions and File Upload Section */}
        <div className="form-field-grid"
          style={{
            marginTop: '32px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '24px 28px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '32px',
            position: 'relative',
          }}
        >
          {/* Terms & Conditions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', margin: 0 }}>
              Terms & Conditions
            </label>
            <textarea
              {...register('termsAndConditions')}
              placeholder="Enter terms and conditions..."
              rows={4}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                fontSize: '13px',
                color: '#0f172a',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Attach File(s) */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              borderLeft: '1px solid #e2e8f0',
              paddingLeft: '32px',
            }}
          >
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', margin: 0 }}>
              Attach File(s) to Purchase Order
            </label>
            <div>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  background: '#ffffff',
                  border: '1px dashed #cbd5e1',
                  borderRadius: '6px',
                  cursor: attachedFiles.length >= 2 || isUploadingFile ? 'not-allowed' : 'pointer',
                  opacity: isUploadingFile ? 0.7 : 1,
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#334155',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                }}
              >
                <Upload size={15} color="#64748b" />
                <span>{isUploadingFile ? 'Uploading...' : 'Upload File'}</span>
                <ChevronDown size={14} color="#94a3b8" />
                <input
                  type="file"
                  multiple
                  disabled={attachedFiles.length >= 2 || isUploadingFile}
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
              </label>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '8px' }}>
                You can upload a maximum of 2 files, 5MB each
              </div>
              {fileUploadError && (
                <div
                  style={{ fontSize: '12px', color: '#ef4444', marginTop: '6px', fontWeight: 500 }}
                >
                  {fileUploadError}
                </div>
              )}

              {/* Attached Files List */}
              {attachedFiles.length > 0 && (
                <div
                  style={{
                    marginTop: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  {attachedFiles.map((fileObj, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 12px',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        fontSize: '12px',
                        maxWidth: '360px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          overflow: 'hidden',
                        }}
                      >
                        <FileText size={14} color="#2563eb" />
                        <span
                          style={{
                            fontWeight: 500,
                            color: '#1e293b',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {fileObj.name}
                        </span>
                        <span style={{ color: '#94a3b8', fontSize: '11px', flexShrink: 0 }}>
                          ({((fileObj.size || 0) / (1024 * 1024)).toFixed(2)} MB)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(idx)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ef4444',
                          cursor: 'pointer',
                          padding: '2px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Remove file"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </form>
      </div>

      {/* Fixed Bottom Action Bar */}
      <div className="form-actions-footer page-footer">
        <button
          form="create-po-form"
          type="submit"
          disabled={mutation.isPending}
          style={{
            padding: '6px 20px',
            background: '#0062ff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '13px',
          }}
        >
          {mutation.isPending ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
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
            color: '#333',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '13px',
          }}
        >
          Cancel
        </button>
      </div>

      <PurchaseOrderNumberConfigModal
        isOpen={isNumberConfigOpen}
        onClose={() => setIsNumberConfigOpen(false)}
        initialPrefix={preference?.prefix || poPrefix}
        initialNextNumber={
          preference?.nextNumber !== undefined
            ? preference.nextNumber.toString().padStart(5, '0')
            : watch('poNumber')
              ? watch('poNumber').replace(poPrefix, '')
              : '00001'
        }
        onSave={(newPrefix, newNextNumberStr) => {
          const parsed = parseInt(newNextNumberStr, 10);
          updatePreferenceMutation.mutate({
            prefix: newPrefix,
            nextNumber: isNaN(parsed) ? 1 : parsed,
          });
        }}
      />

      <PaymentTermModal
        orgId={orgId!}
        isOpen={isPaymentTermModalOpen}
        onClose={() => setIsPaymentTermModalOpen(false)}
        onSuccess={(newTerm) => {
          setValue('paymentTerms', newTerm.id);
          setIsPaymentTermModalOpen(false);
        }}
      />

      <DeliveryAddressModal
        isOpen={isDeliveryAddressModalOpen}
        onClose={() => setIsDeliveryAddressModalOpen(false)}
        deliveryType={watchDeliveryType || 'Location'}
        locations={locations}
        customers={customers}
        selectedLocationId={watchDeliveryLocationId || undefined}
        selectedCustomerId={watchDeliveryCustomerId || undefined}
        onSelectLocation={(locId) => setValue('deliveryLocationId', locId)}
        onSelectCustomer={(custId) => setValue('deliveryCustomerId', custId)}
      />
      <CreateVendorModal
        isOpen={isVendorModalOpen}
        onClose={() => setIsVendorModalOpen(false)}
        onSuccess={(vendorId) => {
          setValue('vendorId', vendorId, { shouldValidate: true });
        }}
      />
      <CreateItemModal
        isOpen={itemModalIndex !== null}
        onClose={() => setItemModalIndex(null)}
        onSuccess={(itemId) => {
          if (itemModalIndex !== null) {
            setValue(`lineItems.${itemModalIndex}.itemId`, itemId, { shouldValidate: true });

            // Note: Normally we'd fetch the item's cost here to populate rate.
            // The SearchableSelect's onChange isn't triggered manually by setValue,
            // but the user can adjust the rate themselves or we can rely on subsequent renders.
          }
        }}
      />

      {/* Multi-Select Item Modal */}
      <MultiSelectItemModal
        isOpen={isMultiSelectItemModalOpen}
        onClose={() => {
          setIsMultiSelectItemModalOpen(false);
          setMultiSelectTargetIndex(null);
        }}
        orgId={orgId!}
        onAddNewItem={() => {
          setItemModalIndex(multiSelectTargetIndex !== null ? multiSelectTargetIndex : 0);
        }}
        onAssign={(selectedItems) => {
          if (selectedItems.length === 0 || multiSelectTargetIndex === null) return;

          const targetIndex = multiSelectTargetIndex;
          const currentItems = watch('lineItems');

          selectedItems.forEach((item, i) => {
            const isFirst = i === 0;
            const targetRow = currentItems?.[targetIndex];
            const isEmptyRow = !targetRow?.itemId;

            const qty = item._quantity ?? 1;
            const rate = item._rate ?? (item.costPrice || item.sellingPrice || '');
            const disc = item._discount ?? '';

            if (isFirst && isEmptyRow) {
              setValue(`lineItems.${targetIndex}.itemId`, item.id, { shouldValidate: true });
              setValue(`lineItems.${targetIndex}.item`, item);
              setValue(`lineItems.${targetIndex}.rate`, rate as unknown as number);
              setValue(`lineItems.${targetIndex}.quantity`, qty as unknown as number);
              setValue(`lineItems.${targetIndex}.discountValue`, disc as unknown as number);
              setValue(`lineItems.${targetIndex}.discountType`, item._discountType ?? 'percentage');
              setValue(
                `lineItems.${targetIndex}.description`,
                item.purchaseDescription ||
                  item.purchaseDescription ||
                  item.salesDescription ||
                  item.salesDescription ||
                  '',
              );
            } else {
              appendItem(
                {
                  itemId: item.id,
                  item: item,
                  quantity: qty as unknown as number,
                  rate: rate as unknown as number,
                  description:
                    item.purchaseDescription ||
                    item.purchaseDescription ||
                    item.salesDescription ||
                    item.salesDescription ||
                    '',
                  discountValue: disc as unknown as number,
                  discountType: item._discountType ?? 'percentage',
                  itemTotal: 0,
                } as PurchaseOrderItem,
                { shouldFocus: false },
              );
            }
          });

          setIsMultiSelectItemModalOpen(false);
          setMultiSelectTargetIndex(null);
        }}
      />
    </div>
  );
}
