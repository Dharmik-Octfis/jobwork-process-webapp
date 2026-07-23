import type { Request, Response } from 'express';
import { ApiError } from '../../../../lib/apiError.ts';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import { isEntityType } from './customFields.constants.ts';
import type {
  CreateDefinitionInput,
  ReorderInput,
  UpdateDefinitionInput,
} from './custom-fields.schemas.ts';
import * as service from './custom-fields.service.ts';

/** Read `?entityType=` and reject anything not in the allowlist (vendor | item). */
function requireEntityType(req: Request) {
  const raw = req.query['entityType'];
  const value = typeof raw === 'string' ? raw : '';
  if (!isEntityType(value)) {
    throw ApiError.badRequest('Unknown or missing module (entityType).');
  }
  return value;
}

// GET / — active fields for rendering a record form (any member of the org).
export async function getActiveDefinitions(req: Request, res: Response): Promise<void> {
  const orgId = req.tenantId!;
  const entityType = requireEntityType(req);
  const fields = await service.listActiveDefinitions(orgId, entityType);
  sendSuccess(res, { fields });
}

// GET /definitions — all non-archived fields for the admin manager (admin only).
export async function getDefinitions(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  const orgId = req.tenantId!;
  const entityType = requireEntityType(req);
  const fields = await service.listDefinitions(req.user.id, orgId, entityType);
  sendSuccess(res, { fields });
}

export async function createDefinition(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  const orgId = req.tenantId!;
  const field = await service.createDefinition(
    req.user.id,
    orgId,
    req.body as CreateDefinitionInput,
  );
  sendSuccess(res, { field }, 'Field created.', 201);
}

export async function updateDefinition(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  const orgId = req.tenantId!;
  const id = req.params['id'] as string;
  const field = await service.updateDefinition(
    req.user.id,
    orgId,
    id,
    req.body as UpdateDefinitionInput,
  );
  sendSuccess(res, { field }, 'Field updated.');
}

export async function reorderDefinitions(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  const orgId = req.tenantId!;
  await service.reorderDefinitions(req.user.id, orgId, (req.body as ReorderInput).items);
  sendSuccess(res, null, 'Order updated.');
}

export async function archiveDefinition(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Sign in to continue.');
  const orgId = req.tenantId!;
  const id = req.params['id'] as string;
  await service.archiveDefinition(req.user.id, orgId, id);
  sendSuccess(res, null, 'Field archived.');
}
