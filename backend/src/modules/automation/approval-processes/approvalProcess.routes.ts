import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import {
  listApprovalProcesses,
  createApprovalProcess,
  getApprovalProcessById,
  updateApprovalProcess,
  deleteApprovalProcess,
  activateApprovalProcess,
  deactivateApprovalProcess,
  duplicateApprovalProcess,
  reorderApprovalProcesses,
  getModules,
  getModuleFields,
  listApprovalRequests,
  getApprovalRequestById,
  getRecordApprovalHistoryAction,
  approveStageAction,
  rejectRequestAction,
  cancelRequestAction,
} from './approvalProcess.controller.ts';

export const approvalProcessRouter = Router({ mergeParams: true });

// Authentication & Tenant isolation middlewares
approvalProcessRouter.use(authenticate, tenantContext);

// ── Module Metadata Endpoints ───────────────────────────────────────────────
approvalProcessRouter.get('/modules', getModules);
approvalProcessRouter.get('/modules/:moduleId/fields', getModuleFields);

// ── Approval Request Actions (Approvers & History) ───────────────────────────
approvalProcessRouter.get('/requests', listApprovalRequests);
approvalProcessRouter.get('/requests/records/:moduleId/:recordId', getRecordApprovalHistoryAction);
approvalProcessRouter.get('/requests/:id', getApprovalRequestById);
approvalProcessRouter.post('/requests/:id/approve', approveStageAction);
approvalProcessRouter.post('/requests/:id/reject', rejectRequestAction);
approvalProcessRouter.post('/requests/:id/cancel', cancelRequestAction);

// ── Approval Process Configuration Endpoints ────────────────────────────────
approvalProcessRouter.get(
  '/',
  requirePermission('approval_process:read'),
  listApprovalProcesses,
);

approvalProcessRouter.post(
  '/',
  requirePermission('approval_process:create'),
  createApprovalProcess,
);

approvalProcessRouter.post(
  '/reorder',
  requirePermission('approval_process:update'),
  reorderApprovalProcesses,
);

approvalProcessRouter.get(
  '/:id',
  requirePermission('approval_process:read'),
  getApprovalProcessById,
);

approvalProcessRouter.put(
  '/:id',
  requirePermission('approval_process:update'),
  updateApprovalProcess,
);

approvalProcessRouter.delete(
  '/:id',
  requirePermission('approval_process:delete'),
  deleteApprovalProcess,
);

approvalProcessRouter.post(
  '/:id/activate',
  requirePermission('approval_process:update'),
  activateApprovalProcess,
);

approvalProcessRouter.post(
  '/:id/deactivate',
  requirePermission('approval_process:update'),
  deactivateApprovalProcess,
);

approvalProcessRouter.post(
  '/:id/duplicate',
  requirePermission('approval_process:create'),
  duplicateApprovalProcess,
);
