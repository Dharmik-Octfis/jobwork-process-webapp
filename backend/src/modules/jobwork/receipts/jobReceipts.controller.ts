import type { Request, Response } from 'express';
import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';
import {
  cancelJobReceipt,
  countJobReceipts,
  createNewJobReceipt,
  deleteJobReceiptDraft,
  getJobReceiptById,
  getJobReceiptsList,
  getOutputBatchOptions,
  getReceiptsForStep,
  getReceivePrefill,
  postJobReceiptDraft,
} from './jobReceipts.service.ts';
import {
  createJobReceiptSchema,
  updateJobReceiptSchema,
  type CancelJobReceiptInput,
  type CreateJobReceiptInput,
  type UpdateJobReceiptInput,
} from './jobReceipts.schemas.ts';

const orgParam = z.object({ orgId: z.string() });

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/jobwork/receipts/prefill',
  tags: ['Job Receipts'],
  summary: 'Everything the Receive dialog needs: the mode, the open challans, the taka rows',
  request: { params: orgParam, query: z.object({ stepId: z.string() }) },
  responses: { 200: { description: 'Prefill' }, 404: { description: 'Step not found' } },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/jobwork/receipts',
  tags: ['Job Receipts'],
  summary: 'Receive goods back, split them by disposition, and create the output batches',
  request: {
    params: orgParam,
    body: { content: { 'application/json': { schema: createJobReceiptSchema } } },
  },
  responses: {
    201: { description: 'Received' },
    400: {
      description: 'The disposition split does not add up, or more is being received than is out',
    },
  },
});

export const getJobReceipts = async (req: Request, res: Response) => {
  const stepId = req.query.stepId;
  if (typeof stepId === 'string' && stepId) {
    sendSuccess(res, await getReceiptsForStep(req.tenantId!, stepId));
    return;
  }

  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, await getJobReceiptsList(req.tenantId!, parsed.data));
};

export const getJobReceiptCount = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, { total: await countJobReceipts(req.tenantId!, parsed.data) });
};

/**
 * The dialog's opening state. One request, because the mode, the open challans
 * and the per-taka rows are three queries that have to describe the same moment
 * — fetched separately, a challan closed in between renders rows for material
 * that is no longer out.
 */
export const getPrefill = async (req: Request, res: Response) => {
  const stepId = req.query.stepId;
  if (typeof stepId !== 'string' || !stepId) {
    throw ApiError.badRequest('A job order step is required.');
  }
  sendSuccess(res, await getReceivePrefill(req.tenantId!, stepId));
};

const batchOptionsQuerySchema = z.object({
  stepId: z.string().uuid(),
  itemId: z.string().uuid(),
  /** Narrows BOTH groups. Empty lists everything, first page first. */
  search: z.string().trim().max(200).optional(),
  /** `otherNextCursor` from the previous page. Page one omits it. */
  cursor: z.string().max(200).optional(),
  /** Include each batch's existing packages, so a row can add to one instead of
   * naming a new one. Opt-in and spelled exactly as on the batches picker: it
   * costs an extra grouped query, and only an org running the unit level can
   * render them. */
  withUnits: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{orgId}/jobwork/receipts/{id}',
  tags: ['Job Receipts'],
  summary: 'Rewrite a DRAFT receipt — and optionally post it. Refused once posted',
  request: {
    params: orgParam.extend({ id: z.string() }),
    body: { content: { 'application/json': { schema: updateJobReceiptSchema } } },
  },
  responses: {
    200: { description: 'Saved' },
    409: { description: 'Already posted, so it can no longer be edited' },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/jobwork/receipts/{id}/post',
  tags: ['Job Receipts'],
  summary: 'Post a draft as it stands — runs every check the draft was allowed to skip',
  request: { params: orgParam.extend({ id: z.string() }) },
  responses: {
    200: { description: 'Received' },
    400: {
      description:
        'Dispositions do not add up, more than the challans have outstanding, or the draft never named its output batches',
    },
    409: { description: 'Not a draft' },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/organizations/{orgId}/jobwork/receipts/{id}',
  tags: ['Job Receipts'],
  summary: 'Delete a DRAFT. A posted receipt is cancelled, never deleted',
  request: { params: orgParam.extend({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted' },
    409: { description: 'Not a draft — cancel it instead' },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/jobwork/receipts/batch-options',
  tags: ['Job Receipts'],
  summary: 'Existing batches the Receive dialog may add to, with their location breakdown',
  request: { params: orgParam, query: batchOptionsQuerySchema },
  responses: { 200: { description: 'Options' }, 404: { description: 'Step or item not found' } },
});

/**
 * The Receive dialog's batch picker. A GET rather than part of `/prefill`
 * because it is asked again on every keystroke of the search and once per
 * returned item, while the prefill describes one moment and is fetched once.
 */
export const getBatchOptions = async (req: Request, res: Response) => {
  const parsed = batchOptionsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('A job order step and an item are required.');
  const { stepId, ...rest } = parsed.data;
  sendSuccess(res, await getOutputBatchOptions(req.tenantId!, { jobOrderStepId: stepId, ...rest }));
};

export const createJobReceipt = async (req: Request, res: Response) => {
  const body = req.body as CreateJobReceiptInput;
  const created = await createNewJobReceipt(
    req.tenantId!,
    body,
    req.user?.id,
    body.saveAsDraft ? 'draft' : 'post',
  );
  sendSuccess(res, created, body.saveAsDraft ? 'Draft saved.' : 'Goods received.', 201);
};

export const updateJobReceipt = async (req: Request, res: Response) => {
  const body = req.body as UpdateJobReceiptInput;
  const updated = await createNewJobReceipt(
    req.tenantId!,
    body,
    req.user?.id,
    body.saveAsDraft ? 'draft' : 'post',
    req.params.id as string,
  );
  sendSuccess(res, updated, body.saveAsDraft ? 'Draft saved.' : 'Goods received.');
};

export const postJobReceipt = async (req: Request, res: Response) => {
  const posted = await postJobReceiptDraft(req.tenantId!, req.params.id as string, req.user?.id);
  sendSuccess(res, posted, 'Goods received.');
};

export const deleteJobReceipt = async (req: Request, res: Response) => {
  await deleteJobReceiptDraft(req.tenantId!, req.params.id as string, req.user?.id);
  sendSuccess(res, null, 'Draft deleted.');
};

export const getJobReceipt = async (req: Request, res: Response) => {
  const found = await getJobReceiptById(req.tenantId!, req.params.id as string);
  if (!found) throw ApiError.notFound('Receipt not found');
  sendSuccess(res, found);
};

export const cancelReceipt = async (req: Request, res: Response) => {
  const { reason } = req.body as CancelJobReceiptInput;
  const updated = await cancelJobReceipt(
    req.tenantId!,
    req.params.id as string,
    reason,
    req.user?.id,
  );
  sendSuccess(res, updated, 'Receipt cancelled.');
};
