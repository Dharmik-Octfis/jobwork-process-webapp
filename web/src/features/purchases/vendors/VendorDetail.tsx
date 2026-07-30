import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchVendorById, deleteVendor, updateVendor, fetchVendorActivities } from './vendors.api';
import { type UpdateVendorData, type VendorAddress } from './vendors.schemas';
import { useParams, useNavigate } from 'react-router-dom';
import { X, Edit, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { useState, useRef, useEffect, Fragment } from 'react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { VendorActivityTimeline } from './VendorActivityTimeline';
import { VendorComments } from './VendorComments';
import { AdditionalAddressModal } from './AdditionalAddressModal';

interface VendorDetailProps {
  vendorId: string;
  onClose: () => void;
}

export function VendorDetail({ vendorId, onClose }: VendorDetailProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('Overview');
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [addressModalType, setAddressModalType] = useState<'billing' | 'shipping' | 'additional' | null>(null);
  const [addressEditIndex, setAddressEditIndex] = useState<number | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { data: vendor, isLoading } = useQuery({
    queryKey: ['vendor', orgId, vendorId],
    queryFn: () => fetchVendorById(orgId!, vendorId),
    enabled: Boolean(orgId && vendorId),
  });

  const { data: activities, isLoading: isActivitiesLoading } = useQuery({
    queryKey: ['vendor-activities', orgId, vendorId],
    queryFn: () => fetchVendorActivities(orgId!, vendorId),
    enabled: Boolean(orgId && vendorId),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteVendor(orgId!, vendorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors', orgId] });
      onClose();
    },
  });

  const statusMutation = useMutation({
    mutationFn: (newStatus: string) => {
      if (!vendor) throw new Error('Vendor not found');
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        organizationId: _organizationId,
        ...rest
      } = vendor;

      const dataToUpdate = { ...rest, status: newStatus };
      return updateVendor({ orgId: orgId!, id: vendorId, data: dataToUpdate as UpdateVendorData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor', orgId, vendorId] });
      queryClient.invalidateQueries({ queryKey: ['vendors', orgId] });
    },
  });

  const saveAdditionalAddressMutation = useMutation({
    mutationFn: (newAddress: VendorAddress) => {
      if (!vendor) throw new Error('Vendor not found');
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        organizationId: _organizationId,
        ...rest
      } = vendor;

      const updatedAddresses = [...(vendor.addresses || [])];
      if (addressEditIndex !== null) {
        updatedAddresses[addressEditIndex] = newAddress;
      } else {
        updatedAddresses.push(newAddress);
      }
      const dataToUpdate = { ...rest, addresses: updatedAddresses };
      return updateVendor({ orgId: orgId!, id: vendorId, data: dataToUpdate as UpdateVendorData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor', orgId, vendorId] });
      setAddressModalType(null);
      setAddressEditIndex(null);
    },
  });

  const deleteAdditionalAddressMutation = useMutation({
    mutationFn: (index: number) => {
      if (!vendor) throw new Error('Vendor not found');
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        organizationId: _organizationId,
        ...rest
      } = vendor;

      const updatedAddresses = [...(vendor.addresses || [])];
      updatedAddresses.splice(index, 1);
      
      const dataToUpdate = { ...rest, addresses: updatedAddresses };
      return updateVendor({ orgId: orgId!, id: vendorId, data: dataToUpdate as UpdateVendorData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor', orgId, vendorId] });
    },
  });

  const deleteSpecificAddressMutation = useMutation({
    mutationFn: (type: 'billing' | 'shipping') => {
      if (!vendor) throw new Error('Vendor not found');
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        organizationId: _organizationId,
        ...rest
      } = vendor;

      const dataToUpdate: Partial<UpdateVendorData> = { ...rest };
      if (type === 'billing') {
        dataToUpdate.billingStreet1 = '';
        dataToUpdate.billingStreet2 = '';
        dataToUpdate.billingCity = '';
        dataToUpdate.billingState = '';
        dataToUpdate.billingCountry = '';
        dataToUpdate.billingPinCode = '';
        dataToUpdate.billingAttention = '';
        dataToUpdate.billingPhone = '';
      } else {
        dataToUpdate.shippingStreet1 = '';
        dataToUpdate.shippingStreet2 = '';
        dataToUpdate.shippingCity = '';
        dataToUpdate.shippingState = '';
        dataToUpdate.shippingCountry = '';
        dataToUpdate.shippingPinCode = '';
        dataToUpdate.shippingAttention = '';
        dataToUpdate.shippingPhone = '';
      }
      return updateVendor({ orgId: orgId!, id: vendorId, data: dataToUpdate as UpdateVendorData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor', orgId, vendorId] });
    },
  });

  const updateSpecificAddressMutation = useMutation({
    mutationFn: ({ type, address }: { type: 'billing' | 'shipping'; address: VendorAddress }) => {
      if (!vendor) throw new Error('Vendor not found');
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        organizationId: _organizationId,
        ...rest
      } = vendor;
      const dataToUpdate: Partial<UpdateVendorData> = { ...rest };
      if (type === 'billing') {
        dataToUpdate.billingStreet1 = address.street1;
        dataToUpdate.billingStreet2 = address.street2;
        dataToUpdate.billingCity = address.city;
        dataToUpdate.billingState = address.state;
        dataToUpdate.billingCountry = address.country;
        dataToUpdate.billingPinCode = address.pinCode;
        dataToUpdate.billingAttention = address.attention;
        dataToUpdate.billingPhone = address.phone;
      } else {
        dataToUpdate.shippingStreet1 = address.street1;
        dataToUpdate.shippingStreet2 = address.street2;
        dataToUpdate.shippingCity = address.city;
        dataToUpdate.shippingState = address.state;
        dataToUpdate.shippingCountry = address.country;
        dataToUpdate.shippingPinCode = address.pinCode;
        dataToUpdate.shippingAttention = address.attention;
        dataToUpdate.shippingPhone = address.phone;
      }
      return updateVendor({ orgId: orgId!, id: vendorId, data: dataToUpdate as UpdateVendorData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor', orgId, vendorId] });
      setAddressModalType(null);
    },
  });

  const handleClone = () => {
    setIsMoreOpen(false);
    if (!vendor) return;

    // Use destructuring to omit properties instead of 'delete' with 'any'
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      organizationId: _organizationId,
      ...restToClone
    } = vendor;
    const vendorToClone = {
      ...restToClone,
      contactNumber: '',
    };

    navigate(`/organizations/${orgId}/purchases/vendors/new`, { state: { vendorToClone } });
  };

  if (isLoading) {
    return (
      <div style={{ padding: '16px', display: 'flex', justifyContent: 'center', color: '#64748b' }}>
        Loading vendor details...
      </div>
    );
  }

  if (!vendor) {
    return (
      <div style={{ padding: '16px', display: 'flex', justifyContent: 'center', color: '#64748b' }}>
        Vendor not found.
      </div>
    );
  }

  const tabs = ['Overview', 'Comments', 'Transactions'];

  const sectionHeaderStyle = {
    fontSize: '11px',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    marginBottom: '12px',
    borderBottom: '1px solid #eef0f3',
    paddingBottom: '8px',
  };

  const labelStyle = {
    fontSize: '11px',
    color: '#64748b',
    marginBottom: '2px',
  };

  const valueStyle = {
    fontSize: '12px',
    color: '#1e293b',
    fontWeight: 500,
    marginBottom: '12px',
  };

  const hasPrimaryContact = vendor.primaryContactFirstName || vendor.primaryContactLastName;
  const primaryContactName = [
    vendor.primaryContactSalutation,
    vendor.primaryContactFirstName,
    vendor.primaryContactLastName,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#fff',
        borderLeft: '1px solid #eef0f3',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid #eef0f3',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1e293b', margin: 0 }}>
            {vendor.contactName}
          </h2>
          <span
            onClick={() => {
              statusMutation.mutate(vendor.status === 'inactive' ? 'active' : 'inactive');
            }}
            style={{
              background: vendor.status === 'inactive' ? '#94a3b8' : '#3b82f6',
              color: 'white',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
          >
            {vendor.status === 'inactive' ? 'Inactive' : 'Active'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => navigate(`/organizations/${orgId}/purchases/vendors/${vendorId}/edit`)}
            style={{
              padding: '6px 12px',
              border: '1px solid #d1d5db',
              background: 'white',
              borderRadius: '4px',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Edit size={14} /> Edit
          </button>

          <div style={{ position: 'relative' }} ref={moreMenuRef}>
            <button
              onClick={() => setIsMoreOpen(!isMoreOpen)}
              style={{
                padding: '6px 12px',
                border: '1px solid #d1d5db',
                background: 'white',
                borderRadius: '4px',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              More <ChevronDown size={14} />
            </button>

            {isMoreOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  background: 'white',
                  border: '1px solid #eef0f3',
                  borderRadius: '4px',
                  boxShadow:
                    '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                  width: '140px',
                  zIndex: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#333',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  onClick={handleClone}
                >
                  Clone
                </div>
                <div
                  style={{
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#ef4444',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#fef2f2')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => {
                    setIsMoreOpen(false);
                    setShowDeleteConfirm(true);
                  }}
                >
                  Delete
                </div>
                <div
                  style={{
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#333',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => {
                    setIsMoreOpen(false);
                    statusMutation.mutate(vendor.status === 'inactive' ? 'active' : 'inactive');
                  }}
                >
                  {vendor.status === 'inactive' ? 'Mark as Active' : 'Mark as Inactive'}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '6px 8px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          padding: '0 24px',
          borderBottom: '1px solid #eef0f3',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        {tabs.map((tab, idx) => (
          <Fragment key={tab}>
            {idx > 0 && <div style={{ height: '16px', width: '1px', background: '#cbd5e1' }} />}
            <div
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 0',
                fontSize: '14px',
                fontWeight: activeTab === tab ? 600 : 500,
                color: activeTab === tab ? '#0062ff' : '#64748b',
                borderBottom: activeTab === tab ? '2px solid #0062ff' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              {tab}
            </div>
          </Fragment>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 0, background: '#f8fafc' }}>
        <div
          style={{
            display: activeTab === 'Overview' ? 'flex' : 'none',
            gap: '0px',
            flexDirection: 'column',
          }}
        >
          {/* Top Contact Banner */}
          <div
            style={{
              background: '#f1f5f9',
              padding: '16px',
              borderRadius: '8px',
              fontSize: '13px',
              color: '#475569',
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '16px',
            }}
          >
            <div>
              {hasPrimaryContact ? (
                <span>
                  Primary Contact: <strong>{primaryContactName}</strong>
                </span>
              ) : (
                <span>
                  There is no primary contact information.{' '}
                  <a href="#" style={{ color: '#0062ff', textDecoration: 'none' }}>
                    Add New
                  </a>
                </span>
              )}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '0px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid #eef0f3',
            }}
          >
            {/* Left Column */}
            <div
              style={{
                flex: '0 0 300px',
                display: 'flex',
                flexDirection: 'column',
                gap: '24px',
                background: '#f1f5f9',
                padding: '16px',
                borderRight: '1px solid #e2e8f0',
              }}
            >
              <div>
                <div style={sectionHeaderStyle}>Address</div>

                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={labelStyle}>Billing Address</div>
                    {vendor.billingStreet1 && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => { setAddressEditIndex(null); setAddressModalType('billing'); }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#64748b' }} title="Edit Address">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => { if(window.confirm('Are you sure you want to remove this billing address?')) deleteSpecificAddressMutation.mutate('billing'); }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#ef4444' }} title="Remove Address">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  {vendor.billingStreet1 ? (
                    <div style={{ fontSize: '12px', color: '#333' }}>
                      {vendor.billingStreet1}
                      <br />
                      {vendor.billingStreet2 && (
                        <>
                          {vendor.billingStreet2}
                          <br />
                        </>
                      )}
                      {vendor.billingCity && <>{vendor.billingCity}, </>}
                      {vendor.billingState}
                      <br />
                      {vendor.billingCountry} {vendor.billingPinCode}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                      No Billing Address -{' '}
                      <button
                        onClick={() => setAddressModalType('billing')}
                        style={{ color: '#0062ff', textDecoration: 'none', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '12px' }}
                      >
                        New Address
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={labelStyle}>Shipping Address</div>
                    {vendor.shippingStreet1 && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => { setAddressEditIndex(null); setAddressModalType('shipping'); }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#64748b' }} title="Edit Address">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => { if(window.confirm('Are you sure you want to remove this shipping address?')) deleteSpecificAddressMutation.mutate('shipping'); }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#ef4444' }} title="Remove Address">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  {vendor.shippingStreet1 ? (
                    <div style={{ fontSize: '12px', color: '#333' }}>
                      {vendor.shippingStreet1}
                      <br />
                      {vendor.shippingStreet2 && (
                        <>
                          {vendor.shippingStreet2}
                          <br />
                        </>
                      )}
                      {vendor.shippingCity && <>{vendor.shippingCity}, </>}
                      {vendor.shippingState}
                      <br />
                      {vendor.shippingCountry} {vendor.shippingPinCode}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                      No Shipping Address -{' '}
                      <button
                        onClick={() => setAddressModalType('shipping')}
                        style={{ color: '#0062ff', textDecoration: 'none', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '12px' }}
                      >
                        New Address
                      </button>
                    </div>
                  )}
                </div>

                {vendor.addresses?.filter((a: VendorAddress) => a.addressType !== 'billing' && a.addressType !== 'shipping').map((addr: VendorAddress, index: number) => (
                  <div key={index} style={{ marginTop: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={labelStyle}>Additional Address</div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => { setAddressEditIndex(index); setAddressModalType('additional'); }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#64748b' }} title="Edit Address">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => { if(window.confirm('Are you sure you want to remove this address?')) deleteAdditionalAddressMutation.mutate(index); }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#ef4444' }} title="Remove Address">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: '12px', color: '#333' }}>
                      {addr.attention && <>{addr.attention}<br/></>}
                      {addr.street1 && <>{addr.street1}<br/></>}
                      {addr.street2 && <>{addr.street2}<br/></>}
                      {addr.city && <>{addr.city}, </>}
                      {addr.state}
                      <br />
                      {addr.country} {addr.pinCode}
                      {addr.phone && <><br/>Phone: {addr.phone}</>}
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: '12px' }}>
                  <button
                    onClick={() => setAddressModalType('additional')}
                    style={{ background: 'none', border: 'none', color: '#0062ff', cursor: 'pointer', padding: 0, fontSize: '13px' }}
                  >
                    + Add additional address
                  </button>
                </div>
              </div>

              <div>
                <div style={sectionHeaderStyle}>Other Details</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <div style={labelStyle}>Vendor Number</div>
                    <div style={valueStyle}>{vendor.contactNumber}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Email Address</div>
                    <div style={valueStyle}>{vendor.email || '-'}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Work Phone</div>
                    <div style={valueStyle}>{vendor.phone || '-'}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Default Currency</div>
                    <div style={valueStyle}>{vendor.currency || 'INR'}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '0px',
                background: 'white',
              }}
            >


              <div style={{ padding: '16px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ fontSize: '15px', fontWeight: 500, color: '#1e293b' }}>
                      Recent Activity
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <VendorActivityTimeline
                    activities={activities || []}
                    isLoading={isActivitiesLoading}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: activeTab === 'Comments' ? 'block' : 'none' }}>
          <VendorComments orgId={orgId!} vendorId={vendorId} />
        </div>

        <div
          style={{
            display: activeTab === 'Transactions' ? 'block' : 'none',
            color: '#64748b',
            padding: '16px',
          }}
        >
          No transactions found.
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Do you want to delete this vendor?"
        message="This action cannot be undone."
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <AdditionalAddressModal
        isOpen={addressModalType !== null}
        title={
          addressModalType === 'billing' ? 'Billing Address' :
          addressModalType === 'shipping' ? 'Shipping Address' :
          'Additional Address'
        }
        defaultValues={
          addressModalType === 'billing'
            ? {
                street1: vendor.billingStreet1 || '',
                street2: vendor.billingStreet2 || '',
                city: vendor.billingCity || '',
                state: vendor.billingState || '',
                country: vendor.billingCountry || '',
                pinCode: vendor.billingPinCode || '',
                attention: vendor.billingAttention || '',
                phone: vendor.billingPhone || '',
                addressType: 'billing',
              }
            : addressModalType === 'shipping'
            ? {
                street1: vendor.shippingStreet1 || '',
                street2: vendor.shippingStreet2 || '',
                city: vendor.shippingCity || '',
                state: vendor.shippingState || '',
                country: vendor.shippingCountry || '',
                pinCode: vendor.shippingPinCode || '',
                attention: vendor.shippingAttention || '',
                phone: vendor.shippingPhone || '',
                addressType: 'shipping',
              }
            : addressEditIndex !== null
            ? vendor.addresses?.[addressEditIndex]
            : { addressType: 'additional' }
        }
        onClose={() => {
          setAddressModalType(null);
          setAddressEditIndex(null);
        }}
        onSubmit={(data) => {
          if (addressModalType === 'billing' || addressModalType === 'shipping') {
            updateSpecificAddressMutation.mutate({ type: addressModalType, address: data });
          } else {
            saveAdditionalAddressMutation.mutate(data);
          }
        }}
      />
    </div>
  );
}
