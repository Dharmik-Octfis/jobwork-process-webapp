import type { Request, Response } from 'express';
import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';
import {
  countProcesses,
  createNewProcess,
  deleteProcessById,
  getProcessById,
  getProcessesList,
  updateProcessById,
} from './processes.service.ts';
import { createProcessSchema, type CreateProcessInput } from './processes.schemas.ts';

/**
 * 🔴 NO try/catch ANYWHERE IN THIS FILE. Express 5 forwards a rejected promise
 * from an async handler straight to `errorHandler`, which is the single place an
 * error becomes a response. A catch here would duplicate that handler, downgrade
 * real 404s and 403s to 500s, and leak internals — it really did echo connection
 * strings to the client once.
 *
 * The service throws `ApiError` (and `ApiError` with `details` keyed
 * `customFields.<key>` when the custom-field engine rejects a value); the
 * controller's only job is the happy path.
 */

const orgParam = z.object({ orgId: z.string() });

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/jobwork/processes',
  tags: ['Processes'],
  summary: 'List processes (paginated, searchable)',
  request: {
    params: orgParam,
    query: z.object({
      search: z.string().optional(),
      filter: z.string().optional(),
      page: z.string().optional(),
      perPage: z.string().optional(),
    }),
  },
  responses: { 200: { description: 'Paginated list of processes: { results, pageContext }' } },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/jobwork/processes',
  tags: ['Processes'],
  summary: 'Create a process',
  request: {
    params: orgParam,
    body: { content: { 'application/json': { schema: createProcessSchema } } },
  },
  responses: {
    201: { description: 'Process created' },
    400: { description: 'Validation failed' },
    409: { description: 'Process name already exists in this organization' },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/jobwork/processes/{id}',
  tags: ['Processes'],
  summary: 'Get a process by id',
  request: { params: orgParam.extend({ id: z.string() }) },
  responses: { 200: { description: 'Process' }, 404: { description: 'Not found' } },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{orgId}/jobwork/processes/{id}',
  tags: ['Processes'],
  summary: 'Update a process',
  request: {
    params: orgParam.extend({ id: z.string() }),
    body: { content: { 'application/json': { schema: createProcessSchema } } },
  },
  responses: {
    200: { description: 'Process updated' },
    404: { description: 'Not found' },
    409: { description: 'Process name already exists in this organization' },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/organizations/{orgId}/jobwork/processes/{id}',
  tags: ['Processes'],
  summary: 'Delete a process (soft)',
  request: { params: orgParam.extend({ id: z.string() }) },
  responses: { 200: { description: 'Process deleted' }, 404: { description: 'Not found' } },
});

export const getProcesses = async (req: Request, res: Response) => {
  // req.tenantId, never req.params.orgId: only tenantContext's copy has been
  // checked against `memberships`. The URL is a claim the client chose.
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, await getProcessesList(req.tenantId!, parsed.data));
};

/** Total matching processes — the "Total count: view" link. Same query params as
 * the list, so the number always describes the rows on screen. */
export const getProcessCount = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, { total: await countProcesses(req.tenantId!, parsed.data) });
};

export const createProcess = async (req: Request, res: Response) => {
  const created = await createNewProcess(
    req.tenantId!,
    req.body as CreateProcessInput,
    req.user?.id,
  );
  sendSuccess(res, created, 'Process created.', 201);
};

export const getProcess = async (req: Request, res: Response) => {
  const found = await getProcessById(req.tenantId!, req.params.id as string);
  if (!found) throw ApiError.notFound('Process not found');
  sendSuccess(res, found);
};

export const updateProcess = async (req: Request, res: Response) => {
  const updated = await updateProcessById(
    req.tenantId!,
    req.params.id as string,
    req.body as CreateProcessInput,
    req.user?.id,
  );
  sendSuccess(res, updated, 'Process updated.');
};

export const deleteProcess = async (req: Request, res: Response) => {
  await deleteProcessById(req.tenantId!, req.params.id as string, req.user?.id);
  // 200 with data:null, not 204 — a 204 carries no body, so it cannot express
  // the standard envelope.
  sendSuccess(res, null, 'Process deleted.');
};
