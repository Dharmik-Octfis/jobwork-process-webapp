import type { Request, Response } from 'express';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import { listRoles, getRole, createRole, updateRole, deleteRole } from './roles.service.ts';
import type { CreateRoleInput, UpdateRoleInput } from './roles.schemas.ts';

// No try/catch — Express 5 routes a rejected promise to `errorHandler`.

export async function getRoles(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await listRoles(req.tenantId!));
}

export async function getOneRole(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getRole(req.tenantId!, req.params.id as string));
}

export async function postRole(req: Request, res: Response): Promise<void> {
  const created = await createRole(req.user!.id, req.tenantId!, req.body as CreateRoleInput);
  sendSuccess(res, created, 'Role created.', 201);
}

export async function putRole(req: Request, res: Response): Promise<void> {
  const updated = await updateRole(
    req.user!.id,
    req.tenantId!,
    req.params.id as string,
    req.body as UpdateRoleInput,
  );
  sendSuccess(res, updated, 'Role updated.');
}

export async function removeRole(req: Request, res: Response): Promise<void> {
  await deleteRole(req.user!.id, req.tenantId!, req.params.id as string);
  sendSuccess(res, null, 'Role deleted.');
}
