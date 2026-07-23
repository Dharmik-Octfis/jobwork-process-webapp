import type { Request, Response, NextFunction } from 'express';
import { PERMISSION_CATALOG } from './permissions.catalog.ts';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from './permission-templates.service.ts';
import type { CreateTemplateInput, UpdateTemplateInput } from './permission-templates.schemas.ts';

/** The permission vocabulary the admin UI renders as checkboxes. Static (code,
 * not tenant data), but served behind the org route so the client fetches it the
 * same way as everything else and only after membership is verified. */
export function getCatalog(_req: Request, res: Response): void {
  res.json({ groups: PERMISSION_CATALOG });
}

export async function getTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await listTemplates(req.tenantId!));
  } catch (error) {
    next(error);
  }
}

export async function getOneTemplate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getTemplate(req.tenantId!, req.params.id as string));
  } catch (error) {
    next(error);
  }
}

export async function postTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = req.body as CreateTemplateInput;
    const created = await createTemplate(req.user!.id, req.tenantId!, input);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
}

export async function putTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = req.body as UpdateTemplateInput;
    const updated = await updateTemplate(
      req.user!.id,
      req.tenantId!,
      req.params.id as string,
      input,
    );
    res.json(updated);
  } catch (error) {
    next(error);
  }
}

export async function removeTemplate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await deleteTemplate(req.user!.id, req.tenantId!, req.params.id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
