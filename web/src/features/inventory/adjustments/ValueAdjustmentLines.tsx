import { formatDate } from '../../../lib/formatDate';
import { formatMoney, formatQty, toNumber } from '../../jobwork/jobwork.schemas';
import type { StockAdjustmentDetail } from './adjustments.schemas';

const cellStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 13,
  color: '#334155',
  verticalAlign: 'top',
};
const headStyle: React.CSSProperties = {
  ...cellStyle,
  fontSize: 11,
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};
const rightHead: React.CSSProperties = { ...headStyle, textAlign: 'right' };
const rightCell: React.CSSProperties = { ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' };

const signed = (value: number) => `${value > 0 ? '+' : '−'}${formatMoney(Math.abs(value))}`;
const rate = (value: number, qty: number) => (qty > 0 ? formatMoney(value / qty) : '-');

/**
 * A value adjustment's lines, and — once posted — what it did to each purchase
 * entry: the stock out at the old rate and back in at the new one, which is how
 * the item valuation report prints it (STOCK_ADJUSTMENT_VALUE_PLAN.md §8).
 */
export function ValueAdjustmentLines({
  adjustment,
  posted,
}: {
  adjustment: StockAdjustmentDetail;
  posted: boolean;
}) {
  return (
    <>
      <div style={{ marginTop: 24 }} className="responsive-table-wrapper">
        <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr>
              <th style={headStyle}>Item</th>
              {posted && <th style={rightHead}>Value Before</th>}
              <th style={rightHead}>Adjusted Value</th>
              {posted && <th style={rightHead}>Value After</th>}
            </tr>
          </thead>
          <tbody>
            {adjustment.lines.map((line) => {
              const change = toNumber(line.valueAdjusted);
              const before = toNumber(line.valueBefore);
              return (
                <tr key={line.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                  <td style={cellStyle}>
                    {line.item.name}
                    {line.item.sku && (
                      <div style={{ fontSize: 11, color: '#64748b' }}>SKU: {line.item.sku}</div>
                    )}
                  </td>
                  {posted && <td style={rightCell}>{formatMoney(before)}</td>}
                  <td
                    style={{
                      ...rightCell,
                      color: change > 0 ? '#166534' : '#b91c1c',
                      fontWeight: 500,
                    }}
                  >
                    {signed(change)}
                  </td>
                  {posted && <td style={rightCell}>{formatMoney(before + change)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {posted && adjustment.valueChanges.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
            Purchases revalued
          </div>
          <div className="responsive-table-wrapper">
            <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
              <thead style={{ background: '#f8fafc' }}>
                <tr>
                  <th style={headStyle}>Item</th>
                  <th style={headStyle}>Purchase</th>
                  <th style={rightHead}>Quantity</th>
                  <th style={rightHead}>Rate</th>
                  <th style={rightHead}>Value</th>
                </tr>
              </thead>
              <tbody>
                {adjustment.valueChanges.map((row, index) => {
                  const qty = toNumber(row.qty);
                  const before = toNumber(row.valueBefore);
                  const after = toNumber(row.valueAfter);
                  const item = adjustment.lines.find((line) => line.id === row.lineId)?.item;
                  return (
                    <tr key={index} style={{ borderBottom: '1px solid #eef0f3' }}>
                      <td style={cellStyle}>{item?.name ?? '-'}</td>
                      <td style={cellStyle}>
                        {row.entry}
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          {formatDate(row.inDate)}
                        </div>
                      </td>
                      <td style={rightCell}>{formatQty(qty)}</td>
                      <td style={rightCell}>
                        {rate(before, qty)} → {rate(after, qty)}
                      </td>
                      <td style={rightCell}>
                        {formatMoney(before)} → {formatMoney(after)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p style={{ marginTop: 16, fontSize: 12, color: '#64748b' }}>
        This changes stock value in this app only. Post the same change in your accounts.
      </p>
    </>
  );
}
