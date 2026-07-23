import type { Request, Response } from 'express';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import { PERMISSION_CATALOG } from './permissions.catalog.ts';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from './permission-templates.service.ts';
import type { CreateTemplateInput, UpdateTemplateInput } from './permission-templates.schemas.ts';

// No try/catch — Express 5 routes a rejected promise to `errorHandler`.

/** The permission vocabulary the admin UI renders as checkboxes. Static (code,
 * not tenant data), but served behind the org route so the client fetches it the
 * same way as everything else and only after membership is verified. */
export function getCatalog(_req: Request, res: Response): void {
  sendSuccess(res, { groups: PERMISSION_CATALOG });
}

export async function getTemplates(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await listTemplates(req.tenantId!));
}

export async function getOneTemplate(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getTemplate(req.tenantId!, req.params.id as string));
}

export async function postTemplate(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateTemplateInput;
  const created = await createTemplate(req.user!.id, req.tenantId!, input);
  sendSuccess(res, created, 'Role created.', 201);
}

export async function putTemplate(req: Request, res: Response): Promise<void> {
  const input = req.body as UpdateTemplateInput;
  const updated = await updateTemplate(req.user!.id, req.tenantId!, req.params.id as string, input);
  sendSuccess(res, updated, 'Role updated.');
}

export async function removeTemplate(req: Request, res: Response): Promise<void> {
  await deleteTemplate(req.user!.id, req.tenantId!, req.params.id as string);
  sendSuccess(res, null, 'Role deleted.');
}
