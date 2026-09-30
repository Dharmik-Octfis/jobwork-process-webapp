import { useState } from 'react';
import { ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchJobOrders, fetchJobOrderCount } from '../../jobwork/job-orders/jobOrders.api';
import { fetchSalesOrders, fetchSalesOrderCount } from '../sales-orders/sales-orders.api';
import { Pagination } from '../../../components/ui/Pagination';
import { useListCount } from '../../../hooks/useListCount';
import { format } from 'date-fns';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { JobOrder } from '../../jobwork/job-orders/jobOrders.schemas';
import type { SalesOrder } from '../sales-orders/sales-orders.schemas';

interface CustomerTransactionsProps {
  orgId: string;
  customerId: string;
}

export function CustomerTransactions({ orgId, customerId }: CustomerTransactionsProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedSection, setExpandedSection] = useState<string | null>('Sales Orders');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const toggleSection = (section: string) => {
    if (expandedSection !== section) {
      setPage(1);
      setExpandedSection(section);
    } else {
      setExpandedSection(null);
    }
  };

  const sections = ['Sales Orders', 'Job Orders'];

  const soFilters = JSON.stringify({ customerId: customerId });
  const joFilters = JSON.stringify({ ownerPartyId: customerId });

  const { data: soData, isLoading: isLoadingSO } = useQuery({
    queryKey: ['customer-salesOrders', orgId, customerId, page, perPage],
    queryFn: () => fetchSalesOrders(orgId, { fieldFilters: soFilters, page, perPage }),
    enabled: Boolean(orgId && customerId && expandedSection === 'Sales Orders'),
  });

  const { data: joData, isLoading: isLoadingJO } = useQuery({
    queryKey: ['customer-jobOrders', orgId, customerId, page, perPage],
    queryFn: () => fetchJobOrders(orgId, { fieldFilters: joFilters, page, perPage }),
    enabled: Boolean(orgId && customerId && expandedSection === 'Job Orders'),
  });

  const { total: totalSO, isCounting: isCountingSO, request: requestCountSO } = useListCount(
    ['customer-salesOrders-count', orgId, customerId],
    () => fetchSalesOrderCount(orgId, { fieldFilters: soFilters })
  );

  const { total: totalJO, isCounting: isCountingJO, request: requestCountJO } = useListCount(
    ['customer-jobOrders-count', orgId, customerId],
    () => fetchJobOrderCount(orgId, { fieldFilters: joFilters })
  );

  const salesOrders = soData?.results || [];
  const jobOrders = joData?.results || [];

  return (
    <div style={{ padding: 0, background: '#f8fafc', height: '100%', minHeight: '500px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {sections.map((section) => {
          const isExpanded = expandedSection === section;
          const isLoading = section === 'Sales Orders' ? isLoadingSO : isLoadingJO;
          const items = section === 'Sales Orders' ? salesOrders : jobOrders;

          const pageContext = section === 'Sales Orders' ? soData?.pageContext : joData?.pageContext;
          const total = section === 'Sales Orders' ? totalSO : totalJO;
          const isCounting = section === 'Sales Orders' ? isCountingSO : isCountingJO;
          const onRequestCount = section === 'Sales Orders' ? requestCountSO : requestCountJO;

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
                      const newRoute = section === 'Sales Orders'
                        ? `/organizations/${orgId}/sales/sales-orders/new`
                        : `/organizations/${orgId}/jobwork/job-orders/new`;
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
                            {section === 'Sales Orders' ? 'SALES ORDER' : 'JOB ORDER'}
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
                              {section === 'Sales Orders' ? 'AMOUNT' : 'QTY'}
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
                          {items.map((item: SalesOrder | JobOrder) => {
                            const isSO = section === 'Sales Orders';
                            const so = item as SalesOrder;
                            const jo = item as JobOrder;

                            const date = isSO ? so.date : jo.orderDate;
                            const number = isSO ? so.soNumber : jo.jobOrderNumber;
                            const amount = isSO ? `₹${Number(so.totalAmount || 0).toFixed(2)}` : (jo.inputQty || 0);
                            const status = item.status || 'Draft';
                            const link = isSO
                              ? `/organizations/${orgId}/sales/sales-orders?id=${item.id}`
                              : `/organizations/${orgId}/jobwork/job-orders?id=${item.id}`;

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
                  {items.length > 0 && (
                    <Pagination
                      pageContext={pageContext}
                      page={page}
                      onPageChange={setPage}
                      perPage={perPage}
                      onPerPageChange={setPerPage}
                      total={total}
                      isCounting={isCounting}
                      onRequestCount={() => void onRequestCount()}
                    />
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
