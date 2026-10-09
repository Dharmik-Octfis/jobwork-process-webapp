import React, { useState, useMemo } from 'react';
import { X, RefreshCw, Clock, AlertCircle } from 'lucide-react';
import { useZohoSyncHistory } from '../zoho.api';
import type {
  ZohoSyncModuleKey,
  ZohoSyncHistoryItem,
  ZohoSyncModuleSummary,
} from '../zoho.schemas';

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
  const [selectedLogForDetails, setSelectedLogForDetails] = useState<ZohoSyncHistoryItem | null>(
    null,
  );

  const { data, isLoading, isFetching, refetch } = useZohoSyncHistory(orgId, module, isOpen);
  const logs: ZohoSyncHistoryItem[] = useMemo(() => {
    if (Array.isArray(data)) return data;
    return data?.history || [];
  }, [data]);

  // Format date same as Zoho: 08/10/2026 03:41 PM
  const formatZohoDateTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
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
      return dateStr;
    }
  };

  // Summaries matching current module
  const displaySummaries: ZohoSyncModuleSummary[] = useMemo(() => {
    let summaries = data?.summaries || [];
    if (summaries.length === 0) {
      if (module === 'customer') {
        summaries = [
          {
            moduleCode: 'CUSTOMERS',
            moduleName: 'Customers',
            title: 'Zoho Books',
            subtitle: 'Accounts as Customers',
            pullErrorCount: 0,
            pushErrorCount: 0,
          },
          {
            moduleCode: 'CONTACT_PERSONS',
            moduleName: 'Contact Persons',
            title: 'Zoho Books',
            subtitle: 'Contacts as Contact Persons',
            pullErrorCount: 0,
            pushErrorCount: 0,
          },
        ];
      } else if (module === 'vendor') {
        summaries = [
          {
            moduleCode: 'VENDORS',
            moduleName: 'Vendors',
            title: 'Zoho Books',
            subtitle: 'Vendors & Suppliers',
            pullErrorCount: 0,
            pushErrorCount: 0,
          },
        ];
      } else if (module === 'item') {
        summaries = [
          {
            moduleCode: 'ITEMS',
            moduleName: 'Items',
            title: 'Zoho Books',
            subtitle: 'Items & Products',
            pullErrorCount: 0,
            pushErrorCount: 0,
          },
        ];
      } else {
        summaries = [
          {
            moduleCode: 'CUSTOMERS',
            moduleName: 'Customers',
            title: 'Zoho Books',
            subtitle: moduleLabel || 'Module Sync',
            pullErrorCount: 0,
            pushErrorCount: 0,
          },
        ];
      }
    } else if (module) {
      const mod = module.toLowerCase();
      if (mod === 'customer') {
        summaries = summaries.filter(
          (s) => s.moduleCode === 'CUSTOMERS' || s.moduleCode === 'CONTACT_PERSONS',
        );
      } else if (mod === 'item') {
        summaries = summaries.filter((s) => s.moduleCode === 'ITEMS');
      } else if (mod === 'vendor') {
        summaries = summaries.filter((s) => s.moduleCode === 'VENDORS');
      }
    }
    return summaries;
  }, [data, module, moduleLabel]);

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
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '1060px',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          overflow: 'hidden',
          fontFamily: "'Zoho Puvi', 'Segoe UI', system-ui, -apple-system, sans-serif",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header matching main sync history view */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#ffffff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0284c7' }}>
              {moduleLabel ? `${moduleLabel} — Sync History` : 'Sync History'}
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                color: '#475569',
                cursor: isFetching ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
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
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div style={{ padding: '24px 32px', overflowY: 'auto', flex: 1 }}>
          {/* Metric Summary Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '16px',
              marginBottom: '28px',
            }}
          >
            {displaySummaries.map((card, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  padding: '16px 20px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    color: '#64748b',
                    fontWeight: 500,
                    marginBottom: '4px',
                  }}
                >
                  {card.title || 'Zoho Books'}
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: '#0f172a',
                    marginBottom: '16px',
                  }}
                >
                  {card.subtitle}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  {/* Pull Error Count */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <div
                      style={{
                        width: '3px',
                        height: '22px',
                        backgroundColor: '#0284c7',
                        borderRadius: '2px',
                        marginTop: '2px',
                      }}
                    />
                    <div>
                      <div
                        style={{
                          fontSize: '20px',
                          fontWeight: 600,
                          color: '#0f172a',
                          lineHeight: '1',
                        }}
                      >
                        {card.pullErrorCount}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: '#0284c7',
                          marginTop: '4px',
                          fontWeight: 500,
                        }}
                      >
                        Pull Error Count
                      </div>
                    </div>
                  </div>

                  {/* Push Error Count */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <div
                      style={{
                        width: '3px',
                        height: '22px',
                        backgroundColor: '#0284c7',
                        borderRadius: '2px',
                        marginTop: '2px',
                      }}
                    />
                    <div>
                      <div
                        style={{
                          fontSize: '20px',
                          fontWeight: 600,
                          color: '#0f172a',
                          lineHeight: '1',
                        }}
                      >
                        {card.pushErrorCount}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: '#0284c7',
                          marginTop: '4px',
                          fontWeight: 500,
                        }}
                      >
                        Push Error Count
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Sync History Data Table */}
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid #e2e8f0',
                    color: '#64748b',
                    fontSize: '11px',
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                  }}
                >
                  <th style={{ padding: '12px 14px', fontWeight: 600, width: '180px' }}>
                    FETCHED DATE & TIME
                  </th>
                  <th style={{ padding: '12px 14px', fontWeight: 600 }}>MODULE NAME</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, width: '200px' }}>TYPE</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, width: '110px' }}>STATUS</th>
                  <th
                    style={{
                      padding: '12px 14px',
                      fontWeight: 600,
                      textAlign: 'left',
                      width: '80px',
                    }}
                  >
                    ADDED
                  </th>
                  <th
                    style={{
                      padding: '12px 14px',
                      fontWeight: 600,
                      textAlign: 'left',
                      width: '80px',
                    }}
                  >
                    UPDATED
                  </th>
                  <th
                    style={{
                      padding: '12px 14px',
                      fontWeight: 600,
                      textAlign: 'left',
                      width: '80px',
                    }}
                  >
                    DELETED
                  </th>
                  <th
                    style={{
                      padding: '12px 14px',
                      fontWeight: 600,
                      textAlign: 'left',
                      width: '90px',
                    }}
                  >
                    FAILURES
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={8}
                      style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                        }}
                      >
                        <RefreshCw size={16} className="animate-spin" />
                        Loading sync history...
                      </div>
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}
                    >
                      <Clock size={32} style={{ margin: '0 auto 8px', color: '#cbd5e1' }} />
                      <div style={{ fontSize: '13px', color: '#64748b' }}>
                        No sync history found for this module
                      </div>
                    </td>
                  </tr>
                ) : (
                  logs.map((row, index) => (
                    <tr
                      key={row.id || index}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        fontSize: '13px',
                        color: '#334155',
                        height: '46px',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f8fafc';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {/* FETCHED DATE & TIME */}
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', color: '#334155' }}>
                        {formatZohoDateTime(row.createdAt)}
                      </td>

                      {/* MODULE NAME */}
                      <td style={{ padding: '12px 14px', color: '#0f172a' }}>{row.moduleName}</td>

                      {/* TYPE */}
                      <td style={{ padding: '12px 14px', color: '#334155' }}>
                        {row.syncType ||
                          (row.syncDirection === 'PULL'
                            ? 'Fetched from Zoho Books.'
                            : 'Pushed to Zoho Books.')}
                      </td>

                      {/* STATUS */}
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            color:
                              row.status === 'Completed' || row.status === 'SUCCESS'
                                ? '#16a34a'
                                : row.status === 'Failed' || row.status === 'FAILED'
                                  ? '#dc2626'
                                  : '#d97706',
                            fontWeight: 500,
                            fontSize: '13px',
                          }}
                        >
                          {row.status === 'Completed' || row.status === 'SUCCESS'
                            ? 'Completed'
                            : row.status === 'Failed' || row.status === 'FAILED'
                              ? 'Failed'
                              : row.status}
                        </span>
                      </td>

                      {/* ADDED */}
                      <td style={{ padding: '12px 14px', color: '#334155' }}>
                        {row.addedCount ?? 0}
                      </td>

                      {/* UPDATED */}
                      <td style={{ padding: '12px 14px', color: '#334155' }}>
                        {row.updatedCount ?? 0}
                      </td>

                      {/* DELETED */}
                      <td style={{ padding: '12px 14px', color: '#334155' }}>
                        {row.deletedCount ?? 0}
                      </td>

                      {/* FAILURES */}
                      <td style={{ padding: '12px 14px' }}>
                        {row.failureCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => setSelectedLogForDetails(row)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#dc2626',
                              fontWeight: 600,
                              cursor: 'pointer',
                              textDecoration: 'underline',
                              padding: 0,
                              fontSize: '13px',
                            }}
                          >
                            {row.failureCount}
                          </button>
                        ) : (
                          <span style={{ color: '#334155' }}>0</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
              padding: '7px 18px',
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

      {/* Failure Detail Modal */}
      {selectedLogForDetails && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setSelectedLogForDetails(null)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              maxWidth: '520px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: '#dc2626',
                marginBottom: '12px',
              }}
            >
              <AlertCircle size={20} />
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Sync Error Details</h3>
            </div>

            <div
              style={{
                fontSize: '13px',
                color: '#334155',
                marginBottom: '16px',
                lineHeight: '1.5',
              }}
            >
              <div style={{ marginBottom: '6px' }}>
                <strong>Module:</strong> {selectedLogForDetails.moduleName}
              </div>
              <div style={{ marginBottom: '6px' }}>
                <strong>Timestamp:</strong> {formatZohoDateTime(selectedLogForDetails.createdAt)}
              </div>
              <div style={{ marginBottom: '6px' }}>
                <strong>Failure Count:</strong> {selectedLogForDetails.failureCount}
              </div>
              <div>
                <strong>Message:</strong>
                <p
                  style={{
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '6px',
                    padding: '10px',
                    fontSize: '12px',
                    color: '#991b1b',
                    margin: '6px 0 0',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {selectedLogForDetails.details || 'No error details recorded.'}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setSelectedLogForDetails(null)}
                style={{
                  padding: '7px 16px',
                  backgroundColor: '#f1f5f9',
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
      )}
    </div>
  );
};
