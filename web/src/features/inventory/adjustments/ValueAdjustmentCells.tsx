import { formatMoney, formatQty } from '../../jobwork/jobwork.schemas';
import { boxTexts, uomOf, type AdjustableItem, type LineDraft } from './adjustmentLine';

const td: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #eef0f3',
  verticalAlign: 'top',
  textAlign: 'right',
};

const muted: React.CSSProperties = { fontSize: 11, color: '#64748b', marginTop: 4 };

/** A signed amount with at most two decimals — "+500", "-1200.50". */
const MONEY_SIGNED = /^[+-]?\d*\.?\d{0,2}$/;
const MONEY = /^\d*\.?\d{0,2}$/;

/**
 * The four cells of a VALUE line: quantity on hand and current value (read-only),
 * then New Value and Adjusted Value — type in either, the other follows, exactly
 * as the quantity boxes do (`adjustmentLine.ts`).
 */
export function ValueCells({
  row,
  current,
  itemName,
  numberCell,
  onType,
}: {
  row: { item: AdjustableItem | null; line: LineDraft };
  current: { qty: number; value: number };
  itemName: string;
  numberCell: (name: string) => React.CSSProperties;
  onType: (box: 'adjusted' | 'new', text: string, currentValue: number) => void;
}) {
  const texts = boxTexts(row.line, current.value);
  const dash = <span style={{ fontSize: 13, color: '#94a3b8', lineHeight: '36px' }}>-</span>;

  return (
    <>
      <td style={td}>
        {row.item ? (
          <>
            <input
              aria-label={`Quantity on hand, ${itemName}`}
              value={formatQty(current.qty)}
              disabled
              className="locked-value"
              style={numberCell('qty')}
            />
            {uomOf(row.item) && <div style={muted}>{uomOf(row.item)}</div>}
          </>
        ) : (
          dash
        )}
      </td>
      <td style={td}>
        {row.item ? (
          <input
            aria-label={`Current value, ${itemName}`}
            value={formatMoney(current.value)}
            disabled
            className="locked-value"
            style={numberCell('current')}
          />
        ) : (
          dash
        )}
      </td>
      <td style={td}>
        <input
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`New value, ${itemName}`}
          disabled={!row.item}
          value={texts.newQty}
          onChange={(event) => {
            if (!MONEY.test(event.target.value)) return;
            onType('new', event.target.value, current.value);
          }}
          style={numberCell('value')}
        />
      </td>
      <td style={td}>
        <input
          inputMode="decimal"
          placeholder="Eg. +500, -500"
          aria-label={`Adjusted value, ${itemName}`}
          disabled={!row.item}
          value={texts.adjusted}
          onChange={(event) => {
            if (!MONEY_SIGNED.test(event.target.value)) return;
            onType('adjusted', event.target.value, current.value);
          }}
          style={numberCell('value')}
        />
      </td>
    </>
  );
}
