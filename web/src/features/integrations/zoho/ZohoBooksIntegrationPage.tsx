import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  CheckCircle2,
  AlertCircle,
  Building2,
  ExternalLink,
  RefreshCw,
  Unlink,
  Check,
  ChevronLeft,
  ShieldCheck,
  Calendar,
  Globe,
  Key,
  Lock,
  Info,
  Copy,
  Clock,
} from 'lucide-react';
import {
  useZohoStatus,
  useSaveZohoConfig,
  useZohoConnect,
  useZohoOrganizations,
  useSelectZohoOrganization,
  useDisconnectZoho,
  useRefreshZoho,
} from './zoho.api';
import type { ZohoSyncModuleKey } from './zoho.schemas';
import { ModuleSyncHub } from './components/ModuleSyncHub';
import { ModuleFieldMappingView } from './components/ModuleFieldMappingView';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { toApiErrorMessage } from '../../../api/client';

export function ZohoBooksIntegrationPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Form states for Client ID / Secret
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [dataCenter, setDataCenter] = useState('IN');
  const [isEditingSecret, setIsEditingSecret] = useState(false);

  // Flow states
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [isChangingOrg, setIsChangingOrg] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPopupAuthorizing, setIsPopupAuthorizing] = useState(false);
  const [activeMappingModule, setActiveMappingModule] = useState<ZohoSyncModuleKey | null>(null);

  // Check URL query param for direct module opening (e.g. ?module=item)
  useEffect(() => {
    const modParam = searchParams.get('module');
    if (modParam === 'item' || modParam === 'customer' || modParam === 'vendor') {
      setActiveMappingModule(modParam);
    }
  }, [searchParams]);

  // Queries and mutations
  const {
    data: statusData,
    isLoading: isStatusLoading,
    refetch: refetchStatus,
  } = useZohoStatus(orgId || '');

  const saveConfigMutation = useSaveZohoConfig(orgId || '');
  const connectMutation = useZohoConnect(orgId || '');
  const selectOrgMutation = useSelectZohoOrganization(orgId || '');
  const disconnectMutation = useDisconnectZoho(orgId || '');
  const refreshMutation = useRefreshZoho(orgId || '');

  const isConnected = statusData?.isConnected;
  const isAuthorized = statusData?.isAuthorized;
  const isConfigured = statusData?.isConfigured;
  const currentStatus = statusData?.status || 'NOT_CONNECTED';

  // Organizations list query (enabled when authorized or changing org)
  const {
    data: organizations,
    isLoading: isOrgsLoading,
    error: orgsError,
    refetch: refetchOrgs,
  } = useZohoOrganizations(orgId || '', Boolean(isAuthorized || isChangingOrg));

  // Populate client ID & data center if available from server
  useEffect(() => {
    if (statusData?.clientId && !clientId) {
      setClientId(statusData.clientId);
    }
    if (statusData?.zohoLocation) {
      setDataCenter(statusData.zohoLocation);
    }
  }, [statusData?.clientId, statusData?.zohoLocation, clientId]);

  // Set default selected org when organizations load
  useEffect(() => {
    if (organizations && organizations.length > 0) {
      if (statusData?.selectedOrganizationId) {
        setSelectedOrgId(statusData.selectedOrganizationId);
      } else {
        const defaultOrg = organizations.find((o) => o.is_default_org) || organizations[0];
        if (defaultOrg) {
          setSelectedOrgId(defaultOrg.organization_id);
        }
      }
    }
  }, [organizations, statusData?.selectedOrganizationId]);

  // Handle postMessage from OAuth popup
  const handlePopupMessage = useCallback(
    (event: MessageEvent) => {
      // Validate origin
      if (event.origin !== window.location.origin) return;

      const data = event.data;
      if (data && data.type === 'ZOHO_OAUTH_CALLBACK') {
        setIsPopupAuthorizing(false);
        if (data.status === 'authorized') {
          toast.success('Zoho account authorized! Please select your organization.');
          refetchStatus();
          refetchOrgs();
        } else if (data.status === 'error') {
          const msg = data.error || 'Zoho authorization was denied or failed.';
          setErrorMessage(msg);
          toast.error(msg);
          refetchStatus();
        }
      }
    },
    [refetchStatus, refetchOrgs],
  );

  useEffect(() => {
    window.addEventListener('message', handlePopupMessage);
    return () => window.removeEventListener('message', handlePopupMessage);
  }, [handlePopupMessage]);

  // Handle URL search params on mount (fallback for direct redirects)
  useEffect(() => {
    const statusParam = searchParams.get('status');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      const msg = decodeURIComponent(errorParam);
      setErrorMessage(msg);
      toast.error(msg);
      setSearchParams((params) => {
        params.delete('error');
        return params;
      });
    } else if (statusParam === 'authorized') {
      toast.success('Zoho account authorized! Please select your organization.');
      refetchStatus();
      refetchOrgs();
      setSearchParams((params) => {
        params.delete('status');
        return params;
      });
    }
  }, [searchParams, setSearchParams, refetchStatus, refetchOrgs]);

  // Save Credentials (Client ID / Secret / Data Center)
  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    if (!clientId.trim()) {
      toast.error('Client ID is required.');
      return;
    }
    if (!statusData?.hasClientSecret && !clientSecret.trim()) {
      toast.error('Client Secret is required.');
      return;
    }

    setErrorMessage(null);
    try {
      await saveConfigMutation.mutateAsync({
        client_id: clientId.trim(),
        client_secret: clientSecret.trim() ? clientSecret.trim() : undefined,
        data_center: dataCenter,
      });
      setClientSecret('');
      setIsEditingSecret(false);
      toast.success('Zoho credentials saved successfully.');
    } catch (err) {
      const msg = toApiErrorMessage(err);
      setErrorMessage(msg);
      toast.error(msg);
    }
  };

  // Connect to Zoho Books (New Tab Flow)
  const handleConnect = async () => {
    if (!orgId) return;
    if (!isConfigured) {
      toast.error('Please configure your Client ID and Client Secret first.');
      return;
    }

    setErrorMessage(null);
    setIsPopupAuthorizing(true);

    try {
      const result = await connectMutation.mutateAsync();
      if (result?.url) {
        const authTab = window.open(result.url, '_blank');

        if (!authTab || authTab.closed || typeof authTab.closed === 'undefined') {
          // Fallback if popup/tab blocker intervenes
          window.location.href = result.url;
        } else {
          // Monitor when the tab is closed by the user
          const checkClosedInterval = setInterval(() => {
            if (authTab.closed) {
              clearInterval(checkClosedInterval);
              setIsPopupAuthorizing(false);
            }
          }, 1000);
        }
      }
    } catch (err) {
      setIsPopupAuthorizing(false);
      const msg = toApiErrorMessage(err);
      setErrorMessage(msg);
      toast.error(msg);
    }
  };

  // Save selected organization mapping
  const handleSaveOrganization = async () => {
    if (!orgId || !selectedOrgId) {
      toast.error('Please select an organization.');
      return;
    }
    setErrorMessage(null);
    try {
      await selectOrgMutation.mutateAsync({ organization_id: selectedOrgId });
      setIsChangingOrg(false);
      refetchStatus();
      toast.success('Zoho Books connected successfully.');
    } catch (err) {
      const msg = toApiErrorMessage(err);
      setErrorMessage(msg);
      toast.error(msg);
    }
  };

  // Disconnect flow
  const handleDisconnect = async () => {
    if (!orgId) return;
    setErrorMessage(null);
    try {
      await disconnectMutation.mutateAsync();
      setShowDisconnectConfirm(false);
      setIsChangingOrg(false);
      refetchStatus();
      toast.success('Zoho Books disconnected successfully.');
    } catch (err) {
      const msg = toApiErrorMessage(err);
      setErrorMessage(msg);
      toast.error(msg);
    }
  };

  // Test / Verify connection
  const handleRefreshConnection = async () => {
    if (!orgId) return;
    try {
      await refreshMutation.mutateAsync();
      toast.success('Zoho Books connection verified and active.');
    } catch (err) {
      const msg = toApiErrorMessage(err);
      setErrorMessage(msg);
      toast.error(msg);
    }
  };

  // Copy redirect URI helper
  const redirectUri = `${window.location.origin}/api/integrations/zoho/callback`;
  const handleCopyRedirectUri = () => {
    navigator.clipboard.writeText(redirectUri);
    toast.success('Redirect URI copied to clipboard.');
  };

  if (isStatusLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '400px',
          color: 'var(--color-text-muted)',
          fontSize: '14px',
        }}
      >
        <RefreshCw size={20} className="animate-spin" style={{ marginRight: '8px' }} />
        Loading integration status...
      </div>
    );
  }

  const showOrgSelection = (isAuthorized && !isConnected) || isChangingOrg;

  // Compute active step number (1 = Credentials, 2 = Authorization, 3 = Organization / Connected)
  const currentStep = isConnected
    ? 3
    : isAuthorized
      ? 3
      : isConfigured
        ? 2
        : 1;

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#f8fafc',
      }}
    >
      {/* Page Header */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={() => navigate(`/organizations/${orgId}/settings/integrations`)}
            style={{
              background: 'none',
              border: 'none',
              padding: '6px',
              borderRadius: '6px',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Back to Integrations"
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--navy-900)', margin: 0 }}>
              Zoho Books Integration
            </h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', margin: '2px 0 0 0' }}>
              Connect your Zoho Books organization to synchronize financial and accounting data.
            </p>
          </div>
        </div>

        {/* Header Status Pill */}
        <div>
          {isConnected ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: '#dcfce7',
                color: '#15803d',
                border: '1px solid #bbf7d0',
              }}
            >
              <CheckCircle2 size={14} />
              Connected
            </span>
          ) : isAuthorized ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: '#fef3c7',
                color: '#b45309',
                border: '1px solid #fde68a',
              }}
            >
              <ShieldCheck size={14} />
              Setup Pending
            </span>
          ) : currentStatus === 'TOKEN_EXPIRED' ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: '#fee2e2',
                color: '#b91c1c',
                border: '1px solid #fecaca',
              }}
            >
              <Clock size={14} />
              Token Expired
            </span>
          ) : isConfigured ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: '#eff6ff',
                color: '#1d4ed8',
                border: '1px solid #bfdbfe',
              }}
            >
              Ready to Authorize
            </span>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: 500,
                backgroundColor: '#f3f4f6',
                color: '#4b5563',
                border: '1px solid #e5e7eb',
              }}
            >
              Not Configured
            </span>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
        {activeMappingModule ? (
          <div style={{ maxWidth: '960px', margin: '0 auto' }}>
            <ModuleFieldMappingView
              orgId={orgId || ''}
              module={activeMappingModule}
              onBack={() => {
                setActiveMappingModule(null);
                setSearchParams((p) => {
                  p.delete('module');
                  return p;
                });
              }}
            />
          </div>
        ) : (
          <div style={{ maxWidth: '840px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Error Banner */}
            {errorMessage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '14px 16px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                color: '#991b1b',
                fontSize: '14px',
              }}
            >
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ flex: 1 }}>
                <strong style={{ display: 'block', marginBottom: '2px' }}>Integration Notice</strong>
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#991b1b',
                  cursor: 'pointer',
                  fontSize: '16px',
                  padding: 0,
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Stepper Progress Bar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isConnected ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)',
              gap: '12px',
              backgroundColor: '#fff',
              padding: '16px 20px',
              borderRadius: '10px',
              border: '1px solid var(--color-border)',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
            }}
          >
            {/* Step 1 Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px',
                  fontWeight: 700,
                  backgroundColor: isConfigured ? '#dcfce7' : currentStep === 1 ? 'var(--navy-900)' : '#f1f5f9',
                  color: isConfigured ? '#16a34a' : currentStep === 1 ? '#fff' : '#64748b',
                  border: isConfigured ? '1px solid #86efac' : 'none',
                  flexShrink: 0,
                }}
              >
                {isConfigured ? <Check size={14} strokeWidth={3} /> : '1'}
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy-900)' }}>
                  1. Credentials
                </div>
                <div style={{ fontSize: '11px', color: isConfigured ? '#16a34a' : '#64748b' }}>
                  {isConfigured ? 'Configured' : 'Client ID & Secret'}
                </div>
              </div>
            </div>

            {/* Step 2 Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px',
                  fontWeight: 700,
                  backgroundColor: isAuthorized ? '#dcfce7' : currentStep === 2 ? 'var(--navy-900)' : '#f1f5f9',
                  color: isAuthorized ? '#16a34a' : currentStep === 2 ? '#fff' : '#64748b',
                  border: isAuthorized ? '1px solid #86efac' : 'none',
                  flexShrink: 0,
                }}
              >
                {isAuthorized ? <Check size={14} strokeWidth={3} /> : '2'}
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: isConfigured ? 'var(--navy-900)' : '#94a3b8' }}>
                  2. Authorize
                </div>
                <div style={{ fontSize: '11px', color: isAuthorized ? '#16a34a' : '#64748b' }}>
                  {isAuthorized ? 'Authorized' : 'Zoho OAuth Consent'}
                </div>
              </div>
            </div>

            {/* Step 3 Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px',
                  fontWeight: 700,
                  backgroundColor: isConnected ? '#dcfce7' : currentStep === 3 ? 'var(--navy-900)' : '#f1f5f9',
                  color: isConnected ? '#16a34a' : currentStep === 3 ? '#fff' : '#64748b',
                  border: isConnected ? '1px solid #86efac' : 'none',
                  flexShrink: 0,
                }}
              >
                {isConnected ? <Check size={14} strokeWidth={3} /> : '3'}
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: isAuthorized ? 'var(--navy-900)' : '#94a3b8' }}>
                  3. Organization
                </div>
                <div style={{ fontSize: '11px', color: isConnected ? '#16a34a' : '#64748b' }}>
                  {isConnected ? 'Connected' : 'Select Zoho Org'}
                </div>
              </div>
            </div>

            {/* Step 4 Indicator (when connected) */}
            {isConnected && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '13px',
                    fontWeight: 700,
                    backgroundColor: 'var(--navy-900)',
                    color: '#fff',
                    flexShrink: 0,
                  }}
                >
                  4
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy-900)' }}>
                    4. Module Sync
                  </div>
                  <div style={{ fontSize: '11px', color: '#16a34a' }}>
                    Mapping & Auto-sync
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* STEP 1: OAuth Application Credentials Card */}
          <div
            style={{
              backgroundColor: '#fff',
              border: isConfigured ? '1px solid var(--color-border)' : '2px solid #3b82f6',
              borderRadius: '10px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '18px 24px',
                borderBottom: '1px solid var(--color-border)',
                backgroundColor: '#fafafa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--navy-900)',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  1
                </span>
                <Key size={18} color="var(--navy-900)" />
                <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--navy-900)', margin: 0 }}>
                  OAuth Application Credentials
                </h2>
              </div>

              {isConfigured && (
                <span style={{ fontSize: '12px', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                  <CheckCircle2 size={14} /> Credentials Saved
                </span>
              )}
            </div>

            <form onSubmit={handleSaveCredentials} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: 0, lineHeight: '1.5' }}>
                Create a Server-based Application in the{' '}
                <a
                  href="https://api-console.zoho.in"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#2563eb', textDecoration: 'underline', fontWeight: 500 }}
                >
                  Zoho API Console <ExternalLink size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />
                </a>{' '}
                and enter your organization credentials below.
              </p>

              {/* Redirect URI Info Callout */}
              <div
                style={{
                  padding: '14px 16px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Info size={14} color="#2563eb" />
                  Authorized Redirect URI (paste this in Zoho Developer Console):
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <code
                    style={{
                      flex: 1,
                      backgroundColor: '#fff',
                      border: '1px solid #cbd5e1',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      color: '#1e293b',
                      userSelect: 'all',
                    }}
                  >
                    {redirectUri}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyRedirectUri}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '6px 12px',
                      backgroundColor: '#fff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      color: '#334155',
                    }}
                  >
                    <Copy size={13} /> Copy
                  </button>
                </div>
              </div>

              {/* Zoho Data Center / Domain */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="zoho-data-center" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy-900)' }}>
                  Zoho Accounts Region / Data Center <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <select
                  id="zoho-data-center"
                  value={dataCenter}
                  onChange={(e) => setDataCenter(e.target.value)}
                  style={{
                    padding: '9px 12px',
                    fontSize: '14px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    backgroundColor: '#fff',
                    color: '#111827',
                    outline: 'none',
                  }}
                >
                  <option value="IN">India (.in) — accounts.zoho.in (api-console.zoho.in)</option>
                  <option value="US">United States (.com) — accounts.zoho.com (api-console.zoho.com)</option>
                  <option value="EU">Europe (.eu) — accounts.zoho.eu (api-console.zoho.eu)</option>
                  <option value="AU">Australia (.com.au) — accounts.zoho.com.au (api-console.zoho.com.au)</option>
                  <option value="JP">Japan (.jp) — accounts.zoho.jp (api-console.zoho.jp)</option>
                  <option value="CA">Canada (.ca) — accounts.zohocloud.ca (api-console.zohocloud.ca)</option>
                  <option value="SA">Saudi Arabia (.sa) — accounts.zoho.sa (api-console.zoho.sa)</option>
                  <option value="CN">China (.com.cn) — accounts.zoho.com.cn (api-console.zoho.com.cn)</option>
                </select>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Select the domain matching your Zoho Developer Console URL (e.g. <code>api-console.zoho.in</code>).
                </span>
              </div>

              {/* Client ID */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="zoho-client-id" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy-900)' }}>
                  Zoho Client ID <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  id="zoho-client-id"
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="e.g. 1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                  required
                  style={{
                    padding: '9px 12px',
                    fontSize: '14px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    backgroundColor: '#fff',
                    color: '#111827',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Client Secret */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label htmlFor="zoho-client-secret" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy-900)' }}>
                    Zoho Client Secret <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  {statusData?.hasClientSecret && !isEditingSecret && (
                    <button
                      type="button"
                      onClick={() => setIsEditingSecret(true)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#2563eb',
                        fontSize: '12px',
                        cursor: 'pointer',
                        padding: 0,
                        textDecoration: 'underline',
                      }}
                    >
                      Replace Secret
                    </button>
                  )}
                </div>

                {statusData?.hasClientSecret && !isEditingSecret ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '9px 12px',
                      backgroundColor: '#f9fafb',
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px',
                      fontSize: '14px',
                      color: '#4b5563',
                      letterSpacing: '2px',
                    }}
                  >
                    <span>••••••••••••••••••••••••••••••••</span>
                    <Lock size={14} color="#9ca3af" />
                  </div>
                ) : (
                  <input
                    id="zoho-client-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={statusData?.hasClientSecret ? 'Enter new Client Secret to replace...' : 'Enter your Zoho Client Secret'}
                    required={!statusData?.hasClientSecret}
                    style={{
                      padding: '9px 12px',
                      fontSize: '14px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      backgroundColor: '#fff',
                      color: '#111827',
                      outline: 'none',
                    }}
                  />
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                <button
                  type="submit"
                  disabled={saveConfigMutation.isPending}
                  style={{
                    padding: '9px 20px',
                    backgroundColor: 'var(--navy-900)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: saveConfigMutation.isPending ? 'not-allowed' : 'pointer',
                    opacity: saveConfigMutation.isPending ? 0.7 : 1,
                  }}
                >
                  {saveConfigMutation.isPending ? 'Saving...' : 'Save Credentials'}
                </button>

                {isEditingSecret && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingSecret(false);
                      setClientSecret('');
                    }}
                    style={{
                      padding: '9px 16px',
                      backgroundColor: '#fff',
                      color: '#374151',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* STEP 2: Account Authorization Card */}
          <div
            style={{
              backgroundColor: '#fff',
              border: isAuthorized ? '1px solid var(--color-border)' : currentStep === 2 ? '2px solid #3b82f6' : '1px solid var(--color-border)',
              borderRadius: '10px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
              overflow: 'hidden',
              opacity: !isConfigured ? 0.6 : 1,
            }}
          >
            <div
              style={{
                padding: '18px 24px',
                borderBottom: '1px solid var(--color-border)',
                backgroundColor: '#fafafa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: isAuthorized ? '#16a34a' : 'var(--navy-900)',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  2
                </span>
                <ShieldCheck size={18} color="var(--navy-900)" />
                <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--navy-900)', margin: 0 }}>
                  Account Authorization
                </h2>
              </div>

              {isAuthorized && (
                <span style={{ fontSize: '12px', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                  <CheckCircle2 size={14} /> Authorized
                </span>
              )}
            </div>

            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {!isConfigured ? (
                <div style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>
                  Please configure and save your <strong>Client ID and Client Secret in Step 1</strong> above before initiating authorization.
                </div>
              ) : isAuthorized ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div
                    style={{
                      padding: '12px 16px',
                      backgroundColor: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#166534', fontSize: '14px', fontWeight: 500 }}>
                      <CheckCircle2 size={18} color="#16a34a" />
                      <span>Zoho Books account authorized successfully with offline refresh access.</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleConnect}
                      disabled={isPopupAuthorizing || connectMutation.isPending}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: '#fff',
                        color: '#2563eb',
                        border: '1px solid #bfdbfe',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <ExternalLink size={13} />
                      Re-authorize
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <p style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: '1.6', margin: 0 }}>
                    Click below to open Zoho Accounts in a secure authorization window and grant consent for this organization.
                  </p>

                  <div
                    style={{
                      backgroundColor: '#f8fafc',
                      padding: '14px 16px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      color: '#475569',
                    }}
                  >
                    <Check size={16} color="#16a34a" />
                    <span>Requested Scope: <code>ZohoBooks.fullaccess.all</code> (Organizations, Chart of Accounts, Bills, Vendors)</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                    <button
                      type="button"
                      onClick={handleConnect}
                      disabled={isPopupAuthorizing || connectMutation.isPending || !isConfigured}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 22px',
                        backgroundColor: isConfigured ? 'var(--navy-900)' : '#94a3b8',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: isConfigured && !isPopupAuthorizing ? 'pointer' : 'not-allowed',
                        opacity: isPopupAuthorizing ? 0.7 : 1,
                        transition: 'background-color 0.2s',
                      }}
                    >
                      {isPopupAuthorizing ? (
                        <>
                          <RefreshCw size={16} className="animate-spin" />
                          Waiting for authorization...
                        </>
                      ) : (
                        <>
                          Authorize Zoho Books
                          <ExternalLink size={16} />
                        </>
                      )}
                    </button>

                    {isPopupAuthorizing && (
                      <button
                        type="button"
                        onClick={() => setIsPopupAuthorizing(false)}
                        style={{
                          padding: '9px 16px',
                          backgroundColor: '#f1f5f9',
                          color: '#475569',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* STEP 3: Organization Selection & Connection Card */}
          <div
            style={{
              backgroundColor: '#fff',
              border: isConnected && !isChangingOrg ? '1px solid var(--color-border)' : currentStep === 3 ? '2px solid #16a34a' : '1px solid var(--color-border)',
              borderRadius: '10px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
              overflow: 'hidden',
              opacity: !isAuthorized ? 0.6 : 1,
            }}
          >
            <div
              style={{
                padding: '18px 24px',
                borderBottom: '1px solid var(--color-border)',
                backgroundColor: '#fafafa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: isConnected ? '#16a34a' : 'var(--navy-900)',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  3
                </span>
                <Building2 size={18} color="var(--navy-900)" />
                <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--navy-900)', margin: 0 }}>
                  Organization Mapping & Status
                </h2>
              </div>

              {isConnected && (
                <span style={{ fontSize: '12px', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                  <CheckCircle2 size={14} /> Connected
                </span>
              )}
            </div>

            <div style={{ padding: '24px' }}>
              {!isAuthorized ? (
                <div style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>
                  Please complete <strong>Step 2 (Account Authorization)</strong> above to load and select your Zoho Books organization.
                </div>
              ) : showOrgSelection ? (
                /* Organization Selection Form */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div
                    style={{
                      padding: '14px 16px',
                      backgroundColor: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      color: '#166534',
                      fontSize: '14px',
                      fontWeight: 500,
                    }}
                  >
                    <CheckCircle2 size={18} color="#16a34a" />
                    <span>Zoho account authorized successfully. Select the Zoho Books organization to connect.</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label
                      htmlFor="zoho-org-select"
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: 'var(--navy-900)',
                      }}
                    >
                      Select Zoho Books Organization
                    </label>
                    <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: 0 }}>
                      Only one Zoho Books organization can be connected to this Job Work organization.
                    </p>

                    {isOrgsLoading ? (
                      <div
                        style={{
                          padding: '12px',
                          backgroundColor: '#f9fafb',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '13px',
                          color: '#6b7280',
                          marginTop: '4px',
                        }}
                      >
                        <RefreshCw size={16} className="animate-spin" />
                        Fetching available Zoho Books organizations...
                      </div>
                    ) : orgsError ? (
                      <div
                        style={{
                          padding: '12px',
                          backgroundColor: '#fef2f2',
                          border: '1px solid #fecaca',
                          borderRadius: '6px',
                          fontSize: '13px',
                          color: '#991b1b',
                          marginTop: '4px',
                        }}
                      >
                        Failed to fetch organizations: {toApiErrorMessage(orgsError)}
                        <button
                          type="button"
                          onClick={() => refetchOrgs()}
                          style={{
                            marginLeft: '10px',
                            background: 'none',
                            border: 'none',
                            color: '#2563eb',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                          }}
                        >
                          Retry
                        </button>
                      </div>
                    ) : organizations && organizations.length > 0 ? (
                      <select
                        id="zoho-org-select"
                        value={selectedOrgId}
                        onChange={(e) => setSelectedOrgId(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px 14px',
                          fontSize: '14px',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          backgroundColor: '#fff',
                          color: '#111827',
                          outline: 'none',
                          marginTop: '4px',
                        }}
                      >
                        <option value="" disabled>
                          Select Organization...
                        </option>
                        {organizations.map((org) => (
                          <option key={org.organization_id} value={org.organization_id}>
                            {org.name} ({org.currency_code || 'INR'})
                            {org.is_default_org ? ' — Default' : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div
                        style={{
                          padding: '12px',
                          backgroundColor: '#f9fafb',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          fontSize: '13px',
                          color: '#6b7280',
                          marginTop: '4px',
                        }}
                      >
                        No Zoho Books organizations found for this account.
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
                    <button
                      type="button"
                      onClick={handleSaveOrganization}
                      disabled={selectOrgMutation.isPending || !selectedOrgId}
                      style={{
                        padding: '10px 24px',
                        backgroundColor: 'var(--navy-900)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: selectOrgMutation.isPending || !selectedOrgId ? 'not-allowed' : 'pointer',
                        opacity: selectOrgMutation.isPending || !selectedOrgId ? 0.6 : 1,
                        transition: 'background-color 0.2s',
                      }}
                    >
                      {selectOrgMutation.isPending ? 'Connecting...' : 'Connect Organization'}
                    </button>

                    {isChangingOrg && (
                      <button
                        type="button"
                        onClick={() => setIsChangingOrg(false)}
                        style={{
                          padding: '10px 16px',
                          backgroundColor: '#fff',
                          color: '#374151',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          fontSize: '14px',
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* Connected State Overview */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: '16px',
                      backgroundColor: '#f8fafc',
                      padding: '20px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div>
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                        Connected Zoho Organization
                      </span>
                      <strong style={{ fontSize: '15px', color: 'var(--navy-900)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Building2 size={16} color="#475569" />
                        {statusData?.selectedOrganizationName || 'Zoho Books Organization'}
                      </strong>
                    </div>

                    <div>
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                        Zoho Organization ID
                      </span>
                      <code style={{ fontSize: '13px', color: '#1e293b', backgroundColor: '#e2e8f0', padding: '2px 6px', borderRadius: '4px' }}>
                        {statusData?.selectedOrganizationId || '—'}
                      </code>
                    </div>

                    <div>
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                        Connected On
                      </span>
                      <span style={{ fontSize: '14px', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Calendar size={15} color="#64748b" />
                        {statusData?.connectedAt
                          ? new Date(statusData.connectedAt).toLocaleDateString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })
                          : '—'}
                      </span>
                    </div>

                    <div>
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                        API Endpoint
                      </span>
                      <span style={{ fontSize: '13px', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Globe size={15} color="#64748b" />
                        {statusData?.apiDomain || 'https://www.zohoapis.com'}
                      </span>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <button
                        type="button"
                        onClick={() => setIsChangingOrg(true)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '8px 16px',
                          backgroundColor: '#fff',
                          color: '#374151',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Change Organization
                      </button>

                      <button
                        type="button"
                        onClick={handleRefreshConnection}
                        disabled={refreshMutation.isPending}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '8px 16px',
                          backgroundColor: '#fff',
                          color: '#374151',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 500,
                          cursor: refreshMutation.isPending ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <RefreshCw size={14} className={refreshMutation.isPending ? 'animate-spin' : ''} />
                        Verify Connection
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowDisconnectConfirm(true)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 16px',
                        backgroundColor: '#fff',
                        color: '#dc2626',
                        border: '1px solid #fca5a5',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <Unlink size={14} />
                      Disconnect
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* STEP 4: Synchronize & Configure Modules Hub matching Screenshot 2 */}
          {isConnected && (
            <ModuleSyncHub
              orgId={orgId || ''}
              onConfigureModule={(moduleKey) => {
                setActiveMappingModule(moduleKey);
                setSearchParams((p) => {
                  p.set('module', moduleKey);
                  return p;
                });
              }}
            />
          )}
        </div>
        )}
      </main>

      {/* Disconnect Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDisconnectConfirm}
        title="Disconnect Zoho Books"
        message="Are you sure you want to disconnect Zoho Books? This will revoke active authorization tokens and remove the mapped organization. Your configured Client ID will be preserved."
        confirmText="Disconnect"
        cancelText="Cancel"
        onConfirm={handleDisconnect}
        onCancel={() => setShowDisconnectConfirm(false)}
        isConfirming={disconnectMutation.isPending}
      />
    </div>
  );
}
