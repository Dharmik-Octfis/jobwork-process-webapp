import { useState } from 'react';
import { ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchPurchaseOrders } from '../purchase-orders/purchase-orders.api';
import { fetchBills } from '../bills/bills.api';
import { fetchJobIssues } from '../../jobwork/issues/jobIssues.api';
import { fetchJobReceipts } from '../../jobwork/receipts/jobReceipts.api';
import { format } from 'date-fns';
import { Link, useLocation, useNavigate } from 'react-router-dom';

interface VendorTransactionsProps {
  orgId: string;
  vendorId: string;
}

export function VendorTransactions({ orgId, vendorId }: VendorTransactionsProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedSection, setExpandedSection] = useState<string | null>('Vendor Payments');

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const sections = ['Purchase Orders', 'Bills', 'Job Issues', 'Job Receipts'];

  const fieldFilters = JSON.stringify({ vendorId });
  const jobworkFilters = JSON.stringify({ processorId: vendorId });

  const { data: poData, isLoading: isLoadingPO } = useQuery({
    queryKey: ['vendor-purchaseOrders', orgId, vendorId],
    queryFn: () => fetchPurchaseOrders(orgId, { fieldFilters }),
    enabled: Boolean(orgId && vendorId),
  });

  const { data: billData, isLoading: isLoadingBills } = useQuery({
    queryKey: ['vendor-bills', orgId, vendorId],
    queryFn: () => fetchBills(orgId, { fieldFilters }),
    enabled: Boolean(orgId && vendorId),
  });

  const { data: issuesData, isLoading: isLoadingIssues } = useQuery({
    queryKey: ['vendor-issues', orgId, vendorId],
    queryFn: () => fetchJobIssues(orgId, { fieldFilters: jobworkFilters }),
    enabled: Boolean(orgId && vendorId),
  });

  const { data: receiptsData, isLoading: isLoadingReceipts } = useQuery({
    queryKey: ['vendor-receipts', orgId, vendorId],
    queryFn: () => fetchJobReceipts(orgId, { fieldFilters: jobworkFilters }),
    enabled: Boolean(orgId && vendorId),
  });

  const purchaseOrders = poData?.results || [];
  const bills = billData?.results || [];
  const jobIssues = issuesData?.results || [];
  const jobReceipts = receiptsData?.results || [];



  return (
    <div style={{ padding: '16px', background: '#f8fafc', height: '100%', minHeight: '500px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {sections.map((section) => {
          const isExpanded = expandedSection === section;
          const isLoading = 
            section === 'Purchase Orders' ? isLoadingPO : 
            section === 'Bills' ? isLoadingBills :
            section === 'Job Issues' ? isLoadingIssues :
            isLoadingReceipts;
          const items = 
            section === 'Purchase Orders' ? purchaseOrders : 
            section === 'Bills' ? bills :
            section === 'Job Issues' ? jobIssues :
            jobReceipts;

          return (
            <div
              key={section}
              style={{
                background: '#fff',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                overflow: 'hidden',
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  cursor: 'pointer',
                  background: isExpanded ? '#f8fafc' : '#fff',
                  borderBottom: isExpanded ? '1px solid #e2e8f0' : 'none',
                }}
                onClick={() => toggleSection(section)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isExpanded ? (
                    <ChevronDown size={18} color="#64748b" />
                  ) : (
                    <ChevronRight size={18} color="#64748b" />
                  )}
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#1e293b' }}>
                    {section}
                  </span>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      const newRoute = 
                        section === 'Purchase Orders' ? `/organizations/${orgId}/purchases/purchase-orders/new` :
                        section === 'Bills' ? `/organizations/${orgId}/purchases/bills/new` :
                        section === 'Job Issues' ? `/organizations/${orgId}/jobwork/issues/new` :
                        `/organizations/${orgId}/jobwork/receipts/new`;
                      
                      navigate(newRoute, {
                        state: { returnUrl: location.pathname + location.search }
                      });
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 12px',
                      background: 'none',
                      border: 'none',
                      color: '#2563eb',
                      fontSize: '13px',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    <Plus size={14} /> New
                  </button>
                </div>
              </div>

              {/* Content */}
              {isExpanded && (
                <div style={{ overflowX: 'auto' }}>
                  {isLoading ? (
                    <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                      Loading...
                    </div>
                  ) : items.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr>
                          <th
                            style={{
                              padding: '12px 16px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#64748b',
                              textTransform: 'uppercase',
                              borderBottom: '1px solid #e2e8f0',
                            }}
                          >
                            DATE
                          </th>
                          <th
                            style={{
                              padding: '12px 16px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#64748b',
                              textTransform: 'uppercase',
                              borderBottom: '1px solid #e2e8f0',
                            }}
                          >
                            NUMBER
                          </th>
                          <th
                            style={{
                              padding: '12px 16px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#64748b',
                              textTransform: 'uppercase',
                              borderBottom: '1px solid #e2e8f0',
                              textAlign: 'right',
                            }}
                          >
                            {section === 'Purchase Orders' || section === 'Bills' ? 'AMOUNT' : 'QUANTITY'}
                          </th>
                          <th
                            style={{
                              padding: '12px 16px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#64748b',
                              textTransform: 'uppercase',
                              borderBottom: '1px solid #e2e8f0',
                            }}
                          >
                            STATUS
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item: { id: string; date?: string; billDate?: string; issueDate?: string; receiptDate?: string; purchaseOrderNumber?: string; poNumber?: string; billNumber?: string; challanNumber?: string; receiptNumber?: string; totalAmount?: number | string; total?: number | string; totalQty?: number | string; totalReceivedQty?: number | string; status?: string; [key: string]: unknown }) => {
                          const date = section === 'Purchase Orders' ? item.date : 
                                       section === 'Bills' ? item.billDate :
                                       section === 'Job Issues' ? item.issueDate :
                                       item.receiptDate;
                          const number = section === 'Purchase Orders' ? (item.poNumber || item.purchaseOrderNumber) : 
                                         section === 'Bills' ? item.billNumber :
                                         section === 'Job Issues' ? item.challanNumber :
                                         item.receiptNumber;
                          const amountOrQty = section === 'Purchase Orders' ? (item.totalAmount || item.total || 0) :
                                              section === 'Bills' ? (item.totalAmount || item.total || 0) :
                                              section === 'Job Issues' ? (item.totalQty || 0) :
                                              (item.totalReceivedQty || 0);
                          const status = item.status || 'Draft';
                          const link = section === 'Purchase Orders'
                            ? `/organizations/${orgId}/purchases/purchase-orders?id=${item.id}`
                            : section === 'Bills'
                            ? `/organizations/${orgId}/purchases/bills?id=${item.id}`
                            : section === 'Job Issues'
                            ? `/organizations/${orgId}/jobwork/issues?id=${item.id}`
                            : `/organizations/${orgId}/jobwork/receipts?id=${item.id}`;

                          return (
                            <tr
                              key={item.id}
                              style={{
                                borderBottom: '1px solid #e2e8f0',
                                backgroundColor: '#fff',
                              }}
                            >
                              <td style={{ padding: '12px 16px', fontSize: '13px', color: '#1e293b' }}>
                                {date ? format(new Date(date), 'dd/MM/yyyy') : '-'}
                              </td>
                              <td style={{ padding: '12px 16px', fontSize: '13px', color: '#2563eb' }}>
                                <Link to={link} style={{ color: '#2563eb', textDecoration: 'none' }}>
                                  {number}
                                </Link>
                              </td>
                              <td
                                style={{
                                  padding: '12px 16px',
                                  fontSize: '13px',
                                  color: '#1e293b',
                                  textAlign: 'right',
                                }}
                              >
                                {section === 'Purchase Orders' || section === 'Bills' ? `₹${Number(amountOrQty).toFixed(2)}` : Number(amountOrQty).toFixed(2)}
                              </td>
                              <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                                <span style={{
                                  color: status === 'Draft' ? '#64748b' : '#16a34a',
                                  background: status === 'Draft' ? '#f1f5f9' : '#dcfce7',
                                  padding: '2px 8px',
                                  borderRadius: '12px',
                                  fontSize: '12px'
                                }}>
                                  {status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                      No {section.toLowerCase()} found.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
