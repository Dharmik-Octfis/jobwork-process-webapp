import { formatDate } from '../../../lib/formatDate';
import type { AvailableBatch, AvailableBatchUnit } from '../batches/batches.api';

/**
 * What a picked batch is, and what it is called — shared by the Issue dialog and
 * the Add Batches grid.
 *
 * Its own module because `react-refresh/only-export-components` is right: a file
 * that exports both a component and the helpers other components import loses
 * fast refresh for all of them.
 */

/**
 * 🔴 THE KEY IS THE BATCH **AND** THE GODOWN (2026-08-14).
 *
 * A challan may draw from every godown in a dispatch site, and one batch can sit
 * in two of them with two independent balances — so it is offered twice and can be
 * taken twice, with a different quantity from each. Keying on `batchId` alone
 * silently collapsed those into one row, and whichever was picked second
 * overwrote the first.
 */
export const rowKey = (batch: Pick<AvailableBatch, 'batchId' | 'locationId'>) =>
  `${batch.batchId}@${batch.locationId}`;

/**
 * 🔴 …AND THE PACKAGE, WHERE THERE IS ONE.
 *
 * A batch broken into rolls is several independent things a challan can take, so
 * each needs its own key — exactly as the batch-at-a-godown split above. The
 * batch's UNTAGGED remainder is a selection in its own right and takes the bare
 * `rowKey`, which is also what every selection made before the level existed is.
 */
export const selectionKey = (
  batch: Pick<AvailableBatch, 'batchId' | 'locationId'>,
  batchUnitId: string | null,
) => (batchUnitId ? `${rowKey(batch)}#${batchUnitId}` : rowKey(batch));

export interface BatchSelection {
  /**
   * 🔴 THE BATCH ITSELF, not just its id.
   *
   * The list underneath the dropdown is a SEARCH result: typing narrows it, and a
   * batch already chosen can drop straight out of it on the next keystroke.
   * Holding only an id would leave the row it selected with nothing to render and
   * nothing to check the quantity against.
   */
  batch: AvailableBatch;
  /**
   * Which package of it, when the org runs a unit level. Null is the batch's
   * untagged remainder — and is what every selection means in an org that does
   * not run one.
   *
   * Held whole for the same reason the batch is: the package list is part of a
   * search result and a ticked roll can drop out of it on the next keystroke,
   * leaving the row unable to say what it took or how much that was.
   */
  unit: AvailableBatchUnit | null;
  qty: number;
}

/**
 * 🔴 WHAT A BATCH IS CALLED ON SCREEN (2026-08-14).
 *
 * The reference off the physical tag, and nothing else. `batchNumber` is an
 * internal key — never rendered, never printed, never searched — so it is not a
 * fallback here either. A batch with no reference belongs to an untracked item,
 * whose batches nobody is supposed to be identifying in the first place; it gets a
 * dated placeholder rather than a blank cell or a leaked internal number.
 */
export function batchLabel(batch: AvailableBatch): string {
  const date = new Date(batch.createdAt);
  const stamp = Number.isNaN(date.getTime()) ? '—' : formatDate(date);
  return batch.supplierBatchRef?.trim() || `Stock of ${stamp}`;
}
