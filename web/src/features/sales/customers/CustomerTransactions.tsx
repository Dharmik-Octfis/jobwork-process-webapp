import { useState } from 'react';
import { ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchJobOrders } from '../../jobwork/job-orders/jobOrders.api';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

interface CustomerTransactionsProps {
  orgId: string;
  customerId: string;
}

export function CustomerTransactions({ orgId, customerId }: CustomerTransactionsProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>('Customer Payments');

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const sections = ['Job Orders'];

  const fieldFilters = JSON.stringify({ ownerPartyId: customerId });

  const { data: joData, isLoading: isLoadingJO } = useQuery({
    queryKey: ['customer-jobOrders', orgId, customerId],
    queryFn: () => fetchJobOrders(orgId, { fieldFilters }),
    enabled: Boolean(orgId && customerId),
  });

  const jobOrders = joData?.results || [];

  const _dummyPayments = [
    {
      date: '22/09/2026',
      location: 'Head Office',
      paymentNumber: '306',
      referenceNumber: '-',
      paymentMode: 'Cash',
      amount: '₹726.00',
      unusedAmount: '₹0.00',
      status: 'Paid',
    },
    {
      date: '19/09/2026',
      location: 'Head Office',
      paymentNumber: '312',
      referenceNumber: '-',
      paymentMode: 'UPI',
      amount: '₹2,300.00',
      unusedAmount: '₹0.00',
      status: 'Paid',
    },
    {
      date: '19/09/2026',
      location: 'Head Office',
      paymentNumber: '311',
      referenceNumber: '-',
      paymentMode: 'Card',
      amount: '₹7,000.00',
      unusedAmount: '₹0.00',
      status: 'Paid',
    },
    {
      date: '18/09/2026',
      location: 'Head Office',
      paymentNumber: '310',
      referenceNumber: '-',
      paymentMode: 'Debit Card',
      amount: '₹169.46',
      unusedAmount: '₹0.00',
      status: 'Paid',
    },
    {
      date: '16/09/2026',
      location: 'Head Office',
      paymentNumber: '305',
      referenceNumber: '-',
      paymentMode: 'Cash',
      amount: '₹560.00',
      unusedAmount: '₹0.00',
      status: 'Paid',
    },
    {
      date: '17/08/2026',
      location: 'Head Office',
      paymentNumber: '290',
      referenceNumber: '-',
      paymentMode: 'Cash',
      amount: '₹590.00',
      unusedAmount: '₹0.00',
      status: 'Paid',
    },
    {
      date: '08/08/2026',
      location: 'Head Office',
      paymentNumber: '289',
      referenceNumber: '-',
      paymentMode: 'Cash',
      amount: '₹10.50',
      unusedAmount: '₹0.00',
      status: 'Paid',
    },
    {
      date: '23/06/2026',
      location: 'Head Office',
      paymentNumber: '287',
      referenceNumber: '-',
      paymentMode: 'Cash',
      amount: '₹308.70',
      unusedAmount: '₹0.00',
      status: 'Paid',
    },
  ];

  return (
    <div style={{ padding: '16px', background: '#f8fafc', height: '100%', minHeight: '500px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {sections.map((section) => {
          const isExpanded = expandedSection === section;
          const isLoading = isLoadingJO;
          const items = jobOrders;

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
                            JOB ORDER
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
                            QTY
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
                        {items.map((item: any) => {
                          const date = item.orderDate;
                          const number = item.jobOrderNumber;
                          const amount = item.inputQty || 0;
                          const status = item.status || 'Draft';
                          const link = `/organizations/${orgId}/jobwork/job-orders?id=${item.id}`;

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
                                {amount}
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
