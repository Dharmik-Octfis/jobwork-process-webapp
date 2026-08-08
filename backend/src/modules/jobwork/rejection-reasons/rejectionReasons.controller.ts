import type { Request, Response } from 'express';
import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';
import {
  countRejectionReasons,
  createNewRejectionReason,
  deleteRejectionReasonById,
  getRejectionReasonById,
  getRejectionReasonsList,
  updateRejectionReasonById,
} from './rejectionReasons.service.ts';
import {
  createRejectionReasonSchema,
  type CreateRejectionReasonInput,
} from './rejectionReasons.schemas.ts';

const orgParam = z.object({ orgId: z.string() });

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/jobwork/rejection-reasons',
  tags: ['Rejection Reasons'],
  summary: 'List rejection reasons',
  request: {
    params: orgParam,
    query: z.object({
      search: z.string().optional(),
      filter: z.string().optional(),
      page: z.string().optional(),
      perPage: z.string().optional(),
    }),
  },
  responses: { 200: { description: 'Paginated reasons: { results, pageContext }' } },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/jobwork/rejection-reasons',
  tags: ['Rejection Reasons'],
  summary: 'Create a rejection reason',
  request: {
    params: orgParam,
    body: { content: { 'application/json': { schema: createRejectionReasonSchema } } },
  },
  responses: { 201: { description: 'Created' }, 409: { description: 'Name already exists' } },
});

export const getRejectionReasons = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, await getRejectionReasonsList(req.tenantId!, parsed.data));
};

export const getRejectionReasonCount = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, { total: await countRejectionReasons(req.tenantId!, parsed.data) });
};

export const createRejectionReason = async (req: Request, res: Response) => {
  const created = await createNewRejectionReason(
    req.tenantId!,
    req.body as CreateRejectionReasonInput,
    req.user?.id,
  );
  sendSuccess(res, created, 'Rejection reason created.', 201);
};

export const getRejectionReason = async (req: Request, res: Response) => {
  const found = await getRejectionReasonById(req.tenantId!, req.params.id as string);
  if (!found) throw ApiError.notFound('Rejection reason not found');
  sendSuccess(res, found);
};

export const updateRejectionReason = async (req: Request, res: Response) => {
  const updated = await updateRejectionReasonById(
    req.tenantId!,
    req.params.id as string,
    req.body as CreateRejectionReasonInput,
    req.user?.id,
  );
  sendSuccess(res, updated, 'Rejection reason updated.');
};

export const deleteRejectionReason = async (req: Request, res: Response) => {
  await deleteRejectionReasonById(req.tenantId!, req.params.id as string, req.user?.id);
  sendSuccess(res, null, 'Rejection reason deleted.');
};
