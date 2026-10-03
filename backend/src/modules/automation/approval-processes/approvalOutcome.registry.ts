/**
 * A module's own answer to "this record's approval state just changed".
 *
 * By default the engine writes the new status straight onto the record's
 * `status` column. That is right for a record whose approval is a label on top
 * of something that already happened. It is wrong for one whose approval is a
 * GATE — a stock adjustment must not move stock until it is approved, so
 * "approved" has to mean "post it now", which only the module can do.
 *
 * A handler registered here REPLACES the raw status write for its table. It
 * imports nothing, so a module can register itself without the engine depending
 * on that module.
 */
export interface ApprovalOutcome {
  organizationId: string;
  recordId: string;
  /** The engine's own wording: 'Pending Approval' | 'Approved' | 'Rejected'. */
  status: string;
}

export type ApprovalOutcomeHandler = (outcome: ApprovalOutcome) => Promise<void>;

const handlers = new Map<string, ApprovalOutcomeHandler>();

/** `tableName` is the record's table, e.g. `stock_adjustments`. */
export function registerApprovalOutcomeHandler(
  tableName: string,
  handler: ApprovalOutcomeHandler,
): void {
  handlers.set(tableName, handler);
}

export function approvalOutcomeHandlerFor(tableName: string): ApprovalOutcomeHandler | undefined {
  return handlers.get(tableName);
}
