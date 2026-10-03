import { useEffect, useState, useRef } from 'react';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { AxiosError } from 'axios';
import {
  Plus,
  Pencil,
  Settings,
  Mail,
  Phone,
  PlusCircle,
  Check,
  Image,
  Upload,
  ChevronDown,
  ChevronUp,
  Calculator,
  CheckCircle2,
  FileText,
  X,
  Search,
  ArrowLeft,
  Info,
} from 'lucide-react';
import { PurchaseOrderStatusBadge } from './PurchaseOrderStatusBadge';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { organizationsApi } from '../../organizations/organizations.api';
import { fetchPaymentTerms } from './payment-terms.api';
import { MultiSelectItemModal } from '../../items/components/MultiSelectItemModal';
import { DateInput } from '../../../components/ui/DateInput';
import { ItemComboBox } from '../../../components/ui/ItemComboBox';
import { Select } from '../../../components/ui/Select';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { formatDate } from '../../../lib/formatDate';
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
import { isOwnLocation, type Location } from '../../configuration/locations/locations.api';
import { fetchCustomers, type Customer } from '../../sales/customers/customers.api';
import { PurchaseOrderNumberConfigModal } from './PurchaseOrderNumberConfigModal';
import { PaymentTermModal } from '../../sales/customers/PaymentTermModal';
import { DeliveryAddressModal } from './DeliveryAddressModal';
import { CreateVendorModal } from '../vendors/CreateVendorModal';
import { CreateItemModal } from '../../items/CreateItemModal';
import './purchase-orders-v3.css';
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

  const { data: orgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
  });
  const currentOrg = orgs?.find(
    (o: { organizationId?: string; id?: string }) => o.organizationId === orgId || o.id === orgId,
  );

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
    // Ours only — a delivery address is one of our own sites. Same filter, same
    // reason, as the bill screen.
    select: (rows: Location[]) => rows.filter(isOwnLocation),
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
    getValues,
    setValue,
    reset,
    trigger,
    formState: { errors },
  } = useForm<CreatePurchaseOrderData>({
    defaultValues: {
      status: 'Draft',
      date: new Date().toISOString().split('T')[0],
      referenceNumber: '',
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
        referenceNumber: isClone
          ? ''
          : existingPo.referenceNumber ||
            ((existingPo.customFields as Record<string, unknown>)?.referenceNumber as string) ||
            '',
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

      if (existingPo.customFields && typeof existingPo.customFields === 'object') {
        const cf = existingPo.customFields as Record<string, unknown>;
        if (cf.taxPreference === 'tax_inclusive' || cf.taxPreference === 'tax_exclusive') {
          setTaxPreference(cf.taxPreference);
        }
        if (cf.discountLevel === 'line_item' || cf.discountLevel === 'transaction') {
          setDiscountLevel(cf.discountLevel);
        }
        if (cf.transactionDiscountValue !== undefined && cf.transactionDiscountValue !== null) {
          setTransactionDiscountValue(String(cf.transactionDiscountValue));
        }
        if (cf.transactionDiscountType === 'fixed' || cf.transactionDiscountType === 'percentage') {
          setTransactionDiscountType(cf.transactionDiscountType);
        }
        if (cf.reverseCharge !== undefined) {
          setIsReverseCharge(Boolean(cf.reverseCharge));
        }
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
  const [isGearTooltipOpen, setIsGearTooltipOpen] = useState(false);
  const [isPaymentTermModalOpen, setIsPaymentTermModalOpen] = useState(false);
  const [isDeliveryAddressModalOpen, setIsDeliveryAddressModalOpen] = useState(false);
  const [isEditingDeliveryName, setIsEditingDeliveryName] = useState(false);
  const [customDeliveryName, setCustomDeliveryName] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<POAttachment[]>([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);

  // Zoho Books Style Tax & Discount preferences
  const [taxPreference, setTaxPreference] = useState<'tax_exclusive' | 'tax_inclusive'>(
    'tax_exclusive',
  );
  const [discountLevel, setDiscountLevel] = useState<'transaction' | 'line_item'>('transaction');
  const [transactionDiscountValue, setTransactionDiscountValue] = useState<string>('');
  const [transactionDiscountType, setTransactionDiscountType] = useState<'percentage' | 'fixed'>(
    'percentage',
  );

  const [isTaxMenuOpen, setIsTaxMenuOpen] = useState(false);
  const [isDiscountMenuOpen, setIsDiscountMenuOpen] = useState(false);
  const [taxSearch, setTaxSearch] = useState('');
  const [discountSearch, setDiscountSearch] = useState('');

  const taxMenuRef = useRef<HTMLDivElement>(null);
  const discountMenuRef = useRef<HTMLDivElement>(null);

  const [submitStatus, setSubmitStatus] = useState<
    'Draft' | 'Issued' | 'Approved' | 'Pending Approval'
  >('Draft');

  const [isSaveMenuOpen, setIsSaveMenuOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);

  const [isReverseCharge, setIsReverseCharge] = useState(false);
  const [isBulkActionsOpen, setIsBulkActionsOpen] = useState(false);
  const [hideAdditionalInfo, setHideAdditionalInfo] = useState(false);
  const bulkActionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (taxMenuRef.current && !taxMenuRef.current.contains(event.target as Node)) {
        setIsTaxMenuOpen(false);
      }
      if (discountMenuRef.current && !discountMenuRef.current.contains(event.target as Node)) {
        setIsDiscountMenuOpen(false);
      }
      if (saveMenuRef.current && !saveMenuRef.current.contains(event.target as Node)) {
        setIsSaveMenuOpen(false);
      }
      if (bulkActionsRef.current && !bulkActionsRef.current.contains(event.target as Node)) {
        setIsBulkActionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

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
  let computedTotalQuantity = 0;

  (watchItems || []).forEach((item: PurchaseOrderItem) => {
    const qty = isNaN(Number(item?.quantity)) ? 0 : Number(item?.quantity);
    const rate = isNaN(Number(item?.rate)) ? 0 : Number(item?.rate);
    const basePrice = qty * rate;
    computedSubTotal += basePrice;
    computedTotalQuantity += qty;

    if (discountLevel === 'line_item') {
      const discountVal = isNaN(Number(item?.discountValue)) ? 0 : Number(item?.discountValue);
      const discType = item?.discountType || 'percentage';
      const discountAmount =
        discType === 'percentage' ? (basePrice * discountVal) / 100 : discountVal;
      computedTotalDiscount += discountAmount;
    }
  });

  if (discountLevel === 'transaction') {
    const tDiscVal = isNaN(Number(transactionDiscountValue)) ? 0 : Number(transactionDiscountValue);
    if (transactionDiscountType === 'percentage') {
      computedTotalDiscount = (computedSubTotal * tDiscVal) / 100;
    } else {
      computedTotalDiscount = tDiscVal;
    }
  }

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
      const currentValue = getValues('poNumber');

      if (!currentValue || currentValue === lastPrefilledNumber) {
        setValue('poNumber', generatedNumber);
        setLastPrefilledNumber(generatedNumber);
        setPoPrefix(preference.prefix);
      }
    }
  }, [preference, setValue, getValues, lastPrefilledNumber, isEdit]);

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
      status: submitStatus || data.status || 'Draft',
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
        ...(data.referenceNumber ? { referenceNumber: data.referenceNumber } : {}),
        ...(customDeliveryName ? { customDeliveryName } : {}),
        taxPreference,
        discountLevel,
        transactionDiscountValue: transactionDiscountValue ? Number(transactionDiscountValue) : 0,
        transactionDiscountType,
        reverseCharge: isReverseCharge,
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
    color: '#4b5563',
    fontWeight: 500,
    fontSize: 13,
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
      {isEdit ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 24px',
            background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
            borderBottom: '1px solid #e2e8f0',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <button
              type="button"
              onClick={() =>
                navigate(
                  (location.state as { returnUrl?: string })?.returnUrl ||
                    `/organizations/${orgId}/purchases/purchase-orders?id=${id}`,
                )
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 34,
                height: 34,
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                background: '#fff',
                color: '#64748b',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f1f5f9';
                e.currentTarget.style.color = '#0284c7';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#fff';
                e.currentTarget.style.color = '#64748b';
              }}
              title="Back"
            >
              <ArrowLeft size={17} />
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    background: '#e0f2fe',
                    color: '#0284c7',
                    padding: '2px 8px',
                    borderRadius: 12,
                  }}
                >
                  Edit Mode
                </span>
                <h1
                  style={{
                    fontSize: 19,
                    fontWeight: 700,
                    margin: 0,
                    color: '#0f172a',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {existingPo?.poNumber || 'Purchase Order'}
                </h1>
                {existingPo?.status && (
                  <PurchaseOrderStatusBadge status={existingPo.status} size="sm" />
                )}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: '#64748b',
                  marginTop: 3,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <span>
                  Vendor:{' '}
                  <strong style={{ color: '#1e293b' }}>
                    {existingPo?.vendor?.contactName || existingPo?.vendor?.companyName || 'Vendor'}
                  </strong>
                </span>
                <span>•</span>
                <span>
                  Date: <strong style={{ color: '#1e293b' }}>{formatDate(existingPo?.date)}</strong>
                </span>
                <span>•</span>
                <span>
                  Current Total:{' '}
                  <strong style={{ color: '#0284c7' }}>
                    ₹
                    {computedTotalAmount.toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() =>
                navigate(
                  (location.state as { returnUrl?: string })?.returnUrl ||
                    `/organizations/${orgId}/purchases/purchase-orders?id=${id}`,
                )
              }
              style={{
                padding: '7px 16px',
                background: '#fff',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                color: '#475569',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f8fafc';
                e.currentTarget.style.color = '#0f172a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#fff';
                e.currentTarget.style.color = '#475569';
              }}
            >
              Cancel
            </button>
            <button
              form="create-po-form"
              type="submit"
              onClick={() =>
                setSubmitStatus(
                  (existingPo?.status as 'Draft' | 'Issued' | 'Approved' | 'Pending Approval') ||
                    'Draft',
                )
              }
              disabled={mutation.isPending}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 18px',
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: mutation.isPending ? 'not-allowed' : 'pointer',
                boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!mutation.isPending) {
                  e.currentTarget.style.boxShadow = '0 4px 10px rgba(2, 132, 199, 0.35)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!mutation.isPending) {
                  e.currentTarget.style.boxShadow = '0 2px 6px rgba(2, 132, 199, 0.25)';
                  e.currentTarget.style.transform = 'none';
                }
              }}
            >
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      ) : (
        <div className="po-v3-header" style={{ padding: '16px 24px' }}>
          <div className="po-v3-title-area">
            <div className="po-v3-icon-badge">
              <FileText size={20} />
            </div>
            <div>
              <h1 className="po-v3-title">
                {isClone ? 'Clone Purchase Order' : 'New Purchase Order'}
              </h1>
              <p className="po-v3-subtitle">
                Create and issue procurement orders to your suppliers and vendors
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              navigate(
                (location.state as { returnUrl?: string })?.returnUrl ||
                  `/organizations/${orgId}/purchases/purchase-orders`,
              )
            }
            className="po-v3-btn-secondary"
            title="Cancel and return"
          >
            <X size={16} /> Cancel
          </button>
        </div>
      )}

      <div className="page-body">
        {isEdit && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: '20px',
              fontSize: 13,
              color: '#0369a1',
            }}
          >
            <Info size={18} color="#0284c7" style={{ flexShrink: 0 }} />
            <div>
              You are updating Purchase Order <strong>{existingPo?.poNumber}</strong>. Modifying
              items, quantities, or rates will automatically recalculate order subtotals and grand
              totals upon saving.
            </div>
          </div>
        )}
        <form
          id="create-po-form"
          onSubmit={handleSubmit(onSubmit, (errs) => console.log('Validation errors:', errs))}
          noValidate
        >
          {/* Main Details Section */}
          <div
            style={{
              background: '#f8fafc',
              padding: '24px 24px',
              margin: '0 -24px',
              width: 'calc(100% + 48px)',
              borderRadius: 0,
              borderBottom: '1px solid #e2e8f0',
              marginBottom: '32px',
              boxSizing: 'border-box',
            }}
          >
            <div
              className="form-field-grid"
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
                              style={{
                                fontSize: '12px',
                                color: isSelected ? '#dbeafe' : '#64748b',
                              }}
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
            </div>
          </div>

          {/* Rest of Main Details */}
          <div
            style={{
              padding: '24px 0',
              width: '100%',
              marginBottom: '32px',
              boxSizing: 'border-box',
            }}
          >
            <div
              className="form-field-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: '200px 1fr',
                rowGap: '20px',
                columnGap: '16px',
                alignItems: 'center',
                fontSize: '13px',
              }}
            >
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <SearchableSelect
                      options={locations.map((l: Location) => ({ label: l.name, value: l.id }))}
                      value={watchDeliveryLocationId || undefined}
                      onChange={(val) =>
                        setValue('deliveryLocationId', val, { shouldValidate: true })
                      }
                      placeholder="Select Location"
                      style={searchableSelectStyle}
                    />

                    {selectedLocation ? (
                      <div
                        style={{
                          padding: '4px 0',
                          color: '#475569',
                          fontSize: '13px',
                          lineHeight: '1.6',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: '14px',
                            marginBottom: '6px',
                            color: '#0f172a',
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
                                  border: '1px solid #0284c7',
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
                                color="#0284c7"
                                style={{ cursor: 'pointer' }}
                                onClick={() => {
                                  setCustomDeliveryName(
                                    customDeliveryName || selectedLocation.name,
                                  );
                                  setIsEditingDeliveryName(true);
                                }}
                              />
                            </>
                          )}
                        </div>
                        {selectedLocation.street1 && (
                          <div>
                            {selectedLocation.street1} {selectedLocation.street2 || ''}
                          </div>
                        )}
                        <div>
                          {[selectedLocation.city, selectedLocation.state]
                            .filter(Boolean)
                            .join(', ')}
                        </div>
                        <div>
                          {[selectedLocation.country, selectedLocation.zip]
                            .filter(Boolean)
                            .join(' , ')}
                        </div>
                        {(selectedLocation.phone ||
                          (currentOrg as unknown as { phone?: string })?.phone) && (
                          <div>
                            {selectedLocation.phone ||
                              (currentOrg as unknown as { phone?: string })?.phone}
                          </div>
                        )}
                        <div
                          style={{
                            marginTop: '10px',
                            color: '#0284c7',
                            cursor: 'pointer',
                            display: 'inline-block',
                            fontWeight: 500,
                            fontSize: '13px',
                          }}
                          onClick={() => setIsDeliveryAddressModalOpen(true)}
                        >
                          Change destination to deliver
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          marginTop: '4px',
                          color: '#0284c7',
                          cursor: 'pointer',
                          display: 'inline-block',
                          fontWeight: 500,
                          fontSize: '13px',
                        }}
                        onClick={() => setIsDeliveryAddressModalOpen(true)}
                      >
                        Select destination to deliver
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
                                  border: '1px solid #0284c7',
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
                                color="#0284c7"
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
                            color: '#0284c7',
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
                <div
                  style={{
                    position: 'relative',
                    maxWidth: '440px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <input
                    type="text"
                    {...register('poNumber', { required: true })}
                    style={{
                      ...inputStyle,
                      maxWidth: '100%',
                      paddingRight: '38px',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setIsNumberConfigOpen(true)}
                    onMouseEnter={() => setIsGearTooltipOpen(true)}
                    onMouseLeave={() => setIsGearTooltipOpen(false)}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      background: 'none',
                      border: 'none',
                      color: '#0284c7',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '4px',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <Settings size={17} />
                  </button>

                  {isGearTooltipOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 'calc(100% + 8px)',
                        right: 0,
                        background: '#0f172a',
                        color: '#ffffff',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        zIndex: 60,
                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.15)',
                        pointerEvents: 'none',
                      }}
                    >
                      Click here to enable or disable auto-generation of Purchase Order number
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          right: '12px',
                          width: 0,
                          height: 0,
                          borderLeft: '5px solid transparent',
                          borderRight: '5px solid transparent',
                          borderTop: '5px solid #0f172a',
                        }}
                      />
                    </div>
                  )}
                </div>
                {errors.poNumber && (
                  <div style={{ color: '#e54d4d', fontSize: '12px', marginTop: '4px' }}>
                    Purchase Order# is required
                  </div>
                )}
              </div>

              <label style={labelStyle}>Reference#</label>
              <div>
                <input
                  type="text"
                  placeholder="e.g. SO-LHK-06431"
                  {...register('referenceNumber')}
                  style={{ ...inputStyle, maxWidth: '440px' }}
                />
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
                        if (getValues('deliveryDate')) trigger('deliveryDate');
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

          {/* Reverse Charge Checkbox */}
          <div
            style={{
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <input
              type="checkbox"
              id="reverse-charge-checkbox"
              checked={isReverseCharge}
              onChange={(e) => setIsReverseCharge(e.target.checked)}
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '4px',
                cursor: 'pointer',
                accentColor: '#0284c7',
              }}
            />
            <label
              htmlFor="reverse-charge-checkbox"
              style={{ fontSize: '13px', color: '#334155', cursor: 'pointer', fontWeight: 500 }}
            >
              This transaction is applicable for reverse charge
            </label>
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
            {/* Top Toolbar */}
            <div
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid #e2e8f0',
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderTopLeftRadius: '8px',
                borderTopRightRadius: '8px',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                {/* Warehouse Location */}
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12.5px',
                    color: '#475569',
                  }}
                >
                  <span>Warehouse Location</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>
                    {selectedLocation?.name || 'Head Office'}
                  </span>
                  <ChevronDown size={14} color="#64748b" />
                </div>

                <div style={{ height: '14px', width: '1px', background: '#e2e8f0' }} />

                {/* Tax Preference Dropdown */}
                <div ref={taxMenuRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsTaxMenuOpen((prev) => !prev);
                      setIsDiscountMenuOpen(false);
                      setTaxSearch('');
                    }}
                    className="po-v3-toolbar-btn"
                  >
                    <span>
                      {taxPreference === 'tax_exclusive' ? 'Tax Exclusive' : 'Tax Inclusive'}
                    </span>
                    <ChevronDown size={14} color="#64748b" />
                  </button>

                  {isTaxMenuOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        width: '200px',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        zIndex: 50,
                        padding: '6px 0',
                      }}
                    >
                      <div
                        style={{
                          padding: '6px 10px',
                          borderBottom: '1px solid #f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Search size={13} color="#94a3b8" />
                        <input
                          type="text"
                          value={taxSearch}
                          onChange={(e) => setTaxSearch(e.target.value)}
                          placeholder="Search"
                          autoFocus
                          style={{
                            border: 'none',
                            outline: 'none',
                            fontSize: '12px',
                            width: '100%',
                            color: '#1e293b',
                            background: 'transparent',
                          }}
                        />
                      </div>
                      <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                        {[
                          { label: 'Tax Exclusive', value: 'tax_exclusive' as const },
                          { label: 'Tax Inclusive', value: 'tax_inclusive' as const },
                        ]
                          .filter((opt) =>
                            opt.label.toLowerCase().includes(taxSearch.toLowerCase()),
                          )
                          .map((opt) => (
                            <div
                              key={opt.value}
                              onClick={() => {
                                setTaxPreference(opt.value);
                                setIsTaxMenuOpen(false);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 12px',
                                fontSize: '12px',
                                color: taxPreference === opt.value ? '#0284c7' : '#334155',
                                fontWeight: taxPreference === opt.value ? 600 : 400,
                                background: taxPreference === opt.value ? '#f0f9ff' : 'transparent',
                                cursor: 'pointer',
                              }}
                              onMouseEnter={(e) => {
                                if (taxPreference !== opt.value) {
                                  e.currentTarget.style.background = '#f8fafc';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (taxPreference !== opt.value) {
                                  e.currentTarget.style.background = 'transparent';
                                }
                              }}
                            >
                              <span>{opt.label}</span>
                              {taxPreference === opt.value && <Check size={14} color="#0284c7" />}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Discount Level Dropdown */}
                <div ref={discountMenuRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsDiscountMenuOpen((prev) => !prev);
                      setIsTaxMenuOpen(false);
                      setDiscountSearch('');
                    }}
                    className="po-v3-toolbar-btn"
                  >
                    <span>
                      {discountLevel === 'transaction'
                        ? 'At Transaction Level'
                        : 'At Line Item Level'}
                    </span>
                    <ChevronDown size={14} color="#64748b" />
                  </button>

                  {isDiscountMenuOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        width: '210px',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        zIndex: 50,
                        padding: '6px 0',
                      }}
                    >
                      <div
                        style={{
                          padding: '6px 10px',
                          borderBottom: '1px solid #f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Search size={13} color="#94a3b8" />
                        <input
                          type="text"
                          value={discountSearch}
                          onChange={(e) => setDiscountSearch(e.target.value)}
                          placeholder="Search"
                          autoFocus
                          style={{
                            border: 'none',
                            outline: 'none',
                            fontSize: '12px',
                            width: '100%',
                            color: '#1e293b',
                            background: 'transparent',
                          }}
                        />
                      </div>
                      <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                        {[
                          { label: 'At Transaction Level', value: 'transaction' as const },
                          { label: 'At Line Item Level', value: 'line_item' as const },
                        ]
                          .filter((opt) =>
                            opt.label.toLowerCase().includes(discountSearch.toLowerCase()),
                          )
                          .map((opt) => (
                            <div
                              key={opt.value}
                              onClick={() => {
                                setDiscountLevel(opt.value);
                                setIsDiscountMenuOpen(false);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 12px',
                                fontSize: '12px',
                                color: discountLevel === opt.value ? '#0284c7' : '#334155',
                                fontWeight: discountLevel === opt.value ? 600 : 400,
                                background: discountLevel === opt.value ? '#f0f9ff' : 'transparent',
                                cursor: 'pointer',
                              }}
                              onMouseEnter={(e) => {
                                if (discountLevel !== opt.value) {
                                  e.currentTarget.style.background = '#f8fafc';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (discountLevel !== opt.value) {
                                  e.currentTarget.style.background = 'transparent';
                                }
                              }}
                            >
                              <span>{opt.label}</span>
                              {discountLevel === opt.value && <Check size={14} color="#0284c7" />}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Select Price List */}
                <div className="po-v3-toolbar-btn">
                  <FileText size={13} color="#64748b" />
                  <span>Select Price List</span>
                  <ChevronDown size={14} color="#64748b" />
                </div>
              </div>

              {/* Bulk Actions Button */}
              <div ref={bulkActionsRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setIsBulkActionsOpen((prev) => !prev)}
                  className="po-v3-toolbar-btn"
                  style={{ color: '#0284c7', fontWeight: 600 }}
                >
                  <CheckCircle2 size={14} color="#0284c7" />
                  <span>Bulk Actions</span>
                  <ChevronDown size={14} color="#0284c7" />
                </button>

                {isBulkActionsOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      right: 0,
                      width: '220px',
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      zIndex: 60,
                      padding: '4px',
                    }}
                  >
                    <div
                      onClick={() => {
                        setIsBulkActionsOpen(false);
                        setMultiSelectTargetIndex(
                          itemFields.length > 0 ? itemFields.length - 1 : 0,
                        );
                        setIsMultiSelectItemModalOpen(true);
                      }}
                      style={{
                        padding: '8px 12px',
                        fontSize: '12px',
                        color: '#1e293b',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#0284c7';
                        e.currentTarget.style.color = '#ffffff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = '#1e293b';
                      }}
                    >
                      Bulk Update Line Items
                    </div>
                    <div
                      onClick={() => {
                        setHideAdditionalInfo((prev) => !prev);
                        setIsBulkActionsOpen(false);
                      }}
                      style={{
                        padding: '8px 12px',
                        fontSize: '12px',
                        color: '#1e293b',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#0284c7';
                        e.currentTarget.style.color = '#ffffff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = '#1e293b';
                      }}
                    >
                      {hideAdditionalInfo
                        ? 'Show All Additional Information'
                        : 'Hide All Additional Information'}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Subheader: Item Table */}
            <div
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid #e2e8f0',
                background: '#f8fafc',
                fontWeight: 600,
                fontSize: '13.5px',
                color: '#1e293b',
              }}
            >
              Item Table
            </div>

            <div className="responsive-table-wrapper" style={{ overflowX: 'auto', width: '100%' }}>
              <table
                className="po-v3-table-clean"
                style={{
                  width: '100%',
                  minWidth: '1250px',
                  tableLayout: 'fixed',
                }}
              >
                <thead>
                  <tr>
                    <th style={{ width: '26%' }}>ITEM DETAILS</th>
                    <th style={{ width: '12%' }}>ACCOUNT</th>
                    <th style={{ width: '9%' }}>PO STATUS</th>
                    <th style={{ width: '11%' }}>PO</th>
                    <th style={{ width: '8%', textAlign: 'right' }}>TOTAL WEIGHT</th>
                    <th style={{ width: '9%', textAlign: 'right' }}>COST PRICE</th>
                    <th style={{ width: '9%', textAlign: 'right' }}>QUANTITY</th>
                    <th style={{ width: '11%', textAlign: 'right' }}>
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          justifyContent: 'flex-end',
                        }}
                      >
                        <span>RATE</span>
                        <Calculator size={13} color="#64748b" />
                      </div>
                    </th>
                    {discountLevel === 'line_item' ? (
                      <th style={{ width: '11%', textAlign: 'right' }}>DISCOUNT</th>
                    ) : (
                      <th style={{ width: '10%', textAlign: 'left' }}>TAX</th>
                    )}
                    <th style={{ width: '10%', textAlign: 'right' }}>AMOUNT</th>
                    <th style={{ width: '4%', textAlign: 'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {itemFields.map((field, index) => {
                    const curItem = watchItems?.[index];
                    const selectedItem = curItem?.item;
                    const itemImageUrl =
                      getImageKey(selectedItem?.frontImage) ||
                      getImageKey(selectedItem?.images?.[0]);
                    const qty = isNaN(Number(curItem?.quantity)) ? 0 : Number(curItem?.quantity);
                    const rate = isNaN(Number(curItem?.rate)) ? 0 : Number(curItem?.rate);
                    const basePrice = qty * rate;
                    const discountVal = isNaN(Number(curItem?.discountValue))
                      ? 0
                      : Number(curItem?.discountValue);
                    const discType = curItem?.discountType || 'percentage';
                    const discountAmount =
                      discountLevel === 'line_item'
                        ? discType === 'percentage'
                          ? (basePrice * discountVal) / 100
                          : discountVal
                        : 0;
                    const calculatedRowAmount = Math.max(0, basePrice - discountAmount);

                    return (
                      <tr
                        key={field.id}
                        style={{
                          position: 'relative',
                          zIndex: itemFields.length - index + 2,
                        }}
                      >
                        {/* ITEM DETAILS */}
                        <td style={{ verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                                  if (val) {
                                    setValue(
                                      `lineItems.${index}.rate`,
                                      (val.costPrice ||
                                        val.sellingPrice ||
                                        '') as unknown as number,
                                    );
                                    setValue(
                                      `lineItems.${index}.costPrice`,
                                      (val.costPrice || '') as unknown as number,
                                    );
                                    setValue(`lineItems.${index}.quantity`, 1 as unknown as number);
                                    setValue(
                                      `lineItems.${index}.description`,
                                      val.purchaseDescription || val.salesDescription || '',
                                    );
                                  } else {
                                    setValue(`lineItems.${index}.rate`, '' as unknown as number);
                                    setValue(
                                      `lineItems.${index}.costPrice`,
                                      '' as unknown as number,
                                    );
                                    setValue(
                                      `lineItems.${index}.quantity`,
                                      '' as unknown as number,
                                    );
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

                            {selectedItem && (
                              <div style={{ fontSize: '11px', color: '#64748b' }}>
                                SKU: {selectedItem.sku || selectedItem.id?.slice(0, 6) || '-'}
                              </div>
                            )}

                            {/* Additional Info: Description, Badges, Footer links */}
                            {selectedItem && !hideAdditionalInfo && (
                              <>
                                <textarea
                                  {...register(`lineItems.${index}.description`)}
                                  placeholder="Add a description to your item"
                                  rows={2}
                                  className="po-v3-cell-textarea"
                                />

                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontSize: '11px',
                                  }}
                                >
                                  <span
                                    style={{
                                      background:
                                        selectedItem.type === 'service' ? '#16a34a' : '#0284c7',
                                      color: '#ffffff',
                                      padding: '2px 6px',
                                      borderRadius: '3px',
                                      fontWeight: 700,
                                      fontSize: '10px',
                                      letterSpacing: '0.04em',
                                      textTransform: 'uppercase',
                                    }}
                                  >
                                    {selectedItem.type === 'service' ? 'SERVICE' : 'GOODS'}
                                  </span>
                                  <span style={{ color: '#475569', fontWeight: 500 }}>
                                    {selectedItem.type === 'service' ? 'SAC' : 'HSN'}:{' '}
                                    <span
                                      style={{
                                        color: '#0284c7',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      {selectedItem.hsnCode || selectedItem.sacCode || 'Update'}
                                    </span>
                                  </span>
                                </div>

                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    fontSize: '11px',
                                    color: '#64748b',
                                    marginTop: '2px',
                                    flexWrap: 'wrap',
                                  }}
                                >
                                  <span
                                    style={{
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                    }}
                                  >
                                    💼 Select a project ▾
                                  </span>
                                  <span
                                    style={{
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                    }}
                                  >
                                    🏷️ Reporting Tags ▾
                                  </span>
                                  <span
                                    style={{
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                    }}
                                  >
                                    ⚙️ Custom Fields ▾
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        </td>

                        {/* ACCOUNT */}
                        <td>
                          <select
                            {...register(`lineItems.${index}.account`)}
                            defaultValue="Packaging"
                            className="po-v3-cell-select"
                          >
                            <option value="Packaging">Packaging</option>
                            <option value="Cost of Goods Sold">Cost of Goods Sold</option>
                            <option value="Purchase Account">Purchase Account</option>
                            <option value="Raw Materials">Raw Materials</option>
                            <option value="Operating Expenses">Operating Expenses</option>
                            <option value="Office Supplies">Office Supplies</option>
                            <option value="Jobwork Expenses">Jobwork Expenses</option>
                          </select>
                        </td>

                        {/* PO STATUS */}
                        <td>
                          <select
                            {...register(`lineItems.${index}.itemPoStatus`)}
                            className="po-v3-cell-select"
                          >
                            <option value="">-</option>
                            <option value="Open">Open</option>
                            <option value="Draft">Draft</option>
                            <option value="Issued">Issued</option>
                            <option value="Closed">Closed</option>
                            <option value="Billed">Billed</option>
                            <option value="Received">Received</option>
                          </select>
                        </td>

                        {/* PO (Linked Sales Order) */}
                        <td>
                          <input
                            type="text"
                            {...register(`lineItems.${index}.linkedSalesOrderId`)}
                            placeholder="Select SO"
                            className="po-v3-cell-input"
                            style={{ fontSize: '11.5px' }}
                          />
                        </td>

                        {/* TOTAL WEIGHT */}
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            {...register(`lineItems.${index}.totalWeight`, {
                              valueAsNumber: true,
                            })}
                            className="po-v3-cell-input"
                            style={{ textAlign: 'right' }}
                          />
                        </td>

                        {/* COST PRICE */}
                        <td>
                          <div className="po-v3-cell-group">
                            <span className="po-v3-cell-addon">₹</span>
                            <input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              {...register(`lineItems.${index}.costPrice`, {
                                valueAsNumber: true,
                              })}
                              style={{ textAlign: 'right' }}
                            />
                          </div>
                        </td>

                        {/* QUANTITY */}
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0"
                            {...register(`lineItems.${index}.quantity`, {
                              valueAsNumber: true,
                              required: true,
                              min: 0.01,
                            })}
                            className="po-v3-cell-input"
                            style={{ textAlign: 'right' }}
                          />
                          <div
                            style={{
                              fontSize: '11px',
                              color: '#64748b',
                              textAlign: 'right',
                              marginTop: '3px',
                            }}
                          >
                            {selectedItem?.unit || 'kg'}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              gap: '4px',
                              fontSize: '11px',
                              color: '#0284c7',
                              marginTop: '4px',
                              cursor: 'pointer',
                            }}
                          >
                            <span>🏢</span>
                            <span>{selectedLocation?.name || 'Head Office'}</span>
                            <span>▾</span>
                          </div>
                        </td>

                        {/* RATE */}
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            {...register(`lineItems.${index}.rate`, {
                              valueAsNumber: true,
                              required: true,
                              min: 0,
                            })}
                            className="po-v3-cell-input"
                            style={{ textAlign: 'right' }}
                          />
                          <div
                            style={{
                              fontSize: '11px',
                              color: '#64748b',
                              textAlign: 'right',
                              marginTop: '3px',
                            }}
                          >
                            per {selectedItem?.unit || 'kg'}
                          </div>
                          <div
                            style={{
                              fontSize: '11px',
                              color: '#64748b',
                              textAlign: 'right',
                              marginTop: '4px',
                              cursor: 'pointer',
                            }}
                          >
                            Apply Price List ▾
                          </div>
                          <div
                            style={{
                              fontSize: '11px',
                              color: '#0284c7',
                              textAlign: 'right',
                              marginTop: '2px',
                              cursor: 'pointer',
                            }}
                          >
                            Recent Transactions
                          </div>
                        </td>

                        {/* TAX / DISCOUNT */}
                        {discountLevel === 'line_item' ? (
                          <td>
                            <div className="po-v3-cell-group">
                              <input
                                type="number"
                                step="0.01"
                                {...register(`lineItems.${index}.discountValue`, {
                                  valueAsNumber: true,
                                  min: 0,
                                })}
                                style={{ textAlign: 'right' }}
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
                                minWidth={42}
                                fullWidth={false}
                                containerStyle={{ flexShrink: 0, height: '100%' }}
                                buttonStyle={{
                                  border: 'none',
                                  borderLeft: '1px solid #e2e8f0',
                                  background: '#f1f5f9',
                                  padding: '0 6px',
                                  fontSize: '11.5px',
                                  fontWeight: 600,
                                  color: '#475569',
                                  borderRadius: 0,
                                  height: '100%',
                                }}
                              />
                            </div>
                          </td>
                        ) : (
                          <td>
                            <select
                              {...register(`lineItems.${index}.tax`)}
                              defaultValue="GST18"
                              className="po-v3-cell-select"
                            >
                              <option value="GST18">GST18 [18%]</option>
                              <option value="GST12">GST12 [12%]</option>
                              <option value="GST5">GST5 [5%]</option>
                              <option value="GST0">GST0 [0%]</option>
                              <option value="None">None</option>
                            </select>
                          </td>
                        )}

                        {/* AMOUNT */}
                        <td
                          style={{
                            padding: '10px 14px',
                            textAlign: 'right',
                            fontWeight: 600,
                            color: '#0f172a',
                            fontSize: '13px',
                            verticalAlign: 'top',
                            paddingTop: '16px',
                            fontVariantNumeric: 'tabular-nums',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ₹
                          {calculatedRowAmount.toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>

                        {/* DELETE ACTION */}
                        <td
                          style={{
                            textAlign: 'center',
                            verticalAlign: 'top',
                            paddingTop: '12px',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            title="Remove item"
                            className="po-v3-btn-subtle"
                            style={{
                              padding: '6px',
                              color: '#94a3b8',
                              borderRadius: '6px',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                          >
                            <X size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Table Footer Buttons */}
            <div
              style={{
                padding: '12px 16px',
                borderTop: '1px solid #e2e8f0',
                background: '#ffffff',
                borderBottomLeftRadius: '8px',
                borderBottomRightRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
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
                className="po-v3-btn-secondary"
                style={{
                  color: '#0284c7',
                  borderColor: 'rgba(2, 132, 199, 0.3)',
                  background: '#f0f9ff',
                }}
              >
                <Plus size={14} /> Add New Row ▾
              </button>

              <button
                type="button"
                onClick={() => {
                  setMultiSelectTargetIndex(itemFields.length > 0 ? itemFields.length - 1 : 0);
                  setIsMultiSelectItemModalOpen(true);
                }}
                className="po-v3-btn-secondary"
              >
                <Plus size={14} /> Add Items in Bulk
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
                  marginBottom: '6px',
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
                  marginBottom: '12px',
                  fontSize: '12.5px',
                  color: '#64748b',
                  fontWeight: 500,
                }}
              >
                <span>Total Quantity : {computedTotalQuantity}</span>
              </div>

              {discountLevel === 'transaction' && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '10px',
                    color: '#475569',
                  }}
                >
                  <span>Discount</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={transactionDiscountValue}
                      onChange={(e) => setTransactionDiscountValue(e.target.value)}
                      placeholder="0.00"
                      style={{
                        width: '76px',
                        padding: '4px 8px',
                        fontSize: '13px',
                        textAlign: 'right',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        outline: 'none',
                        color: '#0f172a',
                        background: '#ffffff',
                      }}
                    />
                    <select
                      value={transactionDiscountType}
                      onChange={(e) =>
                        setTransactionDiscountType(e.target.value as 'percentage' | 'fixed')
                      }
                      style={{
                        padding: '4px 6px',
                        fontSize: '12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        background: '#f8fafc',
                        fontWeight: 600,
                        color: '#475569',
                        outline: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="percentage">%</option>
                      <option value="fixed">₹</option>
                    </select>
                  </div>
                </div>
              )}

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
            className="form-field-grid"
            style={{
              background: '#f8fafc',
              padding: '24px 24px',
              margin: '32px -24px 0 -24px',
              width: 'calc(100% + 48px)',
              borderRadius: 0,
              borderTop: '1px solid #e2e8f0',
              borderBottom: '1px solid #e2e8f0',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '32px',
              position: 'relative',
              boxSizing: 'border-box',
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
                    cursor:
                      attachedFiles.length >= 2 || isUploadingFile ? 'not-allowed' : 'pointer',
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
                    style={{
                      fontSize: '12px',
                      color: '#ef4444',
                      marginTop: '6px',
                      fontWeight: 500,
                    }}
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
      <div
        className="form-actions-footer page-footer po-v3-sticky-footer"
        style={{ display: 'flex', alignItems: 'center', gap: '12px', position: 'relative' }}
      >
        {/* Save Button */}
        <button
          form="create-po-form"
          type="submit"
          onClick={() =>
            setSubmitStatus(
              isEdit
                ? (existingPo?.status as 'Draft' | 'Issued' | 'Approved' | 'Pending Approval') ||
                    'Draft'
                : 'Draft',
            )
          }
          disabled={mutation.isPending}
          style={{
            padding: '7px 22px',
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            cursor: mutation.isPending ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: '13px',
            boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!mutation.isPending) e.currentTarget.style.backgroundColor = '#0369a1';
          }}
        >
          {isEdit
            ? mutation.isPending
              ? 'Updating...'
              : 'Update Purchase Order'
            : mutation.isPending && submitStatus === 'Draft'
              ? 'Saving...'
              : 'Save'}
        </button>

        {/* Split Button: Save and Send + Caret */}
        <div ref={saveMenuRef} style={{ position: 'relative', display: 'inline-flex' }}>
          <div
            style={{
              display: 'inline-flex',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              overflow: 'hidden',
              backgroundColor: '#ffffff',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            <button
              form="create-po-form"
              type="submit"
              onClick={() => {
                setSubmitStatus('Issued');
                setIsSaveMenuOpen(false);
              }}
              disabled={mutation.isPending}
              style={{
                padding: '7px 18px',
                background: '#ffffff',
                color: '#1e293b',
                border: 'none',
                cursor: mutation.isPending ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: '13px',
                borderRight: '1px solid #e2e8f0',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f8fafc';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#ffffff';
              }}
            >
              {mutation.isPending && submitStatus === 'Issued' ? 'Saving...' : 'Save and Send'}
            </button>
            <button
              type="button"
              onClick={() => setIsSaveMenuOpen((prev) => !prev)}
              disabled={mutation.isPending}
              style={{
                padding: '7px 10px',
                background: '#f8fafc',
                color: '#475569',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f1f5f9';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#f8fafc';
              }}
            >
              {isSaveMenuOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>

          {/* Caret Popup Menu */}
          {isSaveMenuOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                left: 0,
                width: '180px',
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                boxShadow:
                  '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                zIndex: 60,
                overflow: 'hidden',
                padding: '4px',
              }}
            >
              <button
                form="create-po-form"
                type="submit"
                onClick={() => {
                  setSubmitStatus('Approved');
                  setIsSaveMenuOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'transparent',
                  color: '#1e293b',
                  fontSize: '13px',
                  fontWeight: 500,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#0284c7';
                  e.currentTarget.style.color = '#ffffff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#1e293b';
                }}
              >
                Save and Approve
              </button>
              <button
                form="create-po-form"
                type="submit"
                onClick={() => {
                  setSubmitStatus('Issued');
                  setIsSaveMenuOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'transparent',
                  color: '#1e293b',
                  fontSize: '13px',
                  fontWeight: 500,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#0284c7';
                  e.currentTarget.style.color = '#ffffff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#1e293b';
                }}
              >
                Save and Submit
              </button>
            </div>
          )}
        </div>

        {/* Cancel Button */}
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
            padding: '7px 20px',
            background: '#ffffff',
            color: '#334155',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '13px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f8fafc';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#ffffff';
          }}
        >
          Cancel
        </button>

        {/* Live Total Pill */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          <span style={{ color: '#64748b' }}>
            {itemFields.length} {itemFields.length === 1 ? 'line item' : 'line items'}
          </span>
          <span style={{ color: '#cbd5e1' }}>|</span>
          <span style={{ fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
            Total: ₹
            {computedTotalAmount.toLocaleString('en-IN', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      </div>

      <PurchaseOrderNumberConfigModal
        isOpen={isNumberConfigOpen}
        onClose={() => setIsNumberConfigOpen(false)}
        initialPrefix={preference?.prefix || poPrefix}
        locationName={
          locations.find((l: Location) => l.id === watchLocationId)?.name ||
          selectedLocation?.name ||
          'Head Office'
        }
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
          const currentItems = getValues('lineItems');

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
