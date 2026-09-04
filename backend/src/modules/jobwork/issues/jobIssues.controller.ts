import type { Request, Response } from 'express';
import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';
import {
  cancelJobIssue,
  countJobIssues,
  createNewJobIssue,
  deleteJobIssueDraft,
  getIssuesForStep,
  getJobIssueById,
  getJobIssuesList,
  postJobIssueDraft,
} from './jobIssues.service.ts';
import {
  cancelJobIssueSchema,
  createJobIssueSchema,
  updateJobIssueSchema,
  type CancelJobIssueInput,
  type CreateJobIssueInput,
  type UpdateJobIssueInput,
} from './jobIssues.schemas.ts';

const orgParam = z.object({ orgId: z.string() });

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/jobwork/issues',
  tags: ['Job Issues'],
  summary: 'List challans out (paginated, searchable)',
  request: {
    params: orgParam,
    query: z.object({
      search: z.string().optional(),
      filter: z.string().optional(),
      page: z.string().optional(),
      perPage: z.string().optional(),
      stepId: z.string().optional(),
    }),
  },
  responses: { 200: { description: 'Paginated issues: { results, pageContext }' } },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/jobwork/issues',
  tags: ['Job Issues'],
  summary: 'Issue material to a processor and post the stock movement',
  request: {
    params: orgParam,
    body: { content: { 'application/json': { schema: createJobIssueSchema } } },
  },
  responses: {
    201: { description: 'Issued' },
    400: {
      description:
        'No stock, ownership mismatch, a second batch on a single-batch process, or past tolerance without a reason',
    },
  },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{orgId}/jobwork/issues/{id}',
  tags: ['Job Issues'],
  summary: 'Rewrite a DRAFT challan — and optionally issue it. Refused once issued',
  request: {
    params: orgParam.extend({ id: z.string() }),
    body: { content: { 'application/json': { schema: updateJobIssueSchema } } },
  },
  responses: {
    200: { description: 'Saved' },
    409: { description: 'Already issued, so it can no longer be edited' },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/jobwork/issues/{id}/post',
  tags: ['Job Issues'],
  summary: 'Issue a draft as it stands — runs every check the draft was allowed to skip',
  request: { params: orgParam.extend({ id: z.string() }) },
  responses: {
    200: { description: 'Issued' },
    400: { description: 'No stock, past tolerance, or the previous step has returned nothing' },
    409: { description: 'Not a draft' },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/organizations/{orgId}/jobwork/issues/{id}',
  tags: ['Job Issues'],
  summary: 'Delete a DRAFT. A posted challan is cancelled, never deleted',
  request: { params: orgParam.extend({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted' },
    409: { description: 'Not a draft — cancel it instead' },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/jobwork/issues/{id}/cancel',
  tags: ['Job Issues'],
  summary: 'Cancel a challan — posts reversing ledger rows, deletes nothing',
  request: {
    params: orgParam.extend({ id: z.string() }),
    body: { content: { 'application/json': { schema: cancelJobIssueSchema } } },
  },
  responses: {
    200: { description: 'Cancelled' },
    409: { description: 'Already cancelled, or goods have already been received against it' },
  },
});

export const getJobIssues = async (req: Request, res: Response) => {
  // `?stepId=` is the Overview page's "2 issues" link: every challan against one
  // step, unpaginated, because a step has a handful and they are read together.
  const stepId = req.query.stepId;
  if (typeof stepId === 'string' && stepId) {
    sendSuccess(res, await getIssuesForStep(req.tenantId!, stepId));
    return;
  }

  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, await getJobIssuesList(req.tenantId!, parsed.data));
};

export const getJobIssueCount = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  sendSuccess(res, { total: await countJobIssues(req.tenantId!, parsed.data) });
};

export const createJobIssue = async (req: Request, res: Response) => {
  const body = req.body as CreateJobIssueInput;
  const created = await createNewJobIssue(
    req.tenantId!,
    body,
    req.user?.id,
    body.saveAsDraft ? 'draft' : 'post',
  );
  sendSuccess(res, created, body.saveAsDraft ? 'Draft saved.' : 'Success', 201);
};

export const updateJobIssue = async (req: Request, res: Response) => {
  const body = req.body as UpdateJobIssueInput;
  const updated = await createNewJobIssue(
    req.tenantId!,
    body,
    req.user?.id,
    body.saveAsDraft ? 'draft' : 'post',
    req.params.id as string,
  );
  sendSuccess(res, updated, body.saveAsDraft ? 'Draft saved.' : 'Challan issued.');
};

export const postJobIssue = async (req: Request, res: Response) => {
  const posted = await postJobIssueDraft(req.tenantId!, req.params.id as string, req.user?.id);
  sendSuccess(res, posted, 'Challan issued.');
};

export const deleteJobIssue = async (req: Request, res: Response) => {
  await deleteJobIssueDraft(req.tenantId!, req.params.id as string, req.user?.id);
  sendSuccess(res, null, 'Draft deleted.');
};

export const getJobIssue = async (req: Request, res: Response) => {
  const found = await getJobIssueById(req.tenantId!, req.params.id as string);
  if (!found) throw ApiError.notFound('Challan not found');
  sendSuccess(res, found);
};

export const cancelIssue = async (req: Request, res: Response) => {
  const { reason } = req.body as CancelJobIssueInput;
  const updated = await cancelJobIssue(
    req.tenantId!,
    req.params.id as string,
    reason,
    req.user?.id,
  );
  sendSuccess(res, updated, 'Challan cancelled.');
};
