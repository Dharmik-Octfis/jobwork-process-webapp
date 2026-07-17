import { useQuery } from '@tanstack/react-query';
import { fetchVendors } from './vendors.api';
import { Plus, ChevronDown, Building2, Users, Mail, Phone } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

export function VendorsList() {
  const navigate = useNavigate();
  // The organization comes from the URL, so this page is bookmarkable and two
  // tabs can show two different organizations at once.
  const { orgId } = useParams<{ orgId: string }>();
  const { data: vendors = [], isLoading } = useQuery({
    // orgId is in the key: switching organization must refetch, not reuse the
    // previous organization's cached list.
    queryKey: ['vendors', orgId],
    queryFn: () => fetchVendors(orgId!),
    enabled: Boolean(orgId),
  });

  return (
    <div
      style={{
        padding: 'var(--space-6) var(--space-5)',
        maxWidth: 1200,
        margin: '0 auto',
        width: '100%',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--color-text)',
              margin: '0 0 4px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Users size={22} color="var(--color-primary)" />
            Vendors
          </h1>
          <ChevronDown size={20} color="#2563eb" />
        </div>
        <button
          onClick={() => navigate(`/organizations/${orgId}/purchases/vendors/new`)}
          style={{
            background: 'var(--color-primary)',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 500,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: 'var(--shadow-sm)',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-primary-dark)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-primary)')}
        >
          <Plus size={18} /> New Vendor
        </button>
      </header>

      {isLoading ? (
        <div
          style={{
            padding: 'var(--space-8)',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
          }}
        >
          Loading vendors...
        </div>
      ) : vendors.length === 0 ? (
        <div
          style={{
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-lg)',
            border: '1px dashed var(--color-border)',
            padding: 'var(--space-8) var(--space-6)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            minHeight: 400,
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: 'var(--color-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 'var(--space-4)',
            }}
          >
            <Building2 size={40} color="var(--color-text-muted)" />
          </div>
          <h2
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: 'var(--color-text)',
              margin: '0 0 var(--space-2) 0',
            }}
          >
            No Vendors Yet
          </h2>
          <p
            style={{
              color: 'var(--color-text-muted)',
              maxWidth: 400,
              margin: '0 0 var(--space-5) 0',
              lineHeight: 1.5,
            }}
          >
            You haven't added any vendors yet. Create your first vendor to start creating purchase
            orders and bills.
          </p>
          <button
            onClick={() => navigate(`/organizations/${orgId}/purchases/vendors/new`)}
            style={{
              background: 'white',
              color: 'var(--color-primary)',
              border: '1px solid var(--color-primary)',
              padding: '10px 24px',
              borderRadius: 'var(--radius-md)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Create Vendor
          </button>
        </div>
      ) : (
        <div
          style={{
            background: 'white',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr
                style={{
                  background: 'var(--color-bg)',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <th
                  style={{
                    padding: '8px 12px',
                    fontWeight: 600,
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                  }}
                >
                  Vendor Name
                </th>
                <th
                  style={{
                    padding: '8px 12px',
                    fontWeight: 600,
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                  }}
                >
                  Vendor Number
                </th>
                <th
                  style={{
                    padding: '8px 12px',
                    fontWeight: 600,
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                  }}
                >
                  Contact
                </th>
                <th
                  style={{
                    padding: '8px 12px',
                    fontWeight: 600,
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                  }}
                >
                  GST Treatment
                </th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((vendor) => (
                <tr key={vendor.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500, color: 'var(--color-text)' }}>
                    {vendor.vendorName}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--color-text)' }}>
                    {vendor.vendorNumber}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--color-text)' }}>
                    {vendor.emailAddress && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <Mail size={14} color="var(--color-text-muted)" /> {vendor.emailAddress}
                      </div>
                    )}
                    {vendor.phone && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 13,
                          marginTop: 4,
                        }}
                      >
                        <Phone size={14} color="var(--color-text-muted)" /> {vendor.phone}
                      </div>
                    )}
                    {!vendor.emailAddress && !vendor.phone && (
                      <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'var(--color-bg)',
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--color-text)',
                      }}
                    >
                      {vendor.gstTreatment}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
