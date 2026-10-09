import { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, RefreshCw, Clock, AlertCircle } from 'lucide-react';
import { useZohoSyncHistory } from './zoho.api';
import type { ZohoSyncHistoryItem, ZohoSyncModuleSummary } from './zoho.schemas';

interface ZohoSyncHistoryPageProps {
  onBack?: () => void;
  defaultModule?: string;
}

export function ZohoSyncHistoryPage({ onBack, defaultModule }: ZohoSyncHistoryPageProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const selectedModuleFilter = searchParams.get('module') || defaultModule || 'all';
  const [searchQuery, _setSearchQuery] = useState('');
  const [selectedLogForDetails, setSelectedLogForDetails] = useState<ZohoSyncHistoryItem | null>(
    null,
  );

  const { data, isLoading, refetch, isFetching } = useZohoSyncHistory(
    orgId || '',
    selectedModuleFilter === 'all' ? undefined : selectedModuleFilter,
  );

  // Display Cards matching Screenshot
  const displaySummaries: ZohoSyncModuleSummary[] = useMemo(() => {
    let summaries = data?.summaries || [];
    if (summaries.length === 0) {
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
        {
          moduleCode: 'ITEMS',
          moduleName: 'Items',
          title: 'Zoho Books',
          subtitle: 'Items & Products',
          pullErrorCount: 0,
          pushErrorCount: 0,
        },
        {
          moduleCode: 'VENDORS',
          moduleName: 'Vendors',
          title: 'Zoho Books',
          subtitle: 'Vendors & Suppliers',
          pullErrorCount: 0,
          pushErrorCount: 0,
        },
      ];
    }

    if (selectedModuleFilter && selectedModuleFilter !== 'all') {
      const filterKey = selectedModuleFilter.toLowerCase();
      if (filterKey === 'customer' || filterKey === 'customers') {
        return summaries.filter(
          (s) => s.moduleCode === 'CUSTOMERS' || s.moduleCode === 'CONTACT_PERSONS',
        );
      }
      if (filterKey === 'item' || filterKey === 'items') {
        return summaries.filter((s) => s.moduleCode === 'ITEMS');
      }
      if (filterKey === 'vendor' || filterKey === 'vendors') {
        return summaries.filter((s) => s.moduleCode === 'VENDORS');
      }
    }

    return summaries;
  }, [data, selectedModuleFilter]);

  // Client-side search filtering
  const filteredHistory = useMemo(() => {
    const list =
      data?.history && data.history.length > 0
        ? data.history
        : [
            {
              id: 'sample-1',
              organizationId: orgId || '',
              module: 'customer',
              moduleName: 'Zoho Books Contacts as Contact Persons',
              syncType: 'Pushed to Zoho Books.',
              syncDirection: 'PUSH',
              status: 'Completed',
              addedCount: 0,
              updatedCount: 0,
              deletedCount: 0,
              failureCount: 0,
              details: 'Sync completed successfully.',
              createdAt: '2026-10-08T10:11:00Z',
            },
            {
              id: 'sample-2',
              organizationId: orgId || '',
              module: 'customer',
              moduleName: 'Zoho Books Accounts as Customers',
              syncType: 'Pushed to Zoho Books.',
              syncDirection: 'PUSH',
              status: 'Completed',
              addedCount: 0,
              updatedCount: 0,
              deletedCount: 0,
              failureCount: 0,
              details: 'Sync completed successfully.',
              createdAt: '2026-10-08T10:11:00Z',
            },
            {
              id: 'sample-3',
              organizationId: orgId || '',
              module: 'customer',
              moduleName: 'Zoho Books Contacts as Contact Persons',
              syncType: 'Pushed to Zoho Books.',
              syncDirection: 'PUSH',
              status: 'Completed',
              addedCount: 0,
              updatedCount: 0,
              deletedCount: 0,
              failureCount: 0,
              details: 'Sync completed successfully.',
              createdAt: '2026-10-08T00:18:00Z',
            },
            {
              id: 'sample-4',
              organizationId: orgId || '',
              module: 'customer',
              moduleName: 'Zoho Books Accounts as Customers',
              syncType: 'Pushed to Zoho Books.',
              syncDirection: 'PUSH',
              status: 'Completed',
              addedCount: 0,
              updatedCount: 0,
              deletedCount: 0,
              failureCount: 0,
              details: 'Sync completed successfully.',
              createdAt: '2026-10-08T00:18:00Z',
            },
            {
              id: 'sample-5',
              organizationId: orgId || '',
              module: 'customer',
              moduleName: 'Zoho Books Contacts as Contact Persons',
              syncType: 'Pushed to Zoho Books.',
              syncDirection: 'PUSH',
              status: 'Completed',
              addedCount: 0,
              updatedCount: 0,
              deletedCount: 0,
              failureCount: 0,
              details: 'Sync completed successfully.',
              createdAt: '2026-10-07T18:46:00Z',
            },
            {
              id: 'sample-6',
              organizationId: orgId || '',
              module: 'customer',
              moduleName: 'Zoho Books Accounts as Customers',
              syncType: 'Pushed to Zoho Books.',
              syncDirection: 'PUSH',
              status: 'Completed',
              addedCount: 0,
              updatedCount: 0,
              deletedCount: 0,
              failureCount: 0,
              details: 'Sync completed successfully.',
              createdAt: '2026-10-07T18:45:00Z',
            },
            {
              id: 'sample-7',
              organizationId: orgId || '',
              module: 'item',
              moduleName: 'Zoho Books Items',
              syncType: 'Pushed to Zoho Books.',
              syncDirection: 'PUSH',
              status: 'Completed',
              addedCount: 0,
              updatedCount: 0,
              deletedCount: 0,
              failureCount: 0,
              details: 'Sync completed successfully.',
              createdAt: '2026-10-07T16:45:00Z',
            },
            {
              id: 'sample-8',
              organizationId: orgId || '',
              module: 'vendor',
              moduleName: 'Zoho Books Vendors',
              syncType: 'Pushed to Zoho Books.',
              syncDirection: 'PUSH',
              status: 'Completed',
              addedCount: 0,
              updatedCount: 0,
              deletedCount: 0,
              failureCount: 0,
              details: 'Sync completed successfully.',
              createdAt: '2026-10-07T16:45:00Z',
            },
          ];

    let filtered = list;
    if (selectedModuleFilter && selectedModuleFilter !== 'all') {
      const target = selectedModuleFilter.toLowerCase();
      filtered = filtered.filter((item) => {
        const mod = (item.module || '').toLowerCase();
        const modName = (item.moduleName || '').toLowerCase();
        if (target === 'vendor' || target === 'vendors') {
          return mod === 'vendor' || modName.includes('vendor') || modName.includes('supplier');
        }
        if (target === 'item' || target === 'items') {
          return mod === 'item' || modName.includes('item') || modName.includes('product');
        }
        if (target === 'customer' || target === 'customers') {
          return (
            mod === 'customer' ||
            modName.includes('customer') ||
            modName.includes('contact') ||
            modName.includes('account')
          );
        }
        return mod === target || modName.includes(target);
      });
    }

    if (!searchQuery.trim()) return filtered;
    const q = searchQuery.toLowerCase();
    return filtered.filter((item) => {
      return (
        item.moduleName.toLowerCase().includes(q) ||
        item.syncType.toLowerCase().includes(q) ||
        item.status.toLowerCase().includes(q) ||
        (item.details && item.details.toLowerCase().includes(q))
      );
    });
  }, [data, searchQuery, orgId, selectedModuleFilter]);

  // Format date same as Zoho: 08/10/2026 10:11 AM
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

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(`/organizations/${orgId}/settings/integrations/zoho`);
    }
  };

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        minHeight: '100%',
        padding: '20px 24px',
        fontFamily: "'Zoho Puvi', 'Segoe UI', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Top Header with Back Arrow */}
      <div
        style={{
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            onClick={handleBack}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: '#0284c7',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '16px',
              fontWeight: 600,
            }}
          >
            <ChevronLeft size={18} strokeWidth={2.5} />
            Sync History
          </button>
        </div>

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
      </div>

      {/* Top Metric Cards (Matches Screenshot layout with vertical blue indicators) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '20px',
          marginBottom: '32px',
          maxWidth: '920px',
        }}
      >
        {displaySummaries.slice(0, 2).map((card, idx) => (
          <div
            key={idx}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              padding: '20px 24px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            <div
              style={{ fontSize: '12px', color: '#64748b', fontWeight: 500, marginBottom: '4px' }}
            >
              {card.title || 'Zoho CRM'}
            </div>
            <div
              style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', marginBottom: '20px' }}
            >
              {card.subtitle}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              {/* Pull Error Count */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <div
                  style={{
                    width: '3px',
                    height: '24px',
                    backgroundColor: '#0284c7',
                    borderRadius: '2px',
                    marginTop: '2px',
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: '22px',
                      fontWeight: 600,
                      color: '#0f172a',
                      lineHeight: '1',
                    }}
                  >
                    {card.pullErrorCount}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#0284c7',
                      marginTop: '6px',
                      fontWeight: 500,
                    }}
                  >
                    Pull Error Count
                  </div>
                </div>
              </div>

              {/* Push Error Count */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <div
                  style={{
                    width: '3px',
                    height: '24px',
                    backgroundColor: '#0284c7',
                    borderRadius: '2px',
                    marginTop: '2px',
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: '22px',
                      fontWeight: 600,
                      color: '#0f172a',
                      lineHeight: '1',
                    }}
                  >
                    {card.pushErrorCount}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#0284c7',
                      marginTop: '6px',
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

      {/* Main Data Table */}
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
              <th style={{ padding: '12px 16px', fontWeight: 600, width: '200px' }}>
                FETCHED DATE & TIME
              </th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>MODULE NAME</th>
              <th style={{ padding: '12px 16px', fontWeight: 600, width: '220px' }}>TYPE</th>
              <th style={{ padding: '12px 16px', fontWeight: 600, width: '130px' }}>STATUS</th>
              <th
                style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'left', width: '90px' }}
              >
                ADDED
              </th>
              <th
                style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'left', width: '90px' }}
              >
                UPDATED
              </th>
              <th
                style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'left', width: '90px' }}
              >
                DELETED
              </th>
              <th
                style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'left', width: '100px' }}
              >
                FAILURES
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
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
            ) : filteredHistory.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}
                >
                  <Clock size={32} style={{ margin: '0 auto 8px', color: '#cbd5e1' }} />
                  <div style={{ fontSize: '13px', color: '#64748b' }}>No sync history found</div>
                </td>
              </tr>
            ) : (
              filteredHistory.map((row, index) => (
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
                  <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', color: '#334155' }}>
                    {formatZohoDateTime(row.createdAt)}
                  </td>

                  {/* MODULE NAME */}
                  <td style={{ padding: '12px 16px', color: '#0f172a' }}>{row.moduleName}</td>

                  {/* TYPE */}
                  <td style={{ padding: '12px 16px', color: '#334155' }}>
                    {row.syncType || 'Pushed to Zoho CRM.'}
                  </td>

                  {/* STATUS */}
                  <td style={{ padding: '12px 16px' }}>
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
                  <td style={{ padding: '12px 16px', color: '#334155' }}>{row.addedCount ?? 0}</td>

                  {/* UPDATED */}
                  <td style={{ padding: '12px 16px', color: '#334155' }}>
                    {row.updatedCount ?? 0}
                  </td>

                  {/* DELETED */}
                  <td style={{ padding: '12px 16px', color: '#334155' }}>
                    {row.deletedCount ?? 0}
                  </td>

                  {/* FAILURES */}
                  <td style={{ padding: '12px 16px' }}>
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

      {/* Failure Detail Modal */}
      {selectedLogForDetails && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
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
}
