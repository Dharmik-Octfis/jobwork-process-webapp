import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
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
} from 'lucide-react';
import {
  useZohoSyncSettings,
  useToggleZohoSync,
  useInstantZohoSync,
  useSyncAllZohoModules,
} from '../zoho.api';
import type { ZohoSyncModuleKey, ZohoModuleSyncConfig } from '../zoho.schemas';
import { SyncHistoryModal } from './SyncHistoryModal';
import { toApiErrorMessage } from '../../../../api/client';

interface ModuleSyncHubProps {
  orgId: string;
  onConfigureModule: (module: ZohoSyncModuleKey) => void;
}

export const ModuleSyncHub: React.FC<ModuleSyncHubProps> = ({ orgId, onConfigureModule }) => {
  const [historyModalModule, setHistoryModalModule] = useState<{
    key: ZohoSyncModuleKey;
    label: string;
  } | null>(null);

  const { data: syncSettings, isLoading, refetch } = useZohoSyncSettings(orgId);
  const toggleSyncMutation = useToggleZohoSync(orgId);
  const instantSyncMutation = useInstantZohoSync(orgId);
  const syncAllMutation = useSyncAllZohoModules(orgId);

  const [activeSyncing, setActiveSyncing] = useState<{ module: string; fullSync: boolean } | null>(null);
  const [syncingAllType, setSyncingAllType] = useState<'incremental' | 'full' | null>(null);

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

  const handleSetSyncStatus = async (module: ZohoSyncModuleKey, status: 'ACTIVE' | 'PAUSED' | 'INACTIVE') => {
    try {
      await toggleSyncMutation.mutateAsync({ module, status });
      const label = status === 'ACTIVE' ? 'activated' : status === 'PAUSED' ? 'paused' : 'set to inactive';
      toast.success(`Sync for ${moduleMeta[module].title} ${label}.`);
    } catch (err) {
      toast.error(toApiErrorMessage(err));
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
      toast.success(
        res?.message ||
          `${fullSync ? 'Full sync' : 'Instant sync'} completed for ${moduleMeta[module].title}!`,
      );
      refetch();
    } catch (err) {
      toast.error(toApiErrorMessage(err));
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
      toast.success(
        res?.message ||
          `${fullSync ? 'Full synchronization (all records)' : 'Common sync'} completed for all active Zoho modules!`,
      );
      refetch();
    } catch (err) {
      toast.error(toApiErrorMessage(err));
    } finally {
      setSyncingAllType(null);
    }
  };

  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${day}-${month}-${year} ${hours}:${minutes}`;
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
              backgroundColor: 'var(--navy-900)',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            4
          </span>
          <ArrowRightLeft size={18} color="var(--navy-900)" />
          <div>
            <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--navy-900)', margin: 0 }}>
              Configure Module to be Synced
            </h2>
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
            disabled={Boolean(syncingAllType)}
            title="Sync new/modified records since last sync time"
            style={{
              backgroundColor: '#15803d',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: syncingAllType ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              opacity: syncingAllType === 'incremental' ? 0.7 : 1,
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
            }}
          >
            <Zap size={13} className={syncingAllType === 'incremental' ? 'animate-spin' : ''} />
            {syncingAllType === 'incremental' ? 'Syncing...' : 'Sync All (Incremental)'}
          </button>

          {/* Full Sync All Records Button (Not based on time) */}
          <button
            type="button"
            onClick={() => handleSyncAll(true)}
            disabled={Boolean(syncingAllType)}
            title="Sync all records from Zoho Books from scratch without time filtering"
            style={{
              backgroundColor: '#4338ca',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: syncingAllType ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              opacity: syncingAllType === 'full' ? 0.7 : 1,
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
            }}
          >
            <RefreshCw size={13} className={syncingAllType === 'full' ? 'animate-spin' : ''} />
            {syncingAllType === 'full' ? 'Full Syncing All...' : 'Full Sync All (All Records)'}
          </button>

          <button
            type="button"
            onClick={() => refetch()}
            style={{
              background: 'none',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '5px 12px',
              fontSize: '12px',
              color: '#475569',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
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
            const isSyncingIncremental = activeSyncing?.module === modKey && !activeSyncing?.fullSync;
            const isSyncingFull = activeSyncing?.module === modKey && Boolean(activeSyncing?.fullSync);
            const isModuleSyncing = isSyncingIncremental || isSyncingFull;

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
                            color: isActive
                              ? '#15803d'
                              : isPaused
                                ? '#b45309'
                                : '#64748b',
                            border: `1px solid ${
                              isActive
                                ? '#bbf7d0'
                                : isPaused
                                  ? '#fde68a'
                                  : '#cbd5e1'
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
                          style={{
                            padding: '6px 16px',
                            backgroundColor: '#15803d',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
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
                          <span style={{ color: '#64748b', marginRight: '6px' }}>Last Push Time:</span>
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
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#2563eb',
                            fontWeight: 500,
                            cursor: 'pointer',
                            padding: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
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
                              disabled={toggleSyncMutation.isPending}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#b45309',
                                fontWeight: 500,
                                cursor: 'pointer',
                                padding: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              Pause Sync
                            </button>
                            <span style={{ color: '#cbd5e1' }}>|</span>
                            <button
                              type="button"
                              onClick={() => handleSetSyncStatus(modKey, 'INACTIVE')}
                              disabled={toggleSyncMutation.isPending}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#dc2626',
                                fontWeight: 500,
                                cursor: 'pointer',
                                padding: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
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
                              disabled={toggleSyncMutation.isPending}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#15803d',
                                fontWeight: 500,
                                cursor: 'pointer',
                                padding: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              Resume Sync
                            </button>
                            <span style={{ color: '#cbd5e1' }}>|</span>
                            <button
                              type="button"
                              onClick={() => handleSetSyncStatus(modKey, 'INACTIVE')}
                              disabled={toggleSyncMutation.isPending}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#dc2626',
                                fontWeight: 500,
                                cursor: 'pointer',
                                padding: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
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
                            disabled={toggleSyncMutation.isPending}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#15803d',
                              fontWeight: 500,
                              cursor: 'pointer',
                              padding: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            Activate Sync
                          </button>
                        )}

                        <span style={{ color: '#cbd5e1' }}>|</span>

                        <button
                          type="button"
                          onClick={() =>
                            setHistoryModalModule({ key: modKey, label: meta.title })
                          }
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#475569',
                            fontWeight: 500,
                            cursor: 'pointer',
                            padding: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          Show Sync History
                        </button>

                        <span style={{ color: '#cbd5e1' }}>|</span>

                        {/* Instant Incremental Sync */}
                        <button
                          type="button"
                          onClick={() => handleSyncModule(modKey, false)}
                          disabled={isModuleSyncing || !isActive}
                          title="Sync records modified or created since last sync time"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: isActive ? '#059669' : '#94a3b8',
                            fontWeight: 600,
                            cursor: isActive && !isModuleSyncing ? 'pointer' : 'not-allowed',
                            padding: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
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
                          disabled={isModuleSyncing || !isActive}
                          title="Sync all records from Zoho Books without time filter"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: isActive ? '#4f46e5' : '#94a3b8',
                            fontWeight: 600,
                            cursor: isActive && !isModuleSyncing ? 'pointer' : 'not-allowed',
                            padding: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
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

      {/* Sync History Modal */}
      {historyModalModule && (
        <SyncHistoryModal
          isOpen={Boolean(historyModalModule)}
          onClose={() => setHistoryModalModule(null)}
          orgId={orgId}
          module={historyModalModule.key}
          moduleLabel={historyModalModule.label}
        />
      )}
    </div>
  );
};
