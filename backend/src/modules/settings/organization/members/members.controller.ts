import type { Request, Response } from 'express';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import { listMembers, assignRole, removeMember } from './members.service.ts';
import type { AssignRoleInput } from './members.schemas.ts';

// No try/catch: Express 5 forwards a rejected promise from an async handler
// straight to `errorHandler`, the single place an error becomes a response.
// Catching here only to re-`next(error)` adds noise and nothing else.

export async function getMembers(req: Request, res: Response): Promise<void> {
  const members = await listMembers(req.tenantId!);
  sendSuccess(res, members);
}

export async function putMemberRole(req: Request, res: Response): Promise<void> {
  const { permissionTemplateId } = req.body as AssignRoleInput;
  const updated = await assignRole(
    req.user!.id,
    req.tenantId!,
    req.params.id as string,
    permissionTemplateId,
  );
  sendSuccess(res, updated, 'Role updated.');
}

export async function deleteMember(req: Request, res: Response): Promise<void> {
  await removeMember(req.user!.id, req.tenantId!, req.params.id as string);
  // 200 with data:null, not 204 — a 204 has no body and so cannot carry the envelope.
  sendSuccess(res, null, 'Member removed.');
}
