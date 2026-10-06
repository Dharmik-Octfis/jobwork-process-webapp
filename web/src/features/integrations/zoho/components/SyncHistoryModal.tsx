import React from 'react';
import { X, RefreshCw, CheckCircle2, AlertCircle, Clock, ArrowRightLeft } from 'lucide-react';
import { useZohoSyncHistory } from '../zoho.api';
import type { ZohoSyncLog, ZohoSyncModuleKey } from '../zoho.schemas';

interface SyncHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  module?: ZohoSyncModuleKey;
  moduleLabel?: string;
}

export const SyncHistoryModal: React.FC<SyncHistoryModalProps> = ({
  isOpen,
  onClose,
  orgId,
  module,
  moduleLabel,
}) => {
  const { data: logs, isLoading, refetch } = useZohoSyncHistory(orgId, module, isOpen);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(15, 23, 42, 0.5)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: '#e0f2fe',
                color: '#0369a1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ArrowRightLeft size={16} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
                {moduleLabel ? `${moduleLabel} — Sync History` : 'Zoho Books Sync History'}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                Chronological log of automated and manual sync executions
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => refetch()}
              style={{
                background: 'none',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '12px',
                color: '#475569',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                padding: '6px',
                cursor: 'pointer',
                color: '#64748b',
                borderRadius: '6px',
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {isLoading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px',
                color: '#64748b',
                fontSize: '14px',
                gap: '8px',
              }}
            >
              <RefreshCw size={16} className="animate-spin" />
              Loading sync history...
            </div>
          ) : !logs || logs.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: '#64748b',
              }}
            >
              <Clock size={32} style={{ margin: '0 auto 12px', color: '#94a3b8' }} />
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 500, color: '#334155' }}>
                No sync events recorded yet
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                Run an Instant Sync or configure scheduled synchronization to see activity logs here.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {logs.map((log: ZohoSyncLog) => (
                <div
                  key={log.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '14px 16px',
                    backgroundColor: log.status === 'SUCCESS' ? '#f8fafc' : '#fef2f2',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {log.status === 'SUCCESS' ? (
                        <CheckCircle2 size={16} color="#16a34a" />
                      ) : (
                        <AlertCircle size={16} color="#dc2626" />
                      )}
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: '#0f172a',
                          textTransform: 'capitalize',
                        }}
                      >
                        {log.module} Sync
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor:
                            log.syncType === 'FULL_SYNC'
                              ? '#ede9fe'
                              : log.syncType === 'INSTANT'
                                ? '#e0f2fe'
                                : '#f1f5f9',
                          color:
                            log.syncType === 'FULL_SYNC'
                              ? '#6d28d9'
                              : log.syncType === 'INSTANT'
                                ? '#0369a1'
                                : '#475569',
                        }}
                      >
                        {log.syncType === 'FULL_SYNC'
                          ? 'Full Sync (All Records)'
                          : log.syncType === 'INSTANT'
                            ? 'Instant Sync'
                            : log.syncType}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: log.status === 'SUCCESS' ? '#dcfce7' : '#fee2e2',
                          color: log.status === 'SUCCESS' ? '#15803d' : '#b91c1c',
                        }}
                      >
                        {log.status}
                      </span>
                    </div>

                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      {new Date(log.createdAt).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>

                  <div style={{ fontSize: '13px', color: '#334155', lineHeight: '1.4' }}>
                    {log.details || `Processed ${log.syncedCount} records.`}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      fontSize: '12px',
                      color: '#64748b',
                    }}
                  >
                    <span>
                      Synced:{' '}
                      <strong style={{ color: '#16a34a' }}>{log.syncedCount}</strong>
                    </span>
                    <span>
                      Failed:{' '}
                      <strong style={{ color: log.failedCount > 0 ? '#dc2626' : '#64748b' }}>
                        {log.failedCount}
                      </strong>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 18px',
              backgroundColor: '#fff',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              color: '#334155',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
