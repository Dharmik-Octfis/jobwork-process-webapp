import type { Request, Response, NextFunction } from 'express';
import { listMembers, assignRole, removeMember } from './members.service.ts';
import type { AssignRoleInput } from './members.schemas.ts';

export async function getMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await listMembers(req.tenantId!));
  } catch (error) {
    next(error);
  }
}

export async function putMemberRole(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { permissionTemplateId } = req.body as AssignRoleInput;
    const updated = await assignRole(
      req.user!.id,
      req.tenantId!,
      req.params.id as string,
      permissionTemplateId,
    );
    res.json(updated);
  } catch (error) {
    next(error);
  }
}

export async function deleteMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await removeMember(req.user!.id, req.tenantId!, req.params.id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
