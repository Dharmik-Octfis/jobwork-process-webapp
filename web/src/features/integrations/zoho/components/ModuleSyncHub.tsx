import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { notify } from '../../../../lib/notify';
import {
  ArrowRightLeft,
  Users,
  Building,
  Package,
  Pause,
  Zap,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Clock,
  Lock,
} from 'lucide-react';
import {
  useZohoSyncSettings,
  useToggleZohoSync,
  useInstantZohoSync,
  useSyncAllZohoModules,
} from '../zoho.api';
import type { ZohoSyncModuleKey, ZohoModuleSyncConfig } from '../zoho.schemas';
import { toApiErrorMessage } from '../../../../api/client';

interface ModuleSyncHubProps {
  orgId: string;
  onConfigureModule: (module: ZohoSyncModuleKey) => void;
  disabled?: boolean;
}

export const ModuleSyncHub: React.FC<ModuleSyncHubProps> = ({
  orgId,
  onConfigureModule,
  disabled = false,
}) => {
  const navigate = useNavigate();

  const { data: syncSettings, isLoading, refetch } = useZohoSyncSettings(orgId);
  const toggleSyncMutation = useToggleZohoSync(orgId);
  const instantSyncMutation = useInstantZohoSync(orgId);
  const syncAllMutation = useSyncAllZohoModules(orgId);

  const [activeSyncing, setActiveSyncing] = useState<{ module: string; fullSync: boolean } | null>(
    null,
  );
  const [syncingAllType, setSyncingAllType] = useState<'incremental' | 'full' | null>(null);

  const isAnySyncRunning = Boolean(activeSyncing) || Boolean(syncingAllType);
  const isGloballyDisabled = disabled || isAnySyncRunning;

  const modules: ZohoSyncModuleKey[] = ['customer', 'vendor', 'item'];

  const moduleMeta: Record<
    ZohoSyncModuleKey,
    {
      title: string;
      appEntityName: string;
      zohoEntityName: string;
      description: string;
      icon: React.ReactNode;
    }
  > = {
    customer: {
      title: 'Accounts <-> Customers',
      appEntityName: 'In Job Work App',
      zohoEntityName: 'In Zoho Books',
      description: 'Synchronize customers, accounts, addresses, and contacts bidirectionally.',
      icon: <Users size={18} color="#2563eb" />,
    },
    vendor: {
      title: 'Vendors',
      appEntityName: 'In Job Work App',
      zohoEntityName: 'In Zoho Books',
      description: 'This will allow you to sync Vendors from App as Vendors in Zoho Books.',
      icon: <Building size={18} color="#0d9488" />,
    },
    item: {
      title: 'Item',
      appEntityName: 'In Job Work App',
      zohoEntityName: 'In Zoho Books',
      description: 'This will allow you to sync Products from App as Item in Zoho Books.',
      icon: <Package size={18} color="#ea580c" />,
    },
  };

  const handleSetSyncStatus = async (
    module: ZohoSyncModuleKey,
    status: 'ACTIVE' | 'PAUSED' | 'INACTIVE',
  ) => {
    try {
      await toggleSyncMutation.mutateAsync({ module, status });
      const label =
        status === 'ACTIVE' ? 'activated' : status === 'PAUSED' ? 'paused' : 'set to inactive';
      notify.success(`Sync for ${moduleMeta[module].title} ${label}.`);
    } catch (err) {
      notify.error(toApiErrorMessage(err));
    }
  };

  const handleSyncModule = async (module: ZohoSyncModuleKey, fullSync = false) => {
    setActiveSyncing({ module, fullSync });
    try {
      const res = await instantSyncMutation.mutateAsync({
        module,
        fullSync,
        syncMode: fullSync ? 'full' : 'incremental',
      });
      notify.success(
        res?.message ||
          `${fullSync ? 'Full sync' : 'Instant sync'} completed for ${moduleMeta[module].title}!`,
      );
      refetch();
    } catch (err) {
      notify.error(toApiErrorMessage(err));
    } finally {
      setActiveSyncing(null);
    }
  };

  const handleSyncAll = async (fullSync = false) => {
    setSyncingAllType(fullSync ? 'full' : 'incremental');
    try {
      const res = await syncAllMutation.mutateAsync({
        fullSync,
        syncMode: fullSync ? 'full' : 'incremental',
      });
      notify.success(
        res?.message ||
          `${fullSync ? 'Full synchronization (all records)' : 'Common sync'} completed for all active Zoho modules!`,
      );
      refetch();
    } catch (err) {
      notify.error(toApiErrorMessage(err));
    } finally {
      setSyncingAllType(null);
    }
  };

  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      let hours = d.getHours();
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      const hoursFormatted = String(hours).padStart(2, '0');
      return `${day}/${month}/${year} ${hoursFormatted}:${minutes} ${ampm}`;
    } catch {
      return isoString;
    }
  };

  return (
    <div
      style={{
        backgroundColor: '#fff',
        borderRadius: '10px',
        border: '1px solid var(--color-border)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        overflow: 'hidden',
      }}
    >
      {/* Section Header matching Screenshot 2 */}
      <div
        style={{
          padding: '18px 24px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: '#fafafa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
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
              backgroundColor: disabled ? '#94a3b8' : 'var(--navy-900)',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            4
          </span>
          <ArrowRightLeft size={18} color={disabled ? '#94a3b8' : 'var(--navy-900)'} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  color: disabled ? '#64748b' : 'var(--navy-900)',
                  margin: 0,
                }}
              >
                Configure Module to be Synced
              </h2>
              {disabled && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: 600,
                    backgroundColor: '#f1f5f9',
                    color: '#64748b',
                    border: '1px solid #cbd5e1',
                  }}
                >
                  <Lock size={11} />
                  Disabled (Complete Step 3 Organization Mapping to Enable)
                </span>
              )}
            </div>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              *Auto-update occurs every 2 hours.
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          {/* Incremental Sync Button */}
          <button
            type="button"
            onClick={() => handleSyncAll(false)}
            disabled={isGloballyDisabled}
            title={
              disabled
                ? 'Complete Organization Mapping in Step 3 to enable'
                : 'Sync new/modified records since last sync time'
            }
            style={{
              backgroundColor: '#f8fafc',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isGloballyDisabled ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              opacity: isGloballyDisabled ? (syncingAllType === 'incremental' ? 0.85 : 0.45) : 1,
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
              transition: 'background-color 0.15s, opacity 0.15s',
            }}
          >
            <Zap
              size={13}
              color="#475569"
              className={syncingAllType === 'incremental' ? 'animate-spin' : ''}
            />
            {syncingAllType === 'incremental' ? 'Syncing...' : 'Sync All (Incremental)'}
          </button>

          {/* Full Sync All Records Button */}
          <button
            type="button"
            onClick={() => handleSyncAll(true)}
            disabled={isGloballyDisabled}
            title={
              disabled
                ? 'Complete Organization Mapping in Step 3 to enable'
                : 'Sync all records from Zoho Books from scratch without time filtering'
            }
            style={{
              backgroundColor: '#f8fafc',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isGloballyDisabled ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              opacity: isGloballyDisabled ? (syncingAllType === 'full' ? 0.85 : 0.45) : 1,
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
              transition: 'background-color 0.15s, opacity 0.15s',
            }}
          >
            <RefreshCw
              size={13}
              color="#475569"
              className={syncingAllType === 'full' ? 'animate-spin' : ''}
            />
            {syncingAllType === 'full' ? 'Full Syncing All...' : 'Full Sync All (All Records)'}
          </button>

          {/* View Sync History Page Button */}
          <button
            type="button"
            onClick={() => navigate(`/organizations/${orgId}/settings/integrations/zoho/history`)}
            disabled={isGloballyDisabled}
            title={
              disabled
                ? 'Complete Organization Mapping in Step 3 to enable'
                : 'View complete Sync History matching Zoho Books layout'
            }
            style={{
              backgroundColor: '#f8fafc',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: isGloballyDisabled ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              opacity: isGloballyDisabled ? 0.45 : 1,
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
              transition: 'background-color 0.15s, opacity 0.15s',
            }}
          >
            <Clock size={13} color="#475569" />
            Sync History
          </button>

          {/* Refresh Status Button */}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isGloballyDisabled}
            title={
              disabled
                ? 'Complete Organization Mapping in Step 3 to enable'
                : 'Refresh sync status and timestamps from server'
            }
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 500,
              color: '#475569',
              cursor: isGloballyDisabled ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              opacity: isGloballyDisabled ? 0.45 : 1,
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
              transition: 'background-color 0.15s, opacity 0.15s',
            }}
          >
            <RefreshCw size={12} color="#475569" className={isLoading ? 'animate-spin' : ''} />
            Refresh Status
          </button>
        </div>
      </div>

      {/* Modules Cards List matching Screenshot 2 */}
      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {isLoading ? (
          <div
            style={{
              padding: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              color: '#64748b',
              fontSize: '14px',
            }}
          >
            <RefreshCw size={16} className="animate-spin" />
            Loading module sync configurations...
          </div>
        ) : (
          modules.map((modKey) => {
            const config: ZohoModuleSyncConfig | undefined = syncSettings?.modules?.[modKey];
            const meta = moduleMeta[modKey];
            const isConfigured = config && config.status !== 'NOT_CONFIGURED';
            const status = config?.status || 'NOT_CONFIGURED';
            const isActive = status === 'ACTIVE';
            const isPaused = status === 'PAUSED';
            const isInactive = status === 'INACTIVE';
            const isSyncingIncremental =
              activeSyncing?.module === modKey && !activeSyncing?.fullSync;
            const isSyncingFull =
              activeSyncing?.module === modKey && Boolean(activeSyncing?.fullSync);

            return (
              <div
                key={modKey}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  backgroundColor: '#fff',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
              >
                <div style={{ padding: '20px' }}>
                  {/* Module Header Row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '16px',
                      marginBottom: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '8px',
                          backgroundColor: '#f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {meta.icon}
                      </div>

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h3
                            style={{
                              margin: 0,
                              fontSize: '15px',
                              fontWeight: 600,
                              color: 'var(--navy-900)',
                            }}
                          >
                            {meta.title}
                          </h3>
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: '#64748b',
                            marginTop: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          <span>{meta.appEntityName}</span>
                          <span>⇄</span>
                          <span>{meta.zohoEntityName}</span>
                        </div>
                      </div>
                    </div>

                    {/* Status Pill or Configure Now Button */}
                    <div>
                      {isConfigured ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '3px 10px',
                            borderRadius: '14px',
                            fontSize: '12px',
                            fontWeight: 600,
                            backgroundColor: isActive
                              ? '#dcfce7'
                              : isPaused
                                ? '#fef3c7'
                                : '#f1f5f9',
                            color: isActive ? '#15803d' : isPaused ? '#b45309' : '#64748b',
                            border: `1px solid ${
                              isActive ? '#bbf7d0' : isPaused ? '#fde68a' : '#cbd5e1'
                            }`,
                          }}
                        >
                          {isActive && <CheckCircle2 size={12} />}
                          {isPaused && <Pause size={12} />}
                          {isInactive && <XCircle size={12} />}
                          {isActive ? 'Active' : isPaused ? 'Paused' : 'Inactive'}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onConfigureModule(modKey)}
                          disabled={isGloballyDisabled}
                          style={{
                            padding: '6px 16px',
                            backgroundColor: '#15803d',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: isGloballyDisabled ? 'not-allowed' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            opacity: isGloballyDisabled ? 0.45 : 1,
                            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                          }}
                        >
                          Configure Now
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Description / Subtitle */}
                  {!isConfigured && (
                    <p
                      style={{
                        margin: '0 0 8px 48px',
                        fontSize: '13px',
                        color: '#64748b',
                        lineHeight: '1.4',
                      }}
                    >
                      {meta.description}
                    </p>
                  )}

                  {/* Configured Details Row matching Screenshot 2 */}
                  {isConfigured && (
                    <div style={{ marginLeft: '48px', marginTop: '8px' }}>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '24px',
                          fontSize: '13px',
                          color: '#334155',
                          marginBottom: '12px',
                        }}
                      >
                        <div>
                          <span style={{ color: '#64748b', marginRight: '6px' }}>Last Sync:</span>
                          <strong style={{ fontWeight: 600, color: '#1e293b' }}>
                            {formatDateTime(config?.lastSyncAt)}
                          </strong>
                        </div>

                        <div>
                          <span style={{ color: '#64748b', marginRight: '6px' }}>
                            Last Push Time:
                          </span>
                          <strong style={{ fontWeight: 600, color: '#1e293b' }}>
                            {formatDateTime(config?.lastPushAt)}
                          </strong>
                        </div>
                      </div>

                      {/* Action Links Bar */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '12px',
                          fontSize: '13px',
                          paddingTop: '8px',
                          borderTop: '1px solid #f1f5f9',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => onConfigureModule(modKey)}
                          disabled={isGloballyDisabled}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#2563eb',
                            fontWeight: 500,
                            cursor: isGloballyDisabled ? 'not-allowed' : 'pointer',
                            padding: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            opacity: isGloballyDisabled ? 0.45 : 1,
                          }}
                        >
                          Edit
                        </button>

                        <span style={{ color: '#cbd5e1' }}>|</span>

                        {isActive && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSetSyncStatus(modKey, 'PAUSED')}
                              disabled={isGloballyDisabled || toggleSyncMutation.isPending}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#2563eb',
                                fontWeight: 500,
                                cursor:
                                  isGloballyDisabled || toggleSyncMutation.isPending
                                    ? 'not-allowed'
                                    : 'pointer',
                                padding: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                opacity:
                                  isGloballyDisabled || toggleSyncMutation.isPending ? 0.45 : 1,
                              }}
                            >
                              Pause Sync
                            </button>
                            <span style={{ color: '#cbd5e1' }}>|</span>
                            <button
                              type="button"
                              onClick={() => handleSetSyncStatus(modKey, 'INACTIVE')}
                              disabled={isGloballyDisabled || toggleSyncMutation.isPending}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#2563eb',
                                fontWeight: 500,
                                cursor:
                                  isGloballyDisabled || toggleSyncMutation.isPending
                                    ? 'not-allowed'
                                    : 'pointer',
                                padding: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                opacity:
                                  isGloballyDisabled || toggleSyncMutation.isPending ? 0.45 : 1,
                              }}
                            >
                              Set Inactive
                            </button>
                          </>
                        )}

                        {isPaused && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSetSyncStatus(modKey, 'ACTIVE')}
                              disabled={isGloballyDisabled || toggleSyncMutation.isPending}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#2563eb',
                                fontWeight: 500,
                                cursor:
                                  isGloballyDisabled || toggleSyncMutation.isPending
                                    ? 'not-allowed'
                                    : 'pointer',
                                padding: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                opacity:
                                  isGloballyDisabled || toggleSyncMutation.isPending ? 0.45 : 1,
                              }}
                            >
                              Resume Sync
                            </button>
                            <span style={{ color: '#cbd5e1' }}>|</span>
                            <button
                              type="button"
                              onClick={() => handleSetSyncStatus(modKey, 'INACTIVE')}
                              disabled={isGloballyDisabled || toggleSyncMutation.isPending}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#2563eb',
                                fontWeight: 500,
                                cursor:
                                  isGloballyDisabled || toggleSyncMutation.isPending
                                    ? 'not-allowed'
                                    : 'pointer',
                                padding: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                opacity:
                                  isGloballyDisabled || toggleSyncMutation.isPending ? 0.45 : 1,
                              }}
                            >
                              Set Inactive
                            </button>
                          </>
                        )}

                        {isInactive && (
                          <button
                            type="button"
                            onClick={() => handleSetSyncStatus(modKey, 'ACTIVE')}
                            disabled={isGloballyDisabled || toggleSyncMutation.isPending}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#2563eb',
                              fontWeight: 500,
                              cursor:
                                isGloballyDisabled || toggleSyncMutation.isPending
                                  ? 'not-allowed'
                                  : 'pointer',
                              padding: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              opacity:
                                isGloballyDisabled || toggleSyncMutation.isPending ? 0.45 : 1,
                            }}
                          >
                            Activate Sync
                          </button>
                        )}

                        <span style={{ color: '#cbd5e1' }}>|</span>

                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/organizations/${orgId}/settings/integrations/zoho/history?module=${modKey}`,
                            )
                          }
                          disabled={isGloballyDisabled}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#2563eb',
                            fontWeight: 500,
                            cursor: isGloballyDisabled ? 'not-allowed' : 'pointer',
                            padding: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            opacity: isGloballyDisabled ? 0.45 : 1,
                          }}
                        >
                          Show Sync History
                        </button>

                        <span style={{ color: '#cbd5e1' }}>|</span>

                        {/* Instant Incremental Sync */}
                        <button
                          type="button"
                          onClick={() => handleSyncModule(modKey, false)}
                          disabled={isGloballyDisabled || !isActive}
                          title="Sync records modified or created since last sync time"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: isActive ? '#2563eb' : '#94a3b8',
                            fontWeight: 600,
                            cursor: isActive && !isGloballyDisabled ? 'pointer' : 'not-allowed',
                            padding: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            opacity: isGloballyDisabled && !isSyncingIncremental ? 0.45 : 1,
                          }}
                        >
                          {isSyncingIncremental ? (
                            <>
                              <RefreshCw size={13} className="animate-spin" />
                              Syncing...
                            </>
                          ) : (
                            <>
                              <Zap size={13} />
                              Instant Sync
                            </>
                          )}
                        </button>

                        <span style={{ color: '#cbd5e1' }}>|</span>

                        {/* Full Sync All Records Option (Not based on time) */}
                        <button
                          type="button"
                          onClick={() => handleSyncModule(modKey, true)}
                          disabled={isGloballyDisabled || !isActive}
                          title="Sync all records from Zoho Books without time filter"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: isActive ? '#2563eb' : '#94a3b8',
                            fontWeight: 600,
                            cursor: isActive && !isGloballyDisabled ? 'pointer' : 'not-allowed',
                            padding: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            opacity: isGloballyDisabled && !isSyncingFull ? 0.45 : 1,
                          }}
                        >
                          {isSyncingFull ? (
                            <>
                              <RefreshCw size={13} className="animate-spin" />
                              Full Syncing...
                            </>
                          ) : (
                            <>
                              <RefreshCw size={13} />
                              Sync All Records (Full Sync)
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
