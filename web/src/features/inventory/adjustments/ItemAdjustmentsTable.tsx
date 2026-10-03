import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { formatMoney, formatQty, toNumber } from '../../jobwork/jobwork.schemas';
import { fetchAdjustments } from './adjustments.api';
import { adjustmentStatusMeta } from './adjustments.schemas';

const th: React.CSSProperties = {
  padding: '12px 24px',
  textAlign: 'left',
  fontSize: '12px',
  fontWeight: 600,
  color: '#64748b',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '12px 24px', fontSize: '13px', color: '#1e293b' };

/**
 * One item's stock adjustments — the "Inventory Adjustments" view of the item page's
 * Transactions tab. Its own table rather than more branches in the shared one:
 * an adjustment has no vendor, no price and a signed quantity.
 */
export function ItemAdjustmentsTable({ orgId, itemId }: { orgId: string; itemId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['itemAdjustments', orgId, itemId],
    queryFn: () => fetchAdjustments(orgId, { itemId, page: 1, perPage: 25 }),
    enabled: Boolean(orgId && itemId),
  });
  const rows = data?.results ?? [];

  return (
    <div className="responsive-table-wrapper">
      <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse' }}>
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
            <th style={th}>DATE</th>
            <th style={th}>ADJUSTMENT#</th>
            <th style={th}>LOCATION</th>
            <th style={th}>REASON</th>
            <th style={{ ...th, textAlign: 'right' }}>ADJUSTED</th>
            <th style={th}>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                Loading transactions...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                No transactions found.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              // An adjustment may cover several items; this tab is about one of them.
              const mine = row.lines.find((line) => line.itemId === itemId);
              const isValue = row.adjustmentType === 'value';
              const quantity = toNumber(isValue ? mine?.valueAdjusted : mine?.quantityAdjusted);
              const status = adjustmentStatusMeta(row.status);
              return (
                <tr key={row.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={td}>{format(new Date(row.adjustmentDate), 'dd/MM/yyyy')}</td>
                  <td style={td}>
                    <Link
                      to={`/organizations/${orgId}/inventory/adjustments?id=${row.id}`}
                      style={{ color: '#2563eb', textDecoration: 'none' }}
                    >
                      {row.adjustmentNumber}
                    </Link>
                  </td>
                  <td style={td}>{row.location.name}</td>
                  <td style={td}>{row.reason.name}</td>
                  <td
                    style={{
                      ...td,
                      textAlign: 'right',
                      color: quantity > 0 ? '#166534' : '#b91c1c',
                      fontWeight: 500,
                    }}
                  >
                    {quantity > 0 ? '+' : '−'}
                    {isValue ? formatMoney(Math.abs(quantity)) : formatQty(Math.abs(quantity))}
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        background: status.bg,
                        color: status.color,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {status.label}
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
