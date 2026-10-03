import { notify } from '../../../lib/notify';
import type { Bill } from './bills.schemas';

/** `bills.approval_status` as people read it. A bill's `status` is only Draft or Open. */
export const APPROVAL_LABELS: Record<string, string> = {
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const APPROVAL_COLOURS: Record<string, string> = {
  pending: '#d97706',
  approved: '#16a34a',
  rejected: '#dc2626',
};

/** Say what asking to open a bill ended as — it is not always "opened". */
export function announceOpenOutcome(bill: Pick<Bill, 'billNumber' | 'status' | 'approvalStatus'>) {
  if (bill.status?.toLowerCase() === 'open') {
    notify.success(`${bill.billNumber} opened. Stock updated.`);
  } else if (bill.approvalStatus === 'pending') {
    notify.success(`${bill.billNumber} sent for approval. Stock moves once it is approved.`);
  }
}
