import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import {
  listApprovalRequests,
  getApprovalRequestById,
  getRecordApprovalHistoryAction,
  approveStageAction,
  rejectRequestAction,
  cancelRequestAction,
} from './approvalProcess.controller.ts';

export const approvalsInboxRouter = Router({ mergeParams: true });

// Tenant and auth verification
approvalsInboxRouter.use(authenticate, tenantContext);

// ── Approvals Inbox & Record Endpoints ──────────────────────────────────────────
approvalsInboxRouter.get('/', listApprovalRequests);
approvalsInboxRouter.get('/records/:moduleId/:recordId', getRecordApprovalHistoryAction);
approvalsInboxRouter.get('/:id', getApprovalRequestById);
approvalsInboxRouter.post('/:id/approve', approveStageAction);
approvalsInboxRouter.post('/:id/reject', rejectRequestAction);
approvalsInboxRouter.post('/:id/cancel', cancelRequestAction);
