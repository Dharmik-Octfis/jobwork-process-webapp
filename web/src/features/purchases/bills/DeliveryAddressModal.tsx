import { X, Check } from 'lucide-react';
import type { Location } from '../../configuration/locations/locations.api';
import type { Customer } from '../../sales/customers/customers.api';

interface DeliveryAddressModalProps {
  isOpen: boolean;
  onClose: () => void;
  deliveryType: string;
  locations: Location[];
  customers: Customer[];
  selectedLocationId?: string | null;
  selectedCustomerId?: string | null;
  onSelectLocation: (locationId: string) => void;
  onSelectCustomer: (customerId: string) => void;
}

export function DeliveryAddressModal({
  isOpen,
  onClose,
  deliveryType,
  locations,
  customers,
  selectedLocationId,
  selectedCustomerId,
  onSelectLocation,
  onSelectCustomer,
}: DeliveryAddressModalProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          width: '380px',
          maxWidth: '90%',
          maxHeight: '450px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        {/* Compact Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid #eef0f3',
            backgroundColor: '#fff',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#111' }}>
            Select Delivery Address
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#666',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Compact Body */}
        <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1, backgroundColor: '#f9fafb' }}>
          {deliveryType === 'Location' && (
            <div>
              {locations.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: '#666', fontSize: '13px' }}>
                  No locations available.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {locations.map((loc) => {
                    const isSelected = selectedLocationId === loc.id;
                    const addressString = [
                      loc.street1,
                      loc.street2,
                      loc.city,
                      loc.state,
                      loc.zip,
                    ]
                      .filter(Boolean)
                      .join(', ');

                    return (
                      <div
                        key={loc.id}
                        onClick={() => {
                          onSelectLocation(loc.id);
                          onClose();
                        }}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '6px',
                          border: isSelected ? '1.5px solid #0062ff' : '1px solid #e2e8f0',
                          backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                            {loc.name}
                          </span>
                          {isSelected && <Check size={16} color="#0062ff" />}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.4' }}>
                          {addressString || <span style={{ fontStyle: 'italic', color: '#94a3b8' }}>No address details</span>}
                          {loc.phone && <div style={{ marginTop: '2px', color: '#475569' }}>Ph: {loc.phone}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {deliveryType === 'Customer' && (
            <div>
              {customers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: '#666', fontSize: '13px' }}>
                  No customers available.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {customers.map((cust) => {
                    const isSelected = selectedCustomerId === cust.id;
                    const addressString = [
                      cust.shippingStreet1,
                      cust.shippingStreet2,
                      cust.shippingCity,
                      cust.shippingState,
                      cust.shippingPinCode,
                    ]
                      .filter(Boolean)
                      .join(', ');

                    return (
                      <div
                        key={cust.id}
                        onClick={() => {
                          onSelectCustomer(cust.id);
                          onClose();
                        }}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '6px',
                          border: isSelected ? '1.5px solid #0062ff' : '1px solid #e2e8f0',
                          backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                            {cust.contactName}
                          </span>
                          {isSelected && <Check size={16} color="#0062ff" />}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.4' }}>
                          {addressString || <span style={{ fontStyle: 'italic', color: '#94a3b8' }}>No shipping address details</span>}
                          {cust.shippingPhone && <div style={{ marginTop: '2px', color: '#475569' }}>Ph: {cust.shippingPhone}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
