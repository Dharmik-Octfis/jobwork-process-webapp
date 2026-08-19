import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { itemsApi } from '../items.api';
import { Pagination } from '../../../components/ui/Pagination';

interface ItemTransactionsProps {
  orgId: string;
  itemId: string;
}

interface BillTransactionRow {
  id: string;
  billId?: string;
  billDate: string | null;
  billNumber: string;
  vendorName: string;
  quantity: number;
  rate?: number;
  amount?: number;
  status: string;
}

export function ItemTransactions({ orgId, itemId }: ItemTransactionsProps) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const { data, isLoading } = useQuery({
    queryKey: ['itemBills', orgId, itemId, page, perPage],
    queryFn: () => itemsApi.fetchItemBills(orgId, itemId, { page, perPage }),
    enabled: Boolean(orgId && itemId),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      {/* Filters row */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          padding: '16px 24px',
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      >
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            fontSize: '13px',
            color: '#1e293b',
            cursor: 'pointer',
          }}
        >
          Filter By: <span style={{ fontWeight: 500 }}>Bills</span>
          <ChevronDown size={14} />
        </button>
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            fontSize: '13px',
            color: '#1e293b',
            cursor: 'pointer',
          }}
        >
          Status: <span style={{ fontWeight: 500 }}>All</span>
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead
            style={{
              position: 'sticky',
              top: 0,
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              zIndex: 1,
            }}
          >
            <tr>
              <th
                style={{
                  padding: '12px 24px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#64748b',
                  whiteSpace: 'nowrap',
                }}
              >
                DATE
              </th>
              <th
                style={{
                  padding: '12px 24px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#64748b',
                  whiteSpace: 'nowrap',
                }}
              >
                BILL#
              </th>
              <th
                style={{
                  padding: '12px 24px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#64748b',
                  whiteSpace: 'nowrap',
                }}
              >
                VENDOR NAME
              </th>
              <th
                style={{
                  padding: '12px 24px',
                  textAlign: 'right',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#64748b',
                  whiteSpace: 'nowrap',
                }}
              >
                QUANTITY PURCHASED
              </th>
              <th
                style={{
                  padding: '12px 24px',
                  textAlign: 'right',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#64748b',
                  whiteSpace: 'nowrap',
                }}
              >
                PRICE
              </th>
              <th
                style={{
                  padding: '12px 24px',
                  textAlign: 'right',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#64748b',
                  whiteSpace: 'nowrap',
                }}
              >
                TOTAL
              </th>
              <th
                style={{
                  padding: '12px 24px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#64748b',
                  whiteSpace: 'nowrap',
                }}
              >
                STATUS
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  Loading transactions...
                </td>
              </tr>
            ) : data?.results.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  No transactions found.
                </td>
              </tr>
            ) : (
              data?.results.map((row: BillTransactionRow) => (
                <tr key={row.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '12px 24px', fontSize: '13px', color: '#1e293b' }}>
                    {row.billDate ? format(new Date(row.billDate), 'dd/MM/yyyy') : '-'}
                  </td>
                  <td style={{ padding: '12px 24px', fontSize: '13px', color: '#2563eb' }}>
                    {row.billId ? (
                      <Link
                        to={`/organizations/${orgId}/purchases/bills?id=${row.billId}`}
                        style={{ color: '#2563eb', textDecoration: 'none' }}
                        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                      >
                        {row.billNumber}
                      </Link>
                    ) : (
                      row.billNumber
                    )}
                  </td>
                  <td style={{ padding: '12px 24px', fontSize: '13px', color: '#1e293b' }}>
                    {row.vendorName}
                  </td>
                  <td
                    style={{
                      padding: '12px 24px',
                      fontSize: '13px',
                      color: '#1e293b',
                      textAlign: 'right',
                    }}
                  >
                    {row.quantity}
                  </td>
                  <td
                    style={{
                      padding: '12px 24px',
                      fontSize: '13px',
                      color: '#1e293b',
                      textAlign: 'right',
                    }}
                  >
                    ₹{row.rate?.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: '12px 24px',
                      fontSize: '13px',
                      color: '#1e293b',
                      textAlign: 'right',
                    }}
                  >
                    ₹{row.amount?.toFixed(2)}
                  </td>
                  <td style={{ padding: '12px 24px', fontSize: '13px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        background: row.status === 'Draft' ? '#f1f5f9' : '#dcfce7',
                        color: row.status === 'Draft' ? '#475569' : '#166534',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <Pagination
          pageContext={data.pageContext}
          page={page}
          perPage={perPage}
          onPageChange={setPage}
          onPerPageChange={setPerPage}
          onRequestCount={() => {}}
        />
      )}
    </div>
  );
}
