import type { Request, Response } from 'express';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import { ApiError } from '../../../../lib/apiError.ts';
import { listQuerySchema } from '../../../../lib/pagination.ts';
import { PERMISSION_CATALOG } from './permissions.catalog.ts';
import {
  listTemplates,
  countTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from './permission-templates.service.ts';
import type { CreateTemplateInput, UpdateTemplateInput } from './permission-templates.schemas.ts';

// No try/catch — Express 5 routes a rejected promise to `errorHandler`.

/**
 * Query strings are parsed here rather than by `validateBody`, which reads
 * `req.body` — and Express 5's `req.query` is a read-only getter, so it cannot be
 * reassigned by a middleware either. Same failure shape as `validateBody`:
 * field-keyed `details` beside the message. Copied from members.controller.ts.
 */
function parseListQuery(req: Request) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw ApiError.badRequest(
      'Invalid list query.',
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || 'query', i.message])),
    );
  }
  return parsed.data;
}

/** The permission vocabulary the admin UI renders as checkboxes. Static (code,
 * not tenant data), but served behind the org route so the client fetches it the
 * same way as everything else and only after membership is verified. */
export function getCatalog(_req: Request, res: Response): void {
  sendSuccess(res, { groups: PERMISSION_CATALOG });
}

/** GET /permission-templates?filter=…&search=…&page=…&perPage=… → `{ results, pageContext }` */
export async function getTemplates(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await listTemplates(req.tenantId!, parseListQuery(req)));
}

/** GET /permission-templates/count — the opt-in total behind the "Total count:
 * view" link. Separate from the list for the reason every module's is: a list
 * request must never pay for a COUNT(*) nobody reads. */
export async function getTemplatesCount(req: Request, res: Response): Promise<void> {
  const total = await countTemplates(req.tenantId!, parseListQuery(req));
  sendSuccess(res, { total });
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
