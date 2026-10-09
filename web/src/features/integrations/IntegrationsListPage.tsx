import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock, ShieldCheck, Sparkles, RefreshCw } from 'lucide-react';
import { useZohoStatus } from './zoho/zoho.api';

export function IntegrationsListPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();

  const { data: zohoStatus, isLoading: isZohoLoading } = useZohoStatus(orgId || '');

  const isZohoConnected = zohoStatus?.isConnected;
  const isZohoAuthorized = zohoStatus?.isAuthorized;
  const isZohoConfigured = zohoStatus?.isConfigured;

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#fff',
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '0 32px',
          height: '60px',
          flexShrink: 0,
          boxSizing: 'border-box',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--navy-900)', margin: 0 }}>
            Integrations
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', margin: '2px 0 0 0' }}>
            Connect third-party accounting and ERP software to streamline your jobwork workflows.
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
        <div style={{ maxWidth: '1000px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Section Description Banner */}
          <div
            style={{
              padding: '16px 20px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              color: '#334155',
              fontSize: '14px',
            }}
          >
            <Sparkles size={18} color="var(--color-primary)" style={{ flexShrink: 0 }} />
            <span>
              Manage OAuth connections and credentials for accounting systems. One Job Work organization can be mapped to one active accounting organization.
            </span>
          </div>

          {/* Integrations Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '20px',
            }}
          >
            {/* 1. Zoho Books Card (Active/Available) */}
            <div
              style={{
                backgroundColor: '#fff',
                border: '1px solid var(--color-border)',
                borderRadius: '10px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '8px',
                      backgroundColor: '#1e40af',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '18px',
                      letterSpacing: '-0.5px',
                    }}
                  >
                    ZB
                  </div>

                  {/* Status Badge */}
                  {isZohoLoading ? (
                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <RefreshCw size={12} className="animate-spin" /> Checking...
                    </span>
                  ) : isZohoConnected ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 10px',
                        borderRadius: '16px',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor: '#dcfce7',
                        color: '#15803d',
                      }}
                    >
                      <CheckCircle2 size={13} /> Connected
                    </span>
                  ) : isZohoAuthorized ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 10px',
                        borderRadius: '16px',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor: '#fef3c7',
                        color: '#b45309',
                      }}
                    >
                      <ShieldCheck size={13} /> Setup Pending
                    </span>
                  ) : isZohoConfigured ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 10px',
                        borderRadius: '16px',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor: '#eff6ff',
                        color: '#1d4ed8',
                      }}
                    >
                      Configured
                    </span>
                  ) : (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 10px',
                        borderRadius: '16px',
                        fontSize: '12px',
                        fontWeight: 500,
                        backgroundColor: '#f3f4f6',
                        color: '#4b5563',
                      }}
                    >
                      Not Connected
                    </span>
                  )}
                </div>

                <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--navy-900)', margin: '0 0 6px 0' }}>
                  Zoho Books
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                  Connect your Zoho Books organization using OAuth 2.0 to synchronize chart of accounts, vendors, and bills.
                </p>

                {isZohoConnected && zohoStatus?.selectedOrganizationName && (
                  <div
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#f0fdf4',
                      borderRadius: '6px',
                      border: '1px solid #bbf7d0',
                      fontSize: '12px',
                      color: '#166534',
                      marginBottom: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <CheckCircle2 size={14} color="#16a34a" />
                    <span>Mapped to: <strong>{zohoStatus.selectedOrganizationName}</strong></span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => navigate(`/organizations/${orgId}/settings/integrations/zoho`)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '9px 16px',
                  backgroundColor: 'var(--navy-900)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                  width: '100%',
                }}
              >
                {isZohoConnected ? 'Manage Integration' : 'Configure & Connect'}
                <ArrowRight size={15} />
              </button>
            </div>

            {/* 2. Tally Card (Coming Soon) */}
            <div
              style={{
                backgroundColor: '#fff',
                border: '1px solid var(--color-border)',
                borderRadius: '10px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                opacity: 0.85,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '8px',
                      backgroundColor: '#0f766e',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '18px',
                      letterSpacing: '-0.5px',
                    }}
                  >
                    TP
                  </div>

                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 10px',
                      borderRadius: '16px',
                      fontSize: '12px',
                      fontWeight: 600,
                      backgroundColor: '#f1f5f9',
                      color: '#64748b',
                    }}
                  >
                    <Clock size={12} /> Coming Soon
                  </span>
                </div>

                <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--navy-900)', margin: '0 0 6px 0' }}>
                  TallyPrime
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                  Export jobwork challans, material transfers, and bills directly to your TallyPrime company.
                </p>
              </div>

              <button
                type="button"
                disabled
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '9px 16px',
                  backgroundColor: '#f1f5f9',
                  color: '#94a3b8',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'not-allowed',
                  width: '100%',
                }}
              >
                Coming Soon
              </button>
            </div>

            {/* 3. QuickBooks Card (Coming Soon) */}
            <div
              style={{
                backgroundColor: '#fff',
                border: '1px solid var(--color-border)',
                borderRadius: '10px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                opacity: 0.85,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '8px',
                      backgroundColor: '#2e7d32',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '18px',
                      letterSpacing: '-0.5px',
                    }}
                  >
                    QB
                  </div>

                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 10px',
                      borderRadius: '16px',
                      fontSize: '12px',
                      fontWeight: 600,
                      backgroundColor: '#f1f5f9',
                      color: '#64748b',
                    }}
                  >
                    <Clock size={12} /> Coming Soon
                  </span>
                </div>

                <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--navy-900)', margin: '0 0 6px 0' }}>
                  QuickBooks Online
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                  Synchronize vendors, purchase orders, invoices, and payments with QuickBooks Online.
                </p>
              </div>

              <button
                type="button"
                disabled
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '9px 16px',
                  backgroundColor: '#f1f5f9',
                  color: '#94a3b8',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'not-allowed',
                  width: '100%',
                }}
              >
                Coming Soon
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
