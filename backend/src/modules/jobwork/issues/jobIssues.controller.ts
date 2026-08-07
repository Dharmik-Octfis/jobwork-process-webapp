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
  getIssuesForStep,
  getJobIssueById,
  getJobIssuesList,
} from './jobIssues.service.ts';
import {
  cancelJobIssueSchema,
  createJobIssueSchema,
  type CancelJobIssueInput,
  type CreateJobIssueInput,
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
        'No stock, ownership mismatch, a second lot on a single-lot process, or past tolerance without a reason',
    },
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
  const created = await createNewJobIssue(
    req.tenantId!,
    req.body as CreateJobIssueInput,
    req.user?.id,
  );
  sendSuccess(res, created, 'Material issued.', 201);
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
