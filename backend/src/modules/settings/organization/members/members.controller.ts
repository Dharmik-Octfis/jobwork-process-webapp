import type { Request, Response } from 'express';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import { listMembers, updateMember, removeMember } from './members.service.ts';
import type { UpdateMemberInput } from './members.schemas.ts';

// No try/catch: Express 5 forwards a rejected promise from an async handler
// straight to `errorHandler`, the single place an error becomes a response.
// Catching here only to re-`next(error)` adds noise and nothing else.

export async function getMembers(req: Request, res: Response): Promise<void> {
  const members = await listMembers(req.tenantId!);
  sendSuccess(res, members);
}

/** PUT a member's role (title), permission template (access), or both — the body
 * carries whichever changed. */
export async function putMember(req: Request, res: Response): Promise<void> {
  const input = req.body as UpdateMemberInput;
  const updated = await updateMember(req.user!.id, req.tenantId!, req.params.id as string, input);

  const changedRole = input.roleId !== undefined;
  const changedAccess = input.permissionTemplateId !== undefined;
  const message =
    changedRole && changedAccess
      ? 'Role and permissions updated.'
      : changedAccess
        ? 'Permissions updated.'
        : 'Role updated.';

  sendSuccess(res, updated, message);
}

export async function deleteMember(req: Request, res: Response): Promise<void> {
  await removeMember(req.user!.id, req.tenantId!, req.params.id as string);
  // 200 with data:null, not 204 — a 204 has no body and so cannot carry the envelope.
  sendSuccess(res, null, 'Member removed.');
}
