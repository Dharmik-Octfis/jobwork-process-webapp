import type { Request, Response } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';
import * as billService from './bills.service.ts';
import { createBillSchema, updateBillSchema } from './bills.schemas.ts';

export const numberPreferenceSchema = z.object({
  prefix: z.string(),
  nextNumber: z.number().int().positive(),
});
export type NumberPreferenceInput = z.infer<typeof numberPreferenceSchema>;

export const getNumberPreferenceRoute = async (req: Request, res: Response) => {
  const pref = await billService.getBillNumberPreference(req.tenantId!);
  sendSuccess(res, pref);
};

export const updateNumberPreferenceRoute = async (req: Request, res: Response) => {
  const { prefix, nextNumber } = req.body as NumberPreferenceInput;
  const pref = await billService.updateBillNumberPreference(req.tenantId!, prefix, nextNumber);
  sendSuccess(res, pref);
};

export async function getBills(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  const data = await billService.getBillsList(req.tenantId!, parsed.data);
  sendSuccess(res, data);
}

export async function getBillCount(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  const total = await billService.countBills(req.tenantId!, parsed.data);
  sendSuccess(res, { total });
}

export async function getBill(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const item = await billService.getBillById(orgId, req.params.id as string);
  if (!item) throw ApiError.notFound('Bill not found');
  sendSuccess(res, item);
}

export async function createBill(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const data = createBillSchema.parse(req.body);
  const item = await billService.createBill(orgId, req.user!.id, data);
  sendSuccess(res, item, 'Bill created.', 201);
}

export async function updateBill(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const data = updateBillSchema.parse(req.body);
  await billService.updateBill(orgId, req.params.id as string, req.user!.id, data);
  const item = await billService.getBillById(orgId, req.params.id as string);
  sendSuccess(res, item);
}

export async function deleteBill(req: Request, res: Response) {
  const orgId = req.tenantId!;
  await billService.deleteBill(orgId, req.params.id as string);
  sendSuccess(res, null, 'Bill deleted.');
}

export async function uploadAttachments(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    throw ApiError.badRequest('No files provided');
  }

  const { uploadFile } = await import('../../../lib/storage.ts');

  const results = await Promise.all(
    files.map(async (file) => {
      const timestamp = Date.now();
      const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const key = `bills/${orgId}/${timestamp}-${sanitizedName}`;

      await uploadFile({
        key,
        body: file.buffer,
        contentType: file.mimetype,
      });

      return {
        key,
        name: file.originalname,
        size: file.size,
        type: file.mimetype,
      };
    })
  );

  sendSuccess(res, results, 'Attachments uploaded successfully.');
}

export async function getSignedUrl(req: Request, res: Response) {
  const key = req.query.key as string | undefined;
  if (!key) throw ApiError.badRequest('Query parameter "key" is required');

  const organizationId = req.tenantId!;
  if (!key.startsWith(`bills/${organizationId}/`)) {
    throw new ApiError(403, 'Forbidden');
  }

  const { getFileUrl } = await import('../../../lib/storage.ts');
  const url = await getFileUrl(key);
  sendSuccess(res, { url });
}

export async function getBillActivitiesRoute(req: Request, res: Response) {
  const activities = await billService.getBillActivities(req.tenantId!, req.params.id as string);
  sendSuccess(res, activities);
}

export async function getBillCommentsRoute(req: Request, res: Response) {
  const comments = await billService.getBillComments(req.tenantId!, req.params.id as string);
  sendSuccess(res, comments);
}

export async function createBillCommentRoute(req: Request, res: Response) {
  const { content } = req.body as { content: string };
  if (!content || typeof content !== 'string') {
    throw ApiError.badRequest('Comment content is required.');
  }

  const comment = await billService.createBillComment(
    req.tenantId!,
    req.params.id as string,
    content,
    req.user?.id ?? null,
  );
  sendSuccess(res, comment, 'Comment added successfully.', 201);
}

export async function deleteBillCommentRoute(req: Request, res: Response) {
  await billService.deleteBillComment(
    req.tenantId!,
    req.params.id as string,
    req.params.commentId as string,
    req.user?.id,
  );
  sendSuccess(res, null, 'Comment deleted successfully.');
}
