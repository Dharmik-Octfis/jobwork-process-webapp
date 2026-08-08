import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { Fragment } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatQty, toNumber } from '../jobwork.schemas';
import type { AvailableLot } from '../lots/lots.api';

export interface LotSelection {
  /** Typed quantity for a lot-level pick. Ignored when packages are ticked. */
  qty: number;
  /** Ticked takas. Each takes its FULL measured quantity — never a partial. */
  packageIds: string[];
}

interface Props {
  lots: AvailableLot[];
  selection: Record<string, LotSelection>;
  onChange: (selection: Record<string, LotSelection>) => void;
  expanded: Record<string, boolean>;
  onToggleExpand: (lotId: string) => void;
  uomLabel: string;
  /** When the process demands one lot, picking a second is refused with the
   * reason shown rather than silently ignored. */
  singleLotOnly: boolean;
  onSingleLotBlocked: () => void;
  isLoading: boolean;
}

const th: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: '#333' };

const qtyInput: React.CSSProperties = {
  width: 110,
  padding: '5px 8px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  minHeight: 30,
};

/**
 * 🔴 THE CORE OF THE ISSUE DIALOG. Every row here came from an availability query
 * over the stock ledger — this is not a lot master, filtered.
 *
 * Two things about the interaction that are not stylistic choices:
 *
 * 1. A TAKA IS A CHECKBOX, NOT A QUANTITY BOX (field-sources §5.3). Ticking it
 *    takes the roll's full measured quantity, because a half-issued roll is not
 *    something that happens on a shop floor — the whole thing physically leaves.
 *    Offering a number there would let someone record 40 m issued out of a 98.5 m
 *    roll that went out whole.
 *
 * 2. ⚠️ TAKA SELECTION IS OFF. Material is issued as a quantity against the
 *    LOT; the per-taka checkboxes and the row that expanded to show them are not
 *    rendered. `PACKAGE_LEVEL` below is the single switch — flip it to `true`
 *    and the taka rows come back exactly as they were, keyboard handling and all.
 *
 *    While it is off, a lot with takas behaves like any other: one quantity box,
 *    checked against the lot's own balance.
 */

/** ⚠️ Taka-by-taka issuing. Off for now — see note 2 above. */
const PACKAGE_LEVEL = false;

export function LotPicker({
  lots,
  selection,
  onChange,
  expanded,
  onToggleExpand,
  uomLabel,
  singleLotOnly,
  onSingleLotBlocked,
  isLoading,
}: Props) {
  /**
   * 🔴 Scoped to the lots THIS picker renders — i.e. to one item (§5.7).
   *
   * The dialog shows a section per input item and they share one selection map,
   * so counting the whole map would make picking fabric block picking thread on
   * any single-lot process. Two items are necessarily two lots; the rule is
   * about two lots of the SAME item, which is what shade variation means, and
   * the server checks it exactly this way.
   */
  const renderedLotIds = new Set(lots.map((lot) => lot.lotId));
  const selectedLotIds = Object.entries(selection)
    .filter(
      ([lotId, sel]) => renderedLotIds.has(lotId) && (sel.qty > 0 || sel.packageIds.length > 0),
    )
    .map(([lotId]) => lotId);

  /** True when picking from this lot would break the single-lot rule. */
  const blockedByLotRule = (lotId: string) =>
    singleLotOnly && selectedLotIds.length > 0 && !selectedLotIds.includes(lotId);

  const setLot = (lotId: string, patch: Partial<LotSelection>) => {
    const current = selection[lotId] ?? { qty: 0, packageIds: [] };
    onChange({ ...selection, [lotId]: { ...current, ...patch } });
  };

  if (isLoading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
        Looking up available stock…
      </div>
    );
  }

  if (lots.length === 0) {
    return (
      <div
        style={{
          padding: '20px 24px',
          background: '#f8fafc',
          border: '1px dashed #cbd5e1',
          borderRadius: 4,
          color: '#475569',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        No stock of this item is available at that location for this job order&rsquo;s ownership.
        Either the material has not been received yet, or it has already been issued.
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid #eef0f3', borderRadius: 4, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
            {PACKAGE_LEVEL && <th style={{ ...th, width: 36 }} scope="col" aria-label="Expand" />}
            <th style={th} scope="col">
              Lot
            </th>
            <th style={th} scope="col">
              Party ref
            </th>
            <th style={th} scope="col">
              Available
            </th>
            <th style={th} scope="col">
              Age
            </th>
            <th style={th} scope="col">
              Cost / unit
            </th>
            <th style={{ ...th, width: 150 }} scope="col">
              Qty to issue
            </th>
          </tr>
        </thead>
        <tbody>
          {lots.map((lot) => {
            const sel = selection[lot.lotId] ?? { qty: 0, packageIds: [] };
            const hasPackages = PACKAGE_LEVEL && lot.packages.length > 0;
            const isExpanded = expanded[lot.lotId] ?? false;
            const blocked = blockedByLotRule(lot.lotId);
            const selectedPackageQty = lot.packages
              .filter((pkg) => sel.packageIds.includes(pkg.lotPackageId))
              .reduce((sum, pkg) => sum + toNumber(pkg.qty), 0);

            return (
              // A lot renders as its own row PLUS one row per taka, so the two
              // have to share a keyed parent — otherwise React re-creates the
              // expanded rows on every render and a half-ticked list resets.
              <Fragment key={lot.lotId}>
                <tr
                  style={{
                    borderBottom: '1px solid #eef0f3',
                    background: blocked ? '#fafafa' : undefined,
                    opacity: blocked ? 0.55 : 1,
                  }}
                >
                  {PACKAGE_LEVEL && (
                    <td style={td}>
                      {hasPackages && (
                        <button
                          type="button"
                          onClick={() => onToggleExpand(lot.lotId)}
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} takas of ${lot.lotNumber}`}
                          aria-expanded={isExpanded}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 24,
                            height: 24,
                            border: '1px solid #e2e8f0',
                            borderRadius: 4,
                            background: '#fff',
                            cursor: 'pointer',
                            color: '#64748b',
                          }}
                        >
                          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                      )}
                    </td>
                  )}
                  <td style={{ ...td, fontWeight: 500, color: '#111' }}>
                    {lot.lotNumber}
                    {hasPackages && (
                      <span style={{ display: 'block', fontSize: 11, color: '#64748b' }}>
                        {lot.packages.length} taka{lot.packages.length === 1 ? '' : 's'} available
                      </span>
                    )}
                  </td>
                  <td style={td}>{lot.supplierLotRef ?? '-'}</td>
                  <td style={td}>
                    {formatQty(lot.availableQty)} {uomLabel}
                  </td>
                  <td style={td}>{lot.ageDays === null ? '-' : `${lot.ageDays}d`}</td>
                  <td style={td}>{lot.costPerUnit === null ? '-' : formatQty(lot.costPerUnit)}</td>
                  <td style={td}>
                    {hasPackages ? (
                      <span
                        style={{ fontSize: 12, color: selectedPackageQty > 0 ? '#111' : '#94a3b8' }}
                      >
                        {selectedPackageQty > 0
                          ? `${formatQty(selectedPackageQty)} ${uomLabel}`
                          : 'Pick takas'}
                      </span>
                    ) : (
                      <input
                        type="number"
                        onWheel={blurOnWheel}
                        step="0.0001"
                        min="0"
                        max={toNumber(lot.availableQty)}
                        value={sel.qty || ''}
                        onChange={(e) => {
                          if (blocked) {
                            onSingleLotBlocked();
                            return;
                          }
                          setLot(lot.lotId, { qty: Number(e.target.value) });
                        }}
                        onFocus={() => {
                          if (blocked) onSingleLotBlocked();
                        }}
                        aria-label={`Quantity to issue from lot ${lot.lotNumber}`}
                        style={{
                          ...qtyInput,
                          background: blocked ? '#f1f5f9' : '#fff',
                          cursor: blocked ? 'not-allowed' : 'text',
                        }}
                        readOnly={blocked}
                      />
                    )}
                  </td>
                </tr>

                {isExpanded &&
                  lot.packages.map((pkg) => {
                    const checked = sel.packageIds.includes(pkg.lotPackageId);
                    return (
                      <tr key={pkg.lotPackageId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={td} />
                        <td style={td} colSpan={2}>
                          <label
                            style={{
                              display: 'flex',
                              gap: 8,
                              alignItems: 'center',
                              cursor: blocked ? 'not-allowed' : 'pointer',
                              fontSize: 13,
                              color: '#334155',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={blocked}
                              onChange={(e) => {
                                if (blocked) {
                                  onSingleLotBlocked();
                                  return;
                                }
                                setLot(lot.lotId, {
                                  packageIds: e.target.checked
                                    ? [...sel.packageIds, pkg.lotPackageId]
                                    : sel.packageIds.filter((id) => id !== pkg.lotPackageId),
                                });
                              }}
                            />
                            {pkg.label ?? `${lot.lotNumber}/${pkg.packageNumber}`}
                          </label>
                        </td>
                        <td style={td} colSpan={3}>
                          {/* The measured figure — the whole reason takas exist. */}
                          {formatQty(pkg.qty)} {uomLabel}
                        </td>
                        <td style={{ ...td, fontSize: 11, color: '#94a3b8' }}>
                          {checked ? 'Whole taka' : ''}
                        </td>
                      </tr>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
