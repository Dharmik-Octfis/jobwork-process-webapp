import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchVendorById, deleteVendor, updateVendor, fetchVendorActivities } from './vendors.api';
import {
  type Vendor,
  type UpdateVendorData,
  type VendorAddress,
  type VendorContactPerson,
  type VendorsPage,
} from './vendors.schemas';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { X, Edit, ChevronDown, ChevronUp, Pencil, Trash, User, Settings, Plus } from 'lucide-react';
import { useState, useRef, useEffect, Fragment } from 'react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { VendorActivityTimeline } from './VendorActivityTimeline';
import { VendorComments } from './VendorComments';
import { AdditionalAddressModal } from './AdditionalAddressModal';
import { PrimaryContactModal } from './PrimaryContactModal';

interface VendorDetailProps {
  vendorId: string;
  onClose: () => void;
}

export function VendorDetail({ vendorId, onClose }: VendorDetailProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('Overview');
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [addressModalType, setAddressModalType] = useState<
    'billing' | 'shipping' | 'additional' | null
  >(null);
  const [addressEditIndex, setAddressEditIndex] = useState<number | null>(null);
  const [isOtherDetailsOpen, setIsOtherDetailsOpen] = useState(true);
  const [isAddressOpen, setIsAddressOpen] = useState(true);
  const [isContactPersonOpen, setIsContactPersonOpen] = useState(true);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [isContactSettingsOpen, setIsContactSettingsOpen] = useState(false);
  const contactSettingsRef = useRef<HTMLDivElement>(null);
  const [hoveredContactSetting, setHoveredContactSetting] = useState<'Edit' | 'Delete'>('Edit');
  const [isPrimaryContactModalOpen, setIsPrimaryContactModalOpen] = useState(false);
  const [isContactPersonModalOpen, setIsContactPersonModalOpen] = useState(false);
  const [contactPersonEditIndex, setContactPersonEditIndex] = useState<number | null>(null);
  const [activeContactPersonMenu, setActiveContactPersonMenu] = useState<number | null>(null);
  const [hoveredContactPersonSetting, setHoveredContactPersonSetting] = useState<
    'Edit' | 'Mark as Primary' | 'Delete'
  >('Edit');
  const [hoveredSettingsIcon, setHoveredSettingsIcon] = useState<number | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreOpen(false);
      }
      if (
        contactSettingsRef.current &&
        !contactSettingsRef.current.contains(event.target as Node)
      ) {
        setIsContactSettingsOpen(false);
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
    onSuccess: (_, newStatus) => {
      queryClient.setQueriesData({ queryKey: ['vendors', orgId], type: 'active' }, (old: VendorsPage | undefined) => {
        if (!old || !old.results) return old;
        return {
          ...old,
          results: old.results.map((item: Vendor) =>
            item.id === vendorId ? { ...item, status: newStatus } : item
          ),
        };
      });
      queryClient.invalidateQueries({ queryKey: ['vendors', orgId], type: 'inactive' });
      queryClient.invalidateQueries({ queryKey: ['vendor', orgId, vendorId] });
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
      const dataToUpdate: Partial<UpdateVendorData> = {
        ...rest,
      } as unknown as Partial<UpdateVendorData>;
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
    onSuccess: (updatedVendor) => {
      queryClient.setQueryData(['vendor', orgId, vendorId], updatedVendor);
      queryClient.invalidateQueries({ queryKey: ['vendor', orgId, vendorId] });
      setAddressModalType(null);
    },
  });

  const updatePrimaryContactMutation = useMutation({
    mutationFn: (newContactData: {
      salutation?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      phone?: string | null;
      mobile?: string | null;
    }) => {
      if (!vendor) throw new Error('Vendor not found');
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        organizationId: _organizationId,
        ...rest
      } = vendor;

      const mappedData = {
        primaryContactSalutation: newContactData.salutation,
        primaryContactFirstName: newContactData.firstName,
        primaryContactLastName: newContactData.lastName,
        email: newContactData.email,
        phone: newContactData.phone,
        mobile: newContactData.mobile,
      };

      const dataToUpdate = { ...rest, ...mappedData };
      return updateVendor({ orgId: orgId!, id: vendorId, data: dataToUpdate as UpdateVendorData });
    },
    onSuccess: (updatedVendor) => {
      queryClient.setQueryData(['vendor', orgId, vendorId], updatedVendor);
      queryClient.invalidateQueries({ queryKey: ['vendor', orgId, vendorId] });
      setIsPrimaryContactModalOpen(false);
    },
  });

  const deleteContactPersonMutation = useMutation({
    mutationFn: (index: number) => {
      if (!vendor) throw new Error('Vendor not found');
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        organizationId: _organizationId,
        ...rest
      } = vendor;

      const updatedContactPersons = [...(vendor.contactPersons || [])];
      updatedContactPersons.splice(index, 1);

      const dataToUpdate = { ...rest, contactPersons: updatedContactPersons };
      return updateVendor({ orgId: orgId!, id: vendorId, data: dataToUpdate as UpdateVendorData });
    },
    onSuccess: (updatedVendor) => {
      queryClient.setQueryData(['vendor', orgId, vendorId], updatedVendor);
      queryClient.invalidateQueries({ queryKey: ['vendor', orgId, vendorId] });
    },
  });

  const markAsPrimaryMutation = useMutation({
    mutationFn: (index: number) => {
      if (!vendor) throw new Error('Vendor not found');
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        organizationId: _organizationId,
        ...rest
      } = vendor;

      const currentPrimary = {
        salutation: vendor.primaryContactSalutation || '',
        firstName: vendor.primaryContactFirstName || '',
        lastName: vendor.primaryContactLastName || '',
        email: vendor.email || '',
        phone: vendor.phone || '',
        mobile: vendor.mobile || '',
      };

      const selectedContactPerson = vendor.contactPersons![index];

      const newPrimary = {
        primaryContactSalutation: selectedContactPerson.salutation,
        primaryContactFirstName: selectedContactPerson.firstName,
        primaryContactLastName: selectedContactPerson.lastName,
        email: selectedContactPerson.email,
        phone: selectedContactPerson.phone,
        mobile: selectedContactPerson.mobile,
      };

      const hasCurrentPrimary = currentPrimary.firstName || currentPrimary.lastName;
      const updatedContactPersons = [...vendor.contactPersons!];

      if (hasCurrentPrimary) {
        updatedContactPersons[index] = currentPrimary;
      } else {
        updatedContactPersons.splice(index, 1);
      }

      const dataToUpdate = { ...rest, ...newPrimary, contactPersons: updatedContactPersons };
      return updateVendor({ orgId: orgId!, id: vendorId, data: dataToUpdate as UpdateVendorData });
    },
    onMutate: async (index: number) => {
      await queryClient.cancelQueries({ queryKey: ['vendor', orgId, vendorId] });
      const previousVendor = queryClient.getQueryData<Vendor>(['vendor', orgId, vendorId]);

      if (previousVendor) {
        const currentPrimary = {
          salutation: previousVendor.primaryContactSalutation || '',
          firstName: previousVendor.primaryContactFirstName || '',
          lastName: previousVendor.primaryContactLastName || '',
          email: previousVendor.email || '',
          phone: previousVendor.phone || '',
          mobile: previousVendor.mobile || '',
        };
        const selectedContactPerson = previousVendor.contactPersons![index];
        const newPrimary = {
          primaryContactSalutation: selectedContactPerson.salutation,
          primaryContactFirstName: selectedContactPerson.firstName,
          primaryContactLastName: selectedContactPerson.lastName,
          email: selectedContactPerson.email,
          phone: selectedContactPerson.phone,
          mobile: selectedContactPerson.mobile,
        };
        const hasCurrentPrimary = currentPrimary.firstName || currentPrimary.lastName;
        const updatedContactPersons = [...previousVendor.contactPersons!];

        if (hasCurrentPrimary) {
          updatedContactPersons[index] = currentPrimary;
        } else {
          updatedContactPersons.splice(index, 1);
        }

        queryClient.setQueryData(['vendor', orgId, vendorId], {
          ...previousVendor,
          ...newPrimary,
          contactPersons: updatedContactPersons,
        });
      }
      return { previousVendor };
    },
    onError: (_err, _index, context) => {
      if (context?.previousVendor) {
        queryClient.setQueryData(['vendor', orgId, vendorId], context.previousVendor);
      }
    },
    onSuccess: (updatedVendor) => {
      queryClient.setQueryData(['vendor', orgId, vendorId], updatedVendor);
      queryClient.invalidateQueries({ queryKey: ['vendor', orgId, vendorId] });
      queryClient.invalidateQueries({ queryKey: ['vendors', orgId] });
      setActiveContactPersonMenu(null);
    },
  });

  const saveContactPersonMutation = useMutation({
    mutationFn: (newContactPerson: VendorContactPerson) => {
      if (!vendor) throw new Error('Vendor not found');
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        organizationId: _organizationId,
        ...rest
      } = vendor;

      const updatedContactPersons = [...(vendor.contactPersons || [])];
      if (contactPersonEditIndex !== null) {
        updatedContactPersons[contactPersonEditIndex] = {
          ...updatedContactPersons[contactPersonEditIndex],
          ...newContactPerson,
        };
      } else {
        updatedContactPersons.push(newContactPerson);
      }

      const dataToUpdate = { ...rest, contactPersons: updatedContactPersons };
      return updateVendor({ orgId: orgId!, id: vendorId, data: dataToUpdate as UpdateVendorData });
    },
    onSuccess: (updatedVendor) => {
      queryClient.setQueryData(['vendor', orgId, vendorId], updatedVendor);
      queryClient.invalidateQueries({ queryKey: ['vendor', orgId, vendorId] });
      setIsContactPersonModalOpen(false);
      setContactPersonEditIndex(null);
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

    navigate(`/organizations/${orgId}/purchases/vendors/new`, { state: { vendorToClone , returnUrl: location.pathname + location.search } });
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
    fontSize: '13px',
    fontWeight: 400,
    color: '#000',
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
      <div className="detail-page-header">
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
            onClick={() => navigate(`/organizations/${orgId}/purchases/vendors/${vendorId}/edit`, { state: { returnUrl: location.pathname + location.search } })}
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
            paddingBottom: '120px',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '0px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              borderRadius: '8px',
              border: '1px solid #eef0f3',
            }}
          >
            {/* Left Column */}
            <div
              style={{
                flex: '0 0 300px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0px',
                background: '#f1f5f9',
                padding: '16px',
                borderRight: '1px solid #e2e8f0',
                borderTopLeftRadius: '8px',
                borderBottomLeftRadius: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '24px',
                }}
              >
                {hasPrimaryContact ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div
                      style={{
                        width: '48px',
                        height: '48px',
                        backgroundColor: '#cbd5e1',
                        borderRadius: '8px',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'flex-end',
                        overflow: 'hidden',
                      }}
                    >
                      <User size={40} color="#fff" fill="#fff" style={{ marginBottom: '-6px' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#000' }}>
                        {primaryContactName}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                        {vendor.email && <div>Email: {vendor.email}</div>}
                        {vendor.phone && <div>Phone: {vendor.phone}</div>}
                        {vendor.mobile && <div>Mobile: {vendor.mobile}</div>}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: '13px',
                      color: '#475569',
                      backgroundColor: '#f8fafc',
                      borderRadius: '12px',
                      padding: '24px 16px',
                      textAlign: 'center',
                      width: '100%',
                    }}
                  >
                    <div style={{ marginBottom: '4px' }}>
                      There is no primary contact information.
                    </div>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setIsPrimaryContactModalOpen(true);
                      }}
                      style={{
                        color: '#0062ff',
                        textDecoration: 'none',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      Add New
                    </button>
                  </div>
                )}

                {hasPrimaryContact && (
                  <div style={{ position: 'relative' }} ref={contactSettingsRef}>
                    <button
                      onClick={() => {
                        setIsContactSettingsOpen(!isContactSettingsOpen);
                        setHoveredContactSetting('Edit');
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        color: '#000',
                      }}
                    >
                      <Settings size={14} />
                    </button>
                    {isContactSettingsOpen && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          marginTop: '4px',
                          background: '#fff',
                          borderRadius: '6px',
                          boxShadow:
                            '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                          border: '1px solid #e2e8f0',
                          width: '120px',
                          zIndex: 50,
                          overflow: 'hidden',
                          padding: '4px',
                        }}
                        onMouseLeave={() => setHoveredContactSetting('Edit')}
                      >
                        <button
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 12px',
                            background:
                              hoveredContactSetting === 'Edit' ? '#3b82f6' : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '13px',
                            color: hoveredContactSetting === 'Edit' ? '#fff' : '#334155',
                            borderRadius: '4px',
                          }}
                          onMouseEnter={() => setHoveredContactSetting('Edit')}
                          onClick={() => {
                            setIsPrimaryContactModalOpen(true);
                            setIsContactSettingsOpen(false);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 12px',
                            background:
                              hoveredContactSetting === 'Delete' ? '#3b82f6' : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '13px',
                            color: hoveredContactSetting === 'Delete' ? '#fff' : '#334155',
                            borderRadius: '4px',
                            marginTop: '2px',
                          }}
                          onMouseEnter={() => setHoveredContactSetting('Delete')}
                          onClick={() => {
                            setIsContactSettingsOpen(false);
                            setTimeout(() => {
                              if (
                                window.confirm(
                                  'Are you sure you want to delete the primary contact?',
                                )
                              ) {
                                updatePrimaryContactMutation.mutate({
                                  salutation: null,
                                  firstName: null,
                                  lastName: null,
                                  email: null,
                                  phone: null,
                                  mobile: null,
                                });
                              }
                            }, 10);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <div
                  onClick={() => setIsAddressOpen(!isAddressOpen)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    paddingBottom: '8px',
                    marginBottom: isAddressOpen ? '12px' : 0,
                    borderBottom: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      ...sectionHeaderStyle,
                      borderBottom: 'none',
                      marginBottom: 0,
                      paddingBottom: 0,
                    }}
                  >
                    Address
                  </div>
                  {isAddressOpen ? (
                    <ChevronUp size={16} color="#0062ff" />
                  ) : (
                    <ChevronDown size={16} color="#0062ff" />
                  )}
                </div>

                {isAddressOpen && (
                  <div>
                    <div style={{ marginBottom: '16px' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div style={labelStyle}>Billing Address</div>
                        {vendor.billingStreet1 && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => {
                                setAddressEditIndex(null);
                                setAddressModalType('billing');
                              }}
                              style={{
                                border: 'none',
                                background: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                color: '#64748b',
                              }}
                              title="Edit Address"
                            >
                              <Pencil size={12} />
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
                            style={{
                              color: '#0062ff',
                              textDecoration: 'none',
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              fontSize: '12px',
                            }}
                          >
                            New Address
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div style={labelStyle}>Shipping Address</div>
                        {vendor.shippingStreet1 && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => {
                                setAddressEditIndex(null);
                                setAddressModalType('shipping');
                              }}
                              style={{
                                border: 'none',
                                background: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                color: '#64748b',
                              }}
                              title="Edit Address"
                            >
                              <Pencil size={12} />
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
                            style={{
                              color: '#0062ff',
                              textDecoration: 'none',
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              fontSize: '12px',
                            }}
                          >
                            New Address
                          </button>
                        </div>
                      )}
                    </div>

                    {vendor.addresses
                      ?.filter(
                        (a: VendorAddress) =>
                          a.addressType !== 'billing' && a.addressType !== 'shipping',
                      )
                      .map((addr: VendorAddress, index: number) => (
                        <div key={index} style={{ marginTop: '12px' }}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <div style={labelStyle}>Additional Address</div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => {
                                  setAddressEditIndex(index);
                                  setAddressModalType('additional');
                                }}
                                style={{
                                  border: 'none',
                                  background: 'none',
                                  cursor: 'pointer',
                                  padding: 0,
                                  color: '#64748b',
                                }}
                                title="Edit Address"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                onClick={() => {
                                  if (
                                    window.confirm('Are you sure you want to remove this address?')
                                  )
                                    deleteAdditionalAddressMutation.mutate(index);
                                }}
                                style={{
                                  border: 'none',
                                  background: 'none',
                                  cursor: 'pointer',
                                  padding: 0,
                                  color: '#64748b',
                                }}
                                title="Remove Address"
                              >
                                <Trash size={12} />
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize: '12px', color: '#333' }}>
                            {addr.attention && (
                              <>
                                {addr.attention}
                                <br />
                              </>
                            )}
                            {addr.street1 && (
                              <>
                                {addr.street1}
                                <br />
                              </>
                            )}
                            {addr.street2 && (
                              <>
                                {addr.street2}
                                <br />
                              </>
                            )}
                            {addr.city && <>{addr.city}, </>}
                            {addr.state}
                            <br />
                            {addr.country} {addr.pinCode}
                            {addr.phone && (
                              <>
                                <br />
                                Phone: {addr.phone}
                              </>
                            )}
                          </div>
                        </div>
                      ))}

                    <div style={{ marginTop: '12px' }}>
                      <button
                        onClick={() => setAddressModalType('additional')}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#0062ff',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: '13px',
                        }}
                      >
                        + Add additional address
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div
                  onClick={() => setIsOtherDetailsOpen(!isOtherDetailsOpen)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    paddingTop: '10px',
                    paddingBottom: '8px',
                    marginBottom: isOtherDetailsOpen ? '12px' : 0,
                    borderBottom: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      ...sectionHeaderStyle,
                      borderBottom: 'none',
                      marginBottom: 0,
                      paddingBottom: 0,
                    }}
                  >
                    Other Details
                  </div>
                  {isOtherDetailsOpen ? (
                    <ChevronUp size={16} color="#0062ff" />
                  ) : (
                    <ChevronDown size={16} color="#0062ff" />
                  )}
                </div>

                {isOtherDetailsOpen && (
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
                )}
              </div>

              <div>
                <div
                  onClick={() => setIsContactPersonOpen(!isContactPersonOpen)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    paddingTop: '10px',
                    paddingBottom: '8px',
                    marginBottom: isContactPersonOpen ? '12px' : 0,
                    borderBottom: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      ...sectionHeaderStyle,
                      borderBottom: 'none',
                      marginBottom: 0,
                      paddingBottom: 0,
                    }}
                  >
                    Contact Persons
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setContactPersonEditIndex(null);
                        setIsContactPersonModalOpen(true);
                      }}
                      style={{
                        background: '#3b82f6',
                        border: 'none',
                        borderRadius: '50%',
                        width: '15px',
                        height: '15px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      <Plus size={10} color="#fff" />
                    </button>
                    {isContactPersonOpen ? (
                      <ChevronUp size={16} color="#0062ff" />
                    ) : (
                      <ChevronDown size={16} color="#0062ff" />
                    )}
                  </div>
                </div>

                {isContactPersonOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {vendor.contactPersons && vendor.contactPersons.length > 0 ? (
                      vendor.contactPersons.map((contact: VendorContactPerson, index: number) => {
                        const hasName = contact.firstName || contact.lastName;
                        return (
                          <div
                            key={index}
                            style={{
                              marginBottom: '16px',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '12px',
                            }}
                          >
                            <div
                              style={{
                                width: '40px',
                                height: '40px',
                                backgroundColor: '#e2e8f0',
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              <User size={24} color="#fff" />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '14px', fontWeight: 500, color: '#0f172a' }}>
                                {hasName
                                  ? `${contact.salutation || ''} ${contact.firstName || ''} ${contact.lastName || ''}`.trim()
                                  : 'Unnamed Contact'}
                              </div>
                              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                {contact.email && <div>Email: {contact.email}</div>}
                                {contact.phone && <div>Phone: {contact.phone}</div>}
                                {contact.mobile && <div>Mobile: {contact.mobile}</div>}
                              </div>
                            </div>
                            <div style={{ position: 'relative' }}>
                              <button
                                onClick={() =>
                                  setActiveContactPersonMenu(
                                    activeContactPersonMenu === index ? null : index,
                                  )
                                }
                                onMouseEnter={() => setHoveredSettingsIcon(index)}
                                onMouseLeave={() => setHoveredSettingsIcon(null)}
                                style={{
                                  border: 'none',
                                  background: 'none',
                                  cursor: 'pointer',
                                  padding: '4px',
                                  color:
                                    hoveredSettingsIcon === index ||
                                    activeContactPersonMenu === index
                                      ? '#64748b'
                                      : '#cbd5e1',
                                  transition: 'color 0.2s ease',
                                }}
                              >
                                <Settings size={16} />
                              </button>
                              {activeContactPersonMenu === index && (
                                <>
                                  <div
                                    onClick={() => setActiveContactPersonMenu(null)}
                                    style={{
                                      position: 'fixed',
                                      top: 0,
                                      left: 0,
                                      right: 0,
                                      bottom: 0,
                                      zIndex: 40,
                                    }}
                                  />
                                  <div
                                    style={{
                                      position: 'absolute',
                                      top: '100%',
                                      right: 0,
                                      marginTop: '4px',
                                      backgroundColor: '#fff',
                                      border: '1px solid #e2e8f0',
                                      borderRadius: '6px',
                                      boxShadow:
                                        '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                                      padding: '4px',
                                      zIndex: 50,
                                      minWidth: '160px',
                                      overflow: 'hidden',
                                    }}
                                  >
                                    <button
                                      onMouseEnter={() => setHoveredContactPersonSetting('Edit')}
                                      onClick={() => {
                                        setContactPersonEditIndex(index);
                                        setIsContactPersonModalOpen(true);
                                        setActiveContactPersonMenu(null);
                                      }}
                                      style={{
                                        display: 'block',
                                        width: '100%',
                                        padding: '8px 12px',
                                        textAlign: 'left',
                                        backgroundColor:
                                          hoveredContactPersonSetting === 'Edit'
                                            ? '#3b82f6'
                                            : 'transparent',
                                        color:
                                          hoveredContactPersonSetting === 'Edit'
                                            ? '#fff'
                                            : '#334155',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                        borderRadius: '4px',
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onMouseEnter={() =>
                                        setHoveredContactPersonSetting('Mark as Primary')
                                      }
                                      onClick={() => {
                                        markAsPrimaryMutation.mutate(index);
                                        setActiveContactPersonMenu(null);
                                      }}
                                      style={{
                                        display: 'block',
                                        width: '100%',
                                        padding: '8px 12px',
                                        textAlign: 'left',
                                        backgroundColor:
                                          hoveredContactPersonSetting === 'Mark as Primary'
                                            ? '#3b82f6'
                                            : 'transparent',
                                        color:
                                          hoveredContactPersonSetting === 'Mark as Primary'
                                            ? '#fff'
                                            : '#334155',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                        borderRadius: '4px',
                                        marginTop: '2px',
                                      }}
                                    >
                                      Mark as Primary
                                    </button>
                                    <button
                                      onMouseEnter={() => setHoveredContactPersonSetting('Delete')}
                                      onClick={() => {
                                        setActiveContactPersonMenu(null);
                                        setTimeout(() => {
                                          if (
                                            window.confirm(
                                              'Are you sure you want to remove this contact person?',
                                            )
                                          ) {
                                            deleteContactPersonMutation.mutate(index);
                                          }
                                        }, 10);
                                      }}
                                      style={{
                                        display: 'block',
                                        width: '100%',
                                        padding: '8px 12px',
                                        textAlign: 'left',
                                        backgroundColor:
                                          hoveredContactPersonSetting === 'Delete'
                                            ? '#3b82f6'
                                            : 'transparent',
                                        color:
                                          hoveredContactPersonSetting === 'Delete'
                                            ? '#fff'
                                            : '#334155',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                        borderRadius: '4px',
                                        marginTop: '2px',
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div
                        style={{
                          fontSize: '13px',
                          color: '#64748b',
                          textAlign: 'center',
                          padding: '16px 0',
                        }}
                      >
                        No contact persons found.
                      </div>
                    )}
                  </div>
                )}
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
                borderTopRightRadius: '8px',
                borderBottomRightRadius: '8px',
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
          addressModalType === 'billing'
            ? 'Billing Address'
            : addressModalType === 'shipping'
              ? 'Shipping Address'
              : 'Additional Address'
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

      <PrimaryContactModal
        isOpen={isPrimaryContactModalOpen}
        onClose={() => setIsPrimaryContactModalOpen(false)}
        onSubmit={(data) => updatePrimaryContactMutation.mutate(data)}
        initialData={{
          salutation: vendor.primaryContactSalutation,
          firstName: vendor.primaryContactFirstName,
          lastName: vendor.primaryContactLastName,
          email: vendor.email,
          phone: vendor.phone,
          mobile: vendor.mobile,
        }}
        title="Edit Primary Contact"
      />

      <PrimaryContactModal
        isOpen={isContactPersonModalOpen}
        onClose={() => {
          setIsContactPersonModalOpen(false);
          setContactPersonEditIndex(null);
        }}
        onSubmit={(data) => saveContactPersonMutation.mutate(data)}
        initialData={
          contactPersonEditIndex !== null && vendor.contactPersons
            ? vendor.contactPersons[contactPersonEditIndex]
            : null
        }
        title={contactPersonEditIndex !== null ? 'Edit Contact Person' : 'Add Contact Person'}
      />
    </div>
  );
}
