import type { Request, Response } from 'express';
import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';
import {
  appendJobOrderSteps,
  countJobOrders,
  createNewJobOrder,
  deleteJobOrderById,
  getJobOrderById,
  getJobOrderNumberPreference,
  getJobOrderOverview,
  getJobOrdersList,
  manuallyCompleteStep,
  shortCloseJobOrder,
  updateJobOrderById,
  updateJobOrderNumberPreference,
} from './jobOrders.service.ts';
import {
  appendJobOrderStepsSchema,
  createJobOrderSchema,
  shortCloseSchema,
  type AppendJobOrderStepsInput,
  type CreateJobOrderInput,
  type ShortCloseInput,
  type UpdateJobOrderInput,
} from './jobOrders.schemas.ts';

const orgParam = z.object({ orgId: z.string() });

/** Body for the number-sequence preference endpoint. Same shape as Vendor's. */
export const numberPreferenceSchema = z.object({
  prefix: z.string().trim().max(20),
  nextNumber: z.number().int().positive(),
});
export type NumberPreferenceInput = z.infer<typeof numberPreferenceSchema>;

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/jobwork/job-orders/preferences/number-sequence',
  tags: ['Job Orders'],
  summary: 'The prefix and next number new job orders are numbered from',
  request: { params: orgParam },
  responses: { 200: { description: '{ prefix, nextNumber }' } },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{orgId}/jobwork/job-orders/preferences/number-sequence',
  tags: ['Job Orders'],
  summary: 'Change the job order numbering series',
  request: {
    params: orgParam,
    body: { content: { 'application/json': { schema: numberPreferenceSchema } } },
  },
  responses: { 200: { description: 'Preference updated' } },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/jobwork/job-orders',
  tags: ['Job Orders'],
  summary: 'List job orders (paginated, searchable)',
  request: {
    params: orgParam,
    query: z.object({
      search: z.string().optional(),
      filter: z.string().optional(),
      page: z.string().optional(),
      perPage: z.string().optional(),
    }),
  },
  responses: { 200: { description: 'Paginated job orders: { results, pageContext }' } },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/jobwork/job-orders',
  tags: ['Job Orders'],
  summary: 'Create a job order, its steps, and optionally its incoming material',
  request: {
    params: orgParam,
    body: { content: { 'application/json': { schema: createJobOrderSchema } } },
  },
  responses: {
    201: { description: 'Job order created' },
    400: { description: 'Validation failed, or the step chain is broken' },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/jobwork/job-orders/{id}/overview',
  tags: ['Job Orders'],
  summary:
    'The Overview page: stepper, per-step totals, live stock balance and the order’s issue/receipt history',
  request: { params: orgParam.extend({ id: z.string() }) },
  responses: { 200: { description: 'Overview' }, 404: { description: 'Not found' } },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/jobwork/job-orders/{id}/steps',
  tags: ['Job Orders'],
  summary: 'Append one or more steps to the end of a job order',
  request: {
    params: orgParam.extend({ id: z.string() }),
    body: { content: { 'application/json': { schema: appendJobOrderStepsSchema } } },
  },
  responses: {
    201: { description: 'Step appended' },
    409: { description: 'The order is closed short or cancelled' },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/jobwork/job-orders/{id}/short-close',
  tags: ['Job Orders'],
  summary: 'Close a job order short, with a reason',
  request: {
    params: orgParam.extend({ id: z.string() }),
    body: { content: { 'application/json': { schema: shortCloseSchema } } },
  },
  responses: { 200: { description: 'Closed short' }, 409: { description: 'Already closed' } },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/jobwork/job-orders/{id}/steps/{stepId}/complete',
  tags: ['Job Orders'],
  summary: 'Manually complete a job order step',
  request: {
    params: orgParam.extend({ id: z.string(), stepId: z.string() }),
  },
  responses: { 200: { description: 'Step completed' } },
});

export const getJobOrders = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, await getJobOrdersList(req.tenantId!, parsed.data));
};

export const getJobOrderCount = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, { total: await countJobOrders(req.tenantId!, parsed.data) });
};

export const createJobOrder = async (req: Request, res: Response) => {
  const created = await createNewJobOrder(
    req.tenantId!,
    req.body as CreateJobOrderInput,
    req.user?.id,
  );
  sendSuccess(res, created, 'Job order created.', 201);
};

export const getJobOrder = async (req: Request, res: Response) => {
  const found = await getJobOrderById(req.tenantId!, req.params.id as string);
  if (!found) throw ApiError.notFound('Job order not found');
  sendSuccess(res, found);
};

/** The stepper page. One request, because every tile on it is derived from a
 * different table and four round trips would render four different moments. */
export const getOverview = async (req: Request, res: Response) => {
  sendSuccess(res, await getJobOrderOverview(req.tenantId!, req.params.id as string));
};

export const updateJobOrder = async (req: Request, res: Response) => {
  const updated = await updateJobOrderById(
    req.tenantId!,
    req.params.id as string,
    req.body as UpdateJobOrderInput,
    req.user?.id,
  );
  sendSuccess(res, updated, 'Job order updated.');
};

/** Append work to a running order. `PUT /:id` refuses anything but a draft — this
 * is the narrow, insert-only path that a released order does accept. */
export const appendSteps = async (req: Request, res: Response) => {
  const updated = await appendJobOrderSteps(
    req.tenantId!,
    req.params.id as string,
    req.body as AppendJobOrderStepsInput,
    req.user?.id,
  );
  sendSuccess(res, updated, 'Step added.', 201);
};

export const shortClose = async (req: Request, res: Response) => {
  const { reason } = req.body as ShortCloseInput;
  const updated = await shortCloseJobOrder(
    req.tenantId!,
    req.params.id as string,
    reason,
    req.user?.id,
  );
  sendSuccess(res, updated, 'Job order closed short.');
};

export const deleteJobOrder = async (req: Request, res: Response) => {
  await deleteJobOrderById(req.tenantId!, req.params.id as string, req.user?.id);
  sendSuccess(res, null, 'Job order deleted.');
};

export const getNumberPreferenceRoute = async (req: Request, res: Response) => {
  sendSuccess(res, await getJobOrderNumberPreference(req.tenantId!));
};

export const updateNumberPreferenceRoute = async (req: Request, res: Response) => {
  const { prefix, nextNumber } = req.body as NumberPreferenceInput;
  const pref = await updateJobOrderNumberPreference(req.tenantId!, prefix, nextNumber);
  sendSuccess(res, pref, 'Number preference updated.');
};

export const completeStep = async (req: Request, res: Response) => {
  const updated = await manuallyCompleteStep(
    req.tenantId!,
    req.params.id as string,
    req.params.stepId as string,
    req.user?.id,
  );
  sendSuccess(res, updated, 'Step completed.');
};
