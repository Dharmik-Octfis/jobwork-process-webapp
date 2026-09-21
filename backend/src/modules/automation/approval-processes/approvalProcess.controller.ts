import type { Request, Response } from 'express';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { approvalProcessService } from './approvalProcess.service.ts';
import { approvalExecutionService } from './approvalExecution.service.ts';
import { moduleMetadataService } from './moduleMetadata.service.ts';
import { ensureApprovalTables } from './approvalTables.migration.ts';

// ── Process Configuration Controllers ──────────────────────────────────────────

export async function listApprovalProcesses(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const page = req.query.page ? Number(req.query.page) : 1;
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const moduleId = typeof req.query.moduleId === 'string' ? req.query.moduleId : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const trigger = typeof req.query.trigger === 'string' ? req.query.trigger : undefined;

  const result = await approvalProcessService.listProcesses(orgId, {
    page,
    limit,
    search,
    moduleId,
    status,
    trigger,
  });

  sendSuccess(res, result);
}

export async function createApprovalProcess(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const userId = req.user?.id;
  const { activateImmediately, ...rest } = req.body as { activateImmediately?: boolean; [key: string]: unknown };
  const result = await approvalProcessService.createProcess(
    orgId,
    { ...rest, activateImmediately } as any,
    userId,
  );
  sendSuccess(res, result, 'Approval process created successfully.', 201);
}

export async function getApprovalProcessById(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const processId = req.params.id as string;
  const process = await approvalProcessService.getProcessById(orgId, processId);
  sendSuccess(res, process);
}

export async function updateApprovalProcess(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const processId = req.params.id as string;
  const userId = req.user?.id;
  const result = await approvalProcessService.updateProcess(orgId, processId, req.body, userId);
  sendSuccess(res, result, 'Approval process updated successfully.');
}

export async function deleteApprovalProcess(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const processId = req.params.id as string;
  const userId = req.user?.id;
  await approvalProcessService.deleteProcess(orgId, processId, userId);
  sendSuccess(res, null, 'Approval process deleted.');
}

export async function activateApprovalProcess(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const processId = req.params.id as string;
  const userId = req.user?.id;
  await approvalProcessService.activateProcess(orgId, processId, userId);
  sendSuccess(res, null, 'Approval process activated.');
}

export async function deactivateApprovalProcess(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const processId = req.params.id as string;
  const userId = req.user?.id;
  await approvalProcessService.deactivateProcess(orgId, processId, userId);
  sendSuccess(res, null, 'Approval process deactivated.');
}

export async function duplicateApprovalProcess(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const processId = req.params.id as string;
  const userId = req.user?.id;
  const result = await approvalProcessService.duplicateProcess(orgId, processId, userId);
  sendSuccess(res, result, 'Approval process duplicated.', 201);
}

export async function reorderApprovalProcesses(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const { processIds } = req.body as { processIds: string[] };
  await approvalProcessService.reorderProcesses(orgId, processIds);
  sendSuccess(res, null, 'Approval processes reordered.');
}

// ── Module Metadata Controllers ───────────────────────────────────────────────

export async function getModules(req: Request, res: Response): Promise<void> {
  const orgId = req.tenantId!;
  const modules = await moduleMetadataService.getModules(orgId);
  sendSuccess(res, modules);
}

export async function getModuleFields(req: Request, res: Response): Promise<void> {
  const orgId = req.tenantId!;
  const moduleId = req.params.moduleId as string;
  const fields = await moduleMetadataService.getModuleFields(orgId, moduleId);
  sendSuccess(res, fields);
}

// ── Approval Request Execution Controllers ────────────────────────────────────

export async function listApprovalRequests(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const page = req.query.page ? Number(req.query.page) : 1;
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const moduleId = typeof req.query.moduleId === 'string' ? req.query.moduleId : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const tab = req.query.tab as 'all' | 'pending' | 'my' | 'approved' | 'rejected' | undefined;

  const result = await approvalExecutionService.listRequests(orgId, {
    userId: req.user?.id,
    tab,
    page,
    limit,
    status,
    moduleId,
    search,
  });

  sendSuccess(res, result);
}

export async function getApprovalRequestById(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const requestId = req.params.id as string;
  const details = await approvalExecutionService.getRequestDetails(orgId, requestId);
  sendSuccess(res, details);
}

export async function getRecordApprovalHistoryAction(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const moduleId = req.params.moduleId as string;
  const recordId = req.params.recordId as string;
  const data = await approvalExecutionService.getRecordApprovalHistory(orgId, moduleId, recordId);
  sendSuccess(res, data);
}

export async function approveStageAction(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const requestId = req.params.id as string;
  const userId = req.user!.id;
  const { comment } = req.body as { comment?: string };
  const ip = req.ip || undefined;
  const userAgent = req.headers['user-agent'] || undefined;

  const result = await approvalExecutionService.approveStage(
    orgId,
    requestId,
    userId,
    comment,
    ip,
    userAgent,
  );

  sendSuccess(res, result, 'Approval decision submitted successfully.');
}

export async function rejectRequestAction(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const requestId = req.params.id as string;
  const userId = req.user!.id;
  const { reason } = req.body as { reason: string };
  const ip = req.ip || undefined;
  const userAgent = req.headers['user-agent'] || undefined;

  const result = await approvalExecutionService.rejectRequest(
    orgId,
    requestId,
    userId,
    reason,
    ip,
    userAgent,
  );

  sendSuccess(res, result, 'Approval request rejected.');
}

export async function cancelRequestAction(req: Request, res: Response): Promise<void> {
  await ensureApprovalTables();
  const orgId = req.tenantId!;
  const requestId = req.params.id as string;
  const userId = req.user!.id;
  const { reason } = req.body as { reason?: string };

  const result = await approvalExecutionService.cancelRequest(
    orgId,
    requestId,
    userId,
    reason,
  );

  sendSuccess(res, result, 'Approval request cancelled.');
}
