/* eslint-disable @typescript-eslint/naming-convention */
import { useEffect, useState } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AxiosError } from 'axios';
import {
  Plus,
  Trash2,
  Settings,
  Mail,
  Phone,
  PlusCircle,
  Image,
  Upload,
  ChevronDown,
  FileText,
  X,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MultiSelectItemModal } from '../../items/components/MultiSelectItemModal';
import { ItemComboBox } from '../../../components/ui/ItemComboBox';
import { Select } from '../../../components/ui/Select';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { itemsApi } from '../../items/items.api';
import type { ItemOpeningStockLocationRowDto } from '../../items/items.schemas';
import type { CreateBillData, BillItem } from './bills.schemas';
import {
  createBill,
  fetchBillById,
  updateBill,
  fetchLocations,
  uploadBillAttachments,
  fetchBillNumberPreference,
  updateBillNumberPreference,
  type BillAttachment,
} from './bills.api';
import { fetchPurchaseOrderById } from '../purchase-orders/purchase-orders.api';
import type { PurchaseOrderItem } from '../purchase-orders/purchase-orders.schemas';
import { fetchPaymentTerms } from '../../sales/customers/payment-terms.api';
import { fetchVendors } from '../vendors/vendors.api';
import type { Location } from '../../configuration/locations/locations.api';
import { fetchCustomers } from '../../sales/customers/customers.api';
import { BillNumberConfigModal } from './BillNumberConfigModal';
import { DeliveryAddressModal } from './DeliveryAddressModal';
import { CreateVendorModal } from '../vendors/CreateVendorModal';
import { PaymentTermModal } from '../../sales/customers/PaymentTermModal';
import { CreateItemModal } from '../../items/CreateItemModal';
import { AddBillBatchesModal } from './AddBillBatchesModal';
import { WarehouseLocationsPopover } from './components/WarehouseLocationsPopover';
import { LineItemStockDisplay } from './components/LineItemStockDisplay';

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

export function CreateBill() {
  const navigate = useNavigate();
  const { orgId, id } = useParams<{ orgId: string; id?: string }>();
  const [searchParams] = useSearchParams();
  const cloneFrom = searchParams.get('cloneFrom');
  const fromPo = searchParams.get('fromPo');
  const queryClient = useQueryClient();

  const poIdToFetch = id || cloneFrom;
  const isEdit = Boolean(id);
  const isClone = Boolean(cloneFrom);
  const isFromPo = Boolean(fromPo);

  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [itemModalIndex, setItemModalIndex] = useState<number | null>(null);
  const [isMultiSelectItemModalOpen, setIsMultiSelectItemModalOpen] = useState(false);
  const [multiSelectTargetIndex, setMultiSelectTargetIndex] = useState<number | null>(null);
  const [batchModalIndex, setBatchModalIndex] = useState<number | null>(null);

  // Stock Popover State
  const [stockPopoverAnchor, setStockPopoverAnchor] = useState<{
    element: HTMLElement;
    stockRows: ItemOpeningStockLocationRowDto[];
  } | null>(null);

  const { data: existingPo, isLoading: isFetchingBill } = useQuery({
    queryKey: ['bill', orgId, poIdToFetch],
    queryFn: () => fetchBillById(orgId!, poIdToFetch!),
    enabled: Boolean(orgId && poIdToFetch),
  });

  const { data: sourcePo } = useQuery({
    queryKey: ['purchaseOrder', orgId, fromPo],
    queryFn: () => fetchPurchaseOrderById(orgId!, fromPo!),
    enabled: Boolean(orgId && fromPo),
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

  const { data: paymentTerms = [] } = useQuery({
    queryKey: ['payment-terms', orgId],
    queryFn: () => fetchPaymentTerms(orgId!),
    enabled: Boolean(orgId),
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
  } = useForm<CreateBillData>({
    defaultValues: {
      status: 'Draft',
      bill_date: new Date().toISOString().split('T')[0],
      delivery_type: 'Location',
      line_items: [
        {
          item_id: '',
          quantity: '' as unknown as number,
          rate: '' as unknown as number,
          discountValue: '' as unknown as number,
          discountType: 'percentage',
          amount: 0,
        } as BillItem,
      ],
      sub_total: 0,
      total_amount: 0,
    },
  });

  useEffect(() => {
    if (existingPo) {
      const formattedLineItems = (existingPo.line_items || []).map((item) => {
        const discountVal =
          item.discountValue !== undefined && item.discountValue !== null
            ? item.discountValue
            : item.discount_percentage || 0;
        return {
          item_id: item.item_id,
          item: item.item,
          quantity: item.quantity || ('' as unknown as number),
          rate: item.rate || ('' as unknown as number),
          discountValue: discountVal || ('' as unknown as number),
          discountType: item.discountType || (item.discount_percentage ? 'percentage' : 'fixed'),
          amount: item.amount || 0,
        };
      });

      const resetData: CreateBillData = {
        vendor_id: existingPo.vendor_id || '',
        location_id: existingPo.location_id || '',
        payment_terms: existingPo.payment_terms || '',
        bill_number: isClone ? '' : existingPo.bill_number || '',
        bill_date: isClone
          ? new Date().toISOString().split('T')[0]
          : existingPo.bill_date
            ? new Date(existingPo.bill_date).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
        due_date: existingPo.due_date
          ? new Date(existingPo.due_date).toISOString().split('T')[0]
          : '',
        delivery_type: existingPo.delivery_type || 'Location',
        delivery_location_id: existingPo.delivery_location_id || '',
        delivery_customer_id: existingPo.delivery_customer_id || '',
        terms_and_conditions: existingPo.terms_and_conditions || '',
        status: isClone ? 'Draft' : existingPo.status || 'Draft',
        custom_fields: existingPo.custom_fields || {},
        line_items:
          formattedLineItems.length > 0
            ? (formattedLineItems as unknown as BillItem[])
            : [
                {
                  item_id: '',
                  quantity: '' as unknown as number,
                  rate: '' as unknown as number,
                  discountValue: '' as unknown as number,
                  discountType: 'percentage',
                  item_total: 0,
                } as BillItem,
              ],
        sub_total: Number(existingPo.sub_total) || 0,
        total_amount: Number(existingPo.total_amount) || 0,
      };

      if (existingPo.bill_number && !isClone) {
        resetData.bill_number = existingPo.bill_number;
      }

      reset(resetData);

      if (existingPo.attachments && Array.isArray(existingPo.attachments)) {
        setAttachedFiles(existingPo.attachments);
      }
    }
  }, [existingPo, isClone, reset]);

  useEffect(() => {
    if (sourcePo && isFromPo) {
      const formattedLineItems = (sourcePo.line_items || []).map((item: PurchaseOrderItem) => {
        const discountVal =
          item.discountValue !== undefined && item.discountValue !== null
            ? item.discountValue
            : item.discount_percentage || 0;
        return {
          item_id: item.item_id,
          item: item.item,
          quantity: item.quantity || ('' as unknown as number),
          rate: item.rate || ('' as unknown as number),
          discountValue: discountVal || ('' as unknown as number),
          discountType: item.discountType || (item.discount_percentage ? 'percentage' : 'fixed'),
          amount: item.item_total || 0,
          from_po: true,
        };
      });

      const resetData: CreateBillData = {
        vendor_id: sourcePo.vendor_id || '',
        location_id: sourcePo.location_id || '',
        payment_terms: sourcePo.payment_terms || '',
        bill_number: '',
        bill_date: new Date().toISOString().split('T')[0],
        due_date: sourcePo.delivery_date
          ? new Date(sourcePo.delivery_date).toISOString().split('T')[0]
          : '',
        delivery_type: (sourcePo.delivery_type as 'Location' | 'Customer') || 'Location',
        delivery_location_id: sourcePo.delivery_location_id || '',
        delivery_customer_id: sourcePo.delivery_customer_id || '',
        terms_and_conditions: sourcePo.terms || '',
        status: 'Draft',
        custom_fields: sourcePo.custom_fields || {},
        line_items:
          formattedLineItems.length > 0
            ? (formattedLineItems as unknown as BillItem[])
            : [
                {
                  item_id: '',
                  quantity: '' as unknown as number,
                  rate: '' as unknown as number,
                  discountValue: '' as unknown as number,
                  discountType: 'percentage',
                  item_total: 0,
                } as BillItem,
              ],
        sub_total: Number(sourcePo.sub_total) || 0,
        total_amount: Number(sourcePo.total) || 0,
      };

      reset(resetData);
    }
  }, [sourcePo, isFromPo, reset]);

  const {
    fields: itemFields,
    append: appendItem,
    remove: removeItem,
  } = useFieldArray({
    control,
    name: 'line_items',
  });

  const watchItems = useWatch({ control, name: 'line_items' });
  const watchDeliveryType = watch('delivery_type');
  const watchDeliveryLocationId = watch('delivery_location_id');
  const watchDeliveryCustomerId = watch('delivery_customer_id');
  const watchLocationId = watch('location_id');
  const watchPoDate = watch('bill_date');
  const watchPaymentTerms = watch('payment_terms');

  useEffect(() => {
    if (watchPoDate && watchPaymentTerms && paymentTerms) {
      const term = paymentTerms.find((pt) => pt.id.toString() === watchPaymentTerms);
      if (term && term.dueAfterDays !== undefined && term.dueAfterDays !== null) {
        const d = new Date(watchPoDate);
        d.setDate(d.getDate() + term.dueAfterDays);
        setValue('due_date', d.toISOString().split('T')[0], {
          shouldValidate: true,
          shouldDirty: true,
        });
      }
    }
  }, [watchPoDate, watchPaymentTerms, paymentTerms, setValue]);

  const [poPrefix, setPoPrefix] = useState('PO-');
  const [isNumberConfigOpen, setIsNumberConfigOpen] = useState(false);

  const [isDeliveryAddressModalOpen, setIsDeliveryAddressModalOpen] = useState(false);
  const [isPaymentTermModalOpen, setIsPaymentTermModalOpen] = useState(false);
  const [customDeliveryName, setCustomDeliveryName] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<BillAttachment[]>([]);
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
      const uploadedAttachments = await uploadBillAttachments(orgId!, formData);
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

  useEffect(() => {
    setCustomDeliveryName('');
  }, [watchDeliveryLocationId, watchDeliveryCustomerId, watchDeliveryType]);

  useEffect(() => {
    if (locations.length > 0) {
      const defaultLocation =
        locations.find((l: Location) => l.isPrimary) ||
        locations.find((l: Location) => !l.parentId);
      if (defaultLocation) {
        if (!watchLocationId) {
          setValue('location_id', defaultLocation.id);
        }
        if (!watchDeliveryLocationId && watchDeliveryType === 'Location') {
          setValue('delivery_location_id', defaultLocation.id);
        }
      }
    }
  }, [locations, watchLocationId, watchDeliveryLocationId, watchDeliveryType, setValue]);

  let computedSubTotal = 0;
  let computedTotalDiscount = 0;
  (watchItems || []).forEach((item: BillItem) => {
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
    setValue('sub_total', computedSubTotal);
    setValue('total_amount', computedTotalAmount);
  }, [computedSubTotal, computedTotalAmount, setValue]);

  const { data: preference } = useQuery({
    queryKey: ['po-number-preference', orgId],
    queryFn: () => fetchBillNumberPreference(orgId!),
    enabled: !!orgId,
  });

  const [lastPrefilledNumber, setLastPrefilledNumber] = useState('');

  useEffect(() => {
    if (preference && !isEdit) {
      const generatedNumber = `${preference.prefix}${preference.nextNumber.toString().padStart(5, '0')}`;
      const currentValue = watch('bill_number');

      if (!currentValue || currentValue === lastPrefilledNumber) {
        setValue('bill_number', generatedNumber);
        setLastPrefilledNumber(generatedNumber);
        setPoPrefix(preference.prefix);
      }
    }
  }, [preference, setValue, watch, lastPrefilledNumber, isEdit]);

  const updatePreferenceMutation = useMutation({
    mutationFn: (data: { prefix: string; nextNumber: number }) =>
      updateBillNumberPreference(orgId!, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['po-number-preference', orgId], data);
      setValue('bill_number', `${data.prefix}${data.nextNumber.toString().padStart(5, '0')}`);
      setPoPrefix(data.prefix);
      setIsNumberConfigOpen(false);
    },
  });

  const mutation = useMutation({
    mutationFn: (data: CreateBillData) => {
      if (isEdit && id) {
        return updateBill({ orgId: orgId!, id, data });
      }
      return createBill(orgId!, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills', orgId] });
      if (id) {
        queryClient.invalidateQueries({ queryKey: ['bill', orgId, id] });
      }
      if (fromPo) {
        queryClient.invalidateQueries({ queryKey: ['purchaseOrder', orgId, fromPo] });
        queryClient.invalidateQueries({ queryKey: ['purchaseOrders', orgId] });
      }
      queryClient.invalidateQueries({ queryKey: ['po-number-preference', orgId] });
      navigate(`/organizations/${orgId}/purchases/bills${isEdit && id ? `?id=${id}` : ''}`);
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      console.error(
        error.response?.data?.message ||
          error.message ||
          `Failed to ${isEdit ? 'update' : 'create'} Bill`,
      );
    },
  });

  const onSubmit = (data: CreateBillData) => {
    const finalItems = (data.line_items || []).map((item) => {
      const qty = isNaN(Number(item?.quantity)) ? 0 : Number(item?.quantity);
      const rate = isNaN(Number(item?.rate)) ? 0 : Number(item?.rate);
      const basePrice = qty * rate;
      const discountVal = isNaN(Number(item?.discountValue)) ? 0 : Number(item?.discountValue);
      const discType = item?.discountType || 'percentage';
      const discountAmount =
        discType === 'percentage' ? (basePrice * discountVal) / 100 : discountVal;
      const item_total = Math.max(0, basePrice - discountAmount);
      return {
        ...item,
        quantity: qty,
        rate: rate,
        amount: item_total,
        item_total: item_total,
        discount: discountAmount,
        discount_amount: discountAmount,
        discount_percentage: discType === 'percentage' ? discountVal : null,
      };
    });

    const finalData = {
      ...data,
      source_po_id: isFromPo ? fromPo : null,
      delivery_customer_id: data.delivery_customer_id || null,
      delivery_location_id: data.delivery_location_id || null,
      due_date: data.due_date || null,
      terms_and_conditions: data.terms_and_conditions || null,
      line_items: finalItems,
      sub_total: computedSubTotal,
      total_amount: computedTotalAmount,
      attachments: attachedFiles,
      custom_fields: {
        ...data.custom_fields,
        ...(customDeliveryName ? { customDeliveryName } : {}),
      },
    };
    console.log('Submitting Bill data:', finalData);
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

  if (isFetchingBill) {
    return (
      <div style={{ padding: '64px', textAlign: 'center', color: '#64748b' }}>
        Loading Bill details...
      </div>
    );
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
      {/* Header */}
      <div style={{ padding: '24px 32px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 400, margin: 0, color: '#000' }}>
          {isEdit
            ? `Edit Bill (${existingPo?.bill_number || ''})`
            : isClone
              ? 'Clone Bill'
              : 'New Bill'}
        </h1>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit, (errs) => console.log('Validation errors:', errs))}
        style={{ padding: '32px' }}
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
          <div
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
              <input type="hidden" {...register('vendor_id', { required: true })} />
              <SearchableSelect
                options={vendors.map((v) => ({ label: v.contactName, value: v.id }))}
                value={watch('vendor_id') || undefined}
                onChange={(val) => setValue('vendor_id', val, { shouldValidate: true })}
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
              {errors.vendor_id && (
                <div style={{ color: '#e54d4d', fontSize: '12px', marginTop: '4px' }}>
                  Vendor Name is required
                </div>
              )}
            </div>

            <label style={labelStyle}>Location</label>
            <SearchableSelect
              options={locations.map((l: Location) => ({ label: l.name, value: l.id }))}
              value={watch('location_id') || undefined}
              onChange={(val) => setValue('location_id', val)}
              placeholder="Select Location"
              footerAction={{
                text: 'New Location',
                icon: <PlusCircle size={16} />,
                onClick: () => navigate(`/organizations/${orgId}/settings/locations/new`),
              }}
              style={searchableSelectStyle}
            />

            <label style={{ ...labelStyle, color: '#ef4444' }}>Bill#*</label>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '440px' }}>
                <input
                  type="text"
                  {...register('bill_number', { required: true })}
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
              {errors.bill_number && (
                <div style={{ color: '#e54d4d', fontSize: '12px', marginTop: '4px' }}>
                  Bill# is required
                </div>
              )}
            </div>

            <label style={{ ...labelStyle, color: '#ef4444' }}>Date*</label>
            <div style={{ position: 'relative', width: '100%', maxWidth: '440px' }}>
              <input
                type="date"
                {...register('bill_date', {
                  required: 'Date is required',
                  onChange: () => {
                    if (watch('due_date')) {
                      trigger('due_date');
                    }
                  },
                })}
                className="date-input-no-icon"
                onClick={(e) => (e.target as HTMLInputElement).showPicker()}
                style={{ ...inputStyle, maxWidth: '100%' }}
              />
            </div>

            <label style={labelStyle}>Payment Terms</label>
            <SearchableSelect
              options={
                paymentTerms?.map((pt) => ({ label: pt.termName, value: pt.id.toString() })) || []
              }
              value={watch('payment_terms') || undefined}
              onChange={(val) => setValue('payment_terms', val)}
              placeholder="Select Payment Terms"
              footerAction={{
                text: 'New Payment Term',
                icon: <PlusCircle size={16} />,
                onClick: () => setIsPaymentTermModalOpen(true),
              }}
              style={searchableSelectStyle}
            />

            <label style={labelStyle}>Delivery Date</label>
            <div style={{ position: 'relative', width: '100%', maxWidth: '440px' }}>
              <input
                type="date"
                min={watchPoDate}
                {...register('due_date', {
                  validate: (val) => {
                    if (!val || !watchPoDate) return true;
                    return val >= watchPoDate || 'Delivery date must be on or after Bill Date';
                  },
                })}
                className="date-input-no-icon"
                onClick={(e) => (e.target as HTMLInputElement).showPicker()}
                style={{ ...inputStyle, maxWidth: '100%' }}
              />
              {errors.due_date && (
                <div style={{ color: '#e54d4d', fontSize: '12px', marginTop: '4px' }}>
                  {errors.due_date.message || 'Delivery date must be on or after Bill Date'}
                </div>
              )}
            </div>
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
                          {(curItem as { from_po?: boolean })?.from_po ? (
                            <div
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                fontSize: '13px',
                                border: '1px solid #d1d5db',
                                borderRadius: '4px',
                                background: '#f8fafc',
                                color: '#475569',
                                boxSizing: 'border-box',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              title={selectedItem?.name}
                            >
                              {selectedItem?.name || 'Unknown Item'}
                            </div>
                          ) : (
                            <ItemComboBox
                              orgId={orgId!}
                              value={watchItems?.[index]?.item_id}
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
                                setValue(`line_items.${index}.item_id`, val?.id || '', {
                                  shouldValidate: true,
                                });
                                setValue(`line_items.${index}.item`, val);
                                const selected = val;
                                if (selected) {
                                  setValue(
                                    `line_items.${index}.rate`,
                                    (selected.costPrice ||
                                      selected.sellingPrice ||
                                      '') as unknown as number,
                                  );
                                  setValue(`line_items.${index}.quantity`, 1 as unknown as number);
                                  setValue(
                                    `line_items.${index}.description`,
                                    selected.purchaseDescription ||
                                      selected.purchase_description ||
                                      selected.salesDescription ||
                                      selected.sales_description ||
                                      '',
                                  );
                                } else {
                                  setValue(`line_items.${index}.rate`, '' as unknown as number);
                                  setValue(`line_items.${index}.quantity`, '' as unknown as number);
                                  setValue(
                                    `line_items.${index}.discountValue`,
                                    '' as unknown as number,
                                  );
                                  setValue(`line_items.${index}.discountType`, 'percentage');
                                  setValue(`line_items.${index}.description`, '');
                                }
                              }}
                              placeholder="Type or click to select an item."
                              footerAction={{
                                text: 'New Product',
                                onClick: () => setItemModalIndex(index),
                              }}
                            />
                          )}
                        </div>

                        {/* Description Field - only shown when an item is selected */}
                        {selectedItem && (
                          <textarea
                            {...register(`line_items.${index}.description`)}
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
                        {...register(`line_items.${index}.quantity`, {
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
                      {/* Stock Display (above batch button) */}
                      {selectedItem && (
                        <div style={{ marginTop: '6px' }}>
                          <LineItemStockDisplay
                            orgId={orgId!}
                            itemId={selectedItem.id}
                            deliveryLocationId={watchLocationId || watchDeliveryLocationId}
                            locations={locations}
                            onClick={(e, rows) =>
                              setStockPopoverAnchor({ element: e.currentTarget, stockRows: rows })
                            }
                          />
                        </div>
                      )}

                      {selectedItem?.trackInventory &&
                        selectedItem?.inventoryTracking === 'batch' && (
                          <div style={{ marginTop: '6px', textAlign: 'right' }}>
                            <button
                              type="button"
                              onClick={() => setBatchModalIndex(index)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#2563eb',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                padding: '2px 4px',
                              }}
                            >
                              {curItem.batches?.length
                                ? `${curItem.batches.length} Batches Added`
                                : '+ Add Batches'}
                            </button>
                          </div>
                        )}
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
                        {...register(`line_items.${index}.rate`, {
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
                          {...register(`line_items.${index}.discountValue`, {
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
                              `line_items.${index}.discountType`,
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
                    item_id: '',
                    quantity: '' as unknown as number,
                    rate: '' as unknown as number,
                    discountValue: '' as unknown as number,
                    discountType: 'percentage',
                    item_total: 0,
                  } as BillItem,
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
          <div style={{ flex: 1, maxWidth: '500px' }}></div>
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
        <div
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
              {...register('terms_and_conditions')}
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
              Attach File(s) to Bill
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

        {/* Fixed Bottom Action Bar */}
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
            borderTop: '1px solid #eef0f3',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            zIndex: 100,
          }}
        >
          <button
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
            onClick={() => navigate(-1)}
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
      </form>

      <BillNumberConfigModal
        isOpen={isNumberConfigOpen}
        onClose={() => setIsNumberConfigOpen(false)}
        initialPrefix={preference?.prefix || poPrefix}
        initialNextNumber={
          preference?.nextNumber !== undefined
            ? preference.nextNumber.toString().padStart(5, '0')
            : watch('bill_number')
              ? watch('bill_number').replace(poPrefix, '')
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

      <DeliveryAddressModal
        isOpen={isDeliveryAddressModalOpen}
        onClose={() => setIsDeliveryAddressModalOpen(false)}
        deliveryType={watchDeliveryType || 'Location'}
        locations={locations}
        customers={customers}
        selectedLocationId={watchDeliveryLocationId || undefined}
        selectedCustomerId={watchDeliveryCustomerId || undefined}
        onSelectLocation={(locId) => setValue('delivery_location_id', locId)}
        onSelectCustomer={(custId) => setValue('delivery_customer_id', custId)}
      />
      <CreateVendorModal
        isOpen={isVendorModalOpen}
        onClose={() => setIsVendorModalOpen(false)}
        onSuccess={(vendorId) => {
          setValue('vendor_id', vendorId, { shouldValidate: true });
        }}
      />

      <PaymentTermModal
        orgId={orgId!}
        isOpen={isPaymentTermModalOpen}
        onClose={() => setIsPaymentTermModalOpen(false)}
        onSuccess={(newTerm) => {
          setValue('payment_terms', newTerm.id, { shouldValidate: true });
          setIsPaymentTermModalOpen(false);
        }}
      />
      <CreateItemModal
        isOpen={itemModalIndex !== null}
        onClose={() => setItemModalIndex(null)}
        onSuccess={(itemId) => {
          if (itemModalIndex !== null) {
            setValue(`line_items.${itemModalIndex}.item_id`, itemId, { shouldValidate: true });

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
          const currentItems = watch('line_items');

          selectedItems.forEach((item, i) => {
            const isFirst = i === 0;
            const targetRow = currentItems?.[targetIndex];
            const isEmptyRow = !targetRow?.item_id;

            const qty = item._quantity ?? 1;
            const rate = item._rate ?? (item.costPrice || item.sellingPrice || '');
            const disc = item._discount ?? '';

            if (isFirst && isEmptyRow) {
              setValue(`line_items.${targetIndex}.item_id`, item.id, { shouldValidate: true });
              setValue(`line_items.${targetIndex}.item`, item);
              setValue(`line_items.${targetIndex}.rate`, rate as unknown as number);
              setValue(`line_items.${targetIndex}.quantity`, qty as unknown as number);
              setValue(`line_items.${targetIndex}.discountValue`, disc as unknown as number);
              setValue(
                `line_items.${targetIndex}.discountType`,
                item._discountType ?? 'percentage',
              );
              setValue(
                `line_items.${targetIndex}.description`,
                item.purchaseDescription ||
                  item.purchase_description ||
                  item.salesDescription ||
                  item.sales_description ||
                  '',
              );
            } else {
              appendItem(
                {
                  item_id: item.id,
                  item: item,
                  quantity: qty as unknown as number,
                  rate: rate as unknown as number,
                  description:
                    item.purchaseDescription ||
                    item.purchase_description ||
                    item.salesDescription ||
                    item.sales_description ||
                    '',
                  discountValue: disc as unknown as number,
                  discountType: item._discountType ?? 'percentage',
                  item_total: 0,
                } as BillItem,
                { shouldFocus: false },
              );
            }
          });

          setIsMultiSelectItemModalOpen(false);
          setMultiSelectTargetIndex(null);
        }}
      />

      {/* Bill Batches Modal */}
      {batchModalIndex !== null && watchItems?.[batchModalIndex]?.item && (
        <AddBillBatchesModal
          orgId={orgId!}
          itemId={watchItems[batchModalIndex].item?.id}
          isOpen={true}
          onClose={() => setBatchModalIndex(null)}
          itemName={watchItems[batchModalIndex].item?.name || 'Unknown Item'}
          sku={watchItems[batchModalIndex].item?.sku}
          uomLabel={
            watchItems[batchModalIndex].item?.stockingUom?.code ||
            watchItems[batchModalIndex].item?.stocking_uom?.code ||
            'pcs'
          }
          locationId={watchLocationId || watchDeliveryLocationId}
          locationName={
            locations.find((l: Location) => l.id === (watchLocationId || watchDeliveryLocationId))
              ?.name || (watchDeliveryType !== 'Location' ? 'Customer Location' : null)
          }
          lineQty={Number(watchItems[batchModalIndex].quantity) || 0}
          initialBatches={watchItems[batchModalIndex].batches || []}
          defaultSellingPrice={
            watchItems[batchModalIndex].item?.sellingPrice
              ? String(watchItems[batchModalIndex].item?.sellingPrice)
              : ''
          }
          defaultMrp={''}
          onSave={(batches, overwriteQty) => {
            const mappedBatches = batches.map((b) => ({
              ...b,
              manufacturedDate: b.manufacturedDate ? String(b.manufacturedDate) : undefined,
              expiryDate: b.expiryDate ? String(b.expiryDate) : undefined,
            }));
            setValue(
              `line_items.${batchModalIndex}.batches`,
              mappedBatches as BillItem['batches'],
              { shouldValidate: true },
            );
            if (overwriteQty !== null) {
              setValue(
                `line_items.${batchModalIndex}.quantity`,
                overwriteQty as unknown as number,
                { shouldValidate: true },
              );
            }
          }}
        />
      )}

      {/* Warehouse Locations Popover */}
      <WarehouseLocationsPopover
        isOpen={!!stockPopoverAnchor}
        onClose={() => setStockPopoverAnchor(null)}
        anchorEl={stockPopoverAnchor?.element || null}
        locations={locations}
        stockRows={stockPopoverAnchor?.stockRows || []}
        selectedLocationId={watchLocationId || watchDeliveryLocationId}
      />
    </div>
  );
}
