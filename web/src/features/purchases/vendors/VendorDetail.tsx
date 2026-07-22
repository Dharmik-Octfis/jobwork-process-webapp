import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchVendorById, deleteVendor, updateVendor, fetchVendorActivities } from './vendors.api';
import { type UpdateVendorData, type VendorAddress } from './vendors.schemas';
import { useParams, useNavigate } from 'react-router-dom';
import { X, Edit, ChevronDown, CheckCircle2, Plus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
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
  const [isAdditionalAddressModalOpen, setIsAdditionalAddressModalOpen] = useState(false);
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

  const addAddressMutation = useMutation({
    mutationFn: (newAddress: VendorAddress) => {
      if (!vendor) throw new Error('Vendor not found');
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        organizationId: _organizationId,
        ...rest
      } = vendor;

      const updatedAddresses = [...(vendor.addresses || []), newAddress];
      const dataToUpdate = { ...rest, addresses: updatedAddresses };
      return updateVendor({ orgId: orgId!, id: vendorId, data: dataToUpdate as UpdateVendorData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor', orgId, vendorId] });
      setIsAdditionalAddressModalOpen(false);
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
      vendorNumber: '',
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
            {vendor.displayName}
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
            onClick={() => navigate(`/organizations/${orgId}/purchases/vendors/new`)}
            style={{
              padding: '6px 12px',
              border: 'none',
              background: '#0062ff',
              color: 'white',
              borderRadius: '4px',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 500,
            }}
          >
            <Plus size={14} /> New
          </button>

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
          gap: '24px',
        }}
      >
        {tabs.map((tab) => (
          <div
            key={tab}
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
                  <div style={labelStyle}>Billing Address</div>
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
                      <a href="#" style={{ color: '#0062ff', textDecoration: 'none' }}>
                        New Address
                      </a>
                    </div>
                  )}
                </div>

                <div>
                  <div style={labelStyle}>Shipping Address</div>
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
                      <a href="#" style={{ color: '#0062ff', textDecoration: 'none' }}>
                        New Address
                      </a>
                    </div>
                  )}
                </div>

                {vendor.addresses?.filter((a: VendorAddress) => a.addressType !== 'billing' && a.addressType !== 'shipping').map((addr: VendorAddress, index: number) => (
                  <div key={index} style={{ marginTop: '12px' }}>
                    <div style={labelStyle}>Additional Address</div>
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
                    onClick={() => setIsAdditionalAddressModalOpen(true)}
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
                    <div style={valueStyle}>{vendor.vendorNumber}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Email Address</div>
                    <div style={valueStyle}>{vendor.emailAddress || '-'}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Work Phone</div>
                    <div style={valueStyle}>{vendor.workPhone || '-'}</div>
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
              <div style={{ padding: '16px', borderBottom: '1px solid #eef0f3' }}>
                <div style={sectionHeaderStyle}>Payables</div>

                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
                  <thead>
                    <tr
                      style={{
                        borderBottom: '1px solid #eef0f3',
                        fontSize: '11px',
                        color: '#64748b',
                      }}
                    >
                      <th style={{ textAlign: 'left', paddingBottom: '8px', fontWeight: 600 }}>
                        CURRENCY
                      </th>
                      <th style={{ textAlign: 'right', paddingBottom: '8px', fontWeight: 600 }}>
                        OUTSTANDING PAYABLES
                      </th>
                      <th style={{ textAlign: 'right', paddingBottom: '8px', fontWeight: 600 }}>
                        UNUSED CREDITS
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #eef0f3' }}>
                      <td style={{ padding: '12px 0', fontSize: '12px', color: '#333' }}>
                        {vendor.currency || 'INR'} - Indian Rupee
                      </td>
                      <td
                        style={{
                          padding: '12px 0',
                          fontSize: '12px',
                          color: '#0062ff',
                          textAlign: 'right',
                          fontWeight: 500,
                        }}
                      >
                        ₹0.00
                      </td>
                      <td
                        style={{
                          padding: '12px 0',
                          fontSize: '12px',
                          color: '#333',
                          textAlign: 'right',
                          fontWeight: 500,
                        }}
                      >
                        ₹0.00
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div
                  style={{
                    fontSize: '13px',
                    color: '#0062ff',
                    cursor: 'pointer',
                    marginBottom: '16px',
                  }}
                >
                  View Opening Balance
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: '#64748b',
                    fontSize: '14px',
                    borderTop: '1px solid #eef0f3',
                    paddingTop: '16px',
                  }}
                >
                  <CheckCircle2 size={16} color="#ef4444" />
                  <span>0 check(s) pending to print for this vendor</span>
                </div>
              </div>

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
        isOpen={isAdditionalAddressModalOpen}
        onClose={() => setIsAdditionalAddressModalOpen(false)}
        onSubmit={(data) => addAddressMutation.mutate(data)}
      />
    </div>
  );
}
