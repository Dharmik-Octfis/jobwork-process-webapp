import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Read-only taka breakdown for tables that show one row per batch — the same look
 * as the Batch Details tab, in two parts.
 *
 * 🔴 The card goes in a SEPARATE row under the one clicked, never inside the cell
 * beside the toggle: in an auto-layout table a card in the cell widens its column
 * and every other column reflows on click.
 */
export function BatchUnitsToggle({
  count,
  open,
  onToggle,
  singular,
  plural,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  singular: string;
  plural: string;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'none',
          border: 'none',
          padding: '4px 2px',
          borderRadius: 4,
          cursor: 'pointer',
          color: '#0062ff',
          fontSize: 12,
          fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {count} {(count === 1 ? singular : plural).toLowerCase()}
      </button>
    </div>
  );
}

export function BatchUnitsCard({
  units,
  untaggedQty = 0,
  singular,
  heading,
  formatQty = (qty) => String(qty),
}: {
  units: readonly { batchUnitId: string; label: string; qty: number }[];
  /** The part of the batch's quantity in no taka. */
  untaggedQty?: number;
  singular: string;
  /** Names the batch when one row holds several, so each card says whose takas. */
  heading?: string;
  formatQty?: (qty: number) => string;
}) {
  return (
    <div
      style={{
        width: 'fit-content',
        background: '#ffffff',
        border: '1px solid #eef0f3',
        borderRadius: 4,
        padding: '6px 10px',
      }}
    >
      {heading && (
        <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 2 }}>
          {heading}
        </div>
      )}
      <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          {units.map((unit) => (
            <tr key={unit.batchUnitId}>
              <td
                style={{
                  padding: '2px 20px 2px 0',
                  color: '#334155',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {unit.label}
              </td>
              <td
                style={{
                  padding: '2px 0',
                  color: '#64748b',
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatQty(unit.qty)}
              </td>
            </tr>
          ))}
          {untaggedQty > 0.00005 && (
            <tr>
              <td style={{ padding: '2px 20px 2px 0', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                Not in a {singular.toLowerCase()}
              </td>
              <td
                style={{
                  padding: '2px 0',
                  color: '#94a3b8',
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatQty(untaggedQty)}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
