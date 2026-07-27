import type { Request, Response } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';
import * as purchaseOrderService from './purchase-orders.service.ts';
import { createPurchaseOrderSchema, updatePurchaseOrderSchema } from './purchase-orders.schemas.ts';

export const numberPreferenceSchema = z.object({
  prefix: z.string(),
  nextNumber: z.number().int().positive(),
});
export type NumberPreferenceInput = z.infer<typeof numberPreferenceSchema>;

export const getNumberPreferenceRoute = async (req: Request, res: Response) => {
  const pref = await purchaseOrderService.getPurchaseOrderNumberPreference(req.tenantId!);
  sendSuccess(res, pref);
};

export const updateNumberPreferenceRoute = async (req: Request, res: Response) => {
  const { prefix, nextNumber } = req.body as NumberPreferenceInput;
  const pref = await purchaseOrderService.updatePurchaseOrderNumberPreference(req.tenantId!, prefix, nextNumber);
  sendSuccess(res, pref);
};

export async function getPurchaseOrders(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  const data = await purchaseOrderService.getPurchaseOrdersList(req.tenantId!, parsed.data);
  sendSuccess(res, data);
}

export async function getPurchaseOrderCount(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  const total = await purchaseOrderService.countPurchaseOrders(req.tenantId!, parsed.data);
  sendSuccess(res, { total });
}

export async function getPurchaseOrder(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const item = await purchaseOrderService.getPurchaseOrderById(orgId, req.params.id as string);
  if (!item) throw ApiError.notFound('Purchase Order not found');
  sendSuccess(res, item);
}

export async function createPurchaseOrder(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const data = createPurchaseOrderSchema.parse(req.body);
  const item = await purchaseOrderService.createPurchaseOrder(orgId, req.user!.id, data);
  sendSuccess(res, item, 'Purchase order created.', 201);
}

export async function updatePurchaseOrder(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const data = updatePurchaseOrderSchema.parse(req.body);
  await purchaseOrderService.updatePurchaseOrder(orgId, req.params.id as string, req.user!.id, data);
  const item = await purchaseOrderService.getPurchaseOrderById(orgId, req.params.id as string);
  sendSuccess(res, item);
}

export async function deletePurchaseOrder(req: Request, res: Response) {
  const orgId = req.tenantId!;
  await purchaseOrderService.deletePurchaseOrder(orgId, req.params.id as string);
  sendSuccess(res, null, 'Purchase order deleted.');
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
      const key = `purchase-orders/${orgId}/${timestamp}-${sanitizedName}`;

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
  if (!key.startsWith(`purchase-orders/${organizationId}/`)) {
    throw new ApiError(403, 'Forbidden');
  }

  const { getFileUrl } = await import('../../../lib/storage.ts');
  const url = await getFileUrl(key);
  sendSuccess(res, { url });
}

export async function getPurchaseOrderActivitiesRoute(req: Request, res: Response) {
  const activities = await purchaseOrderService.getPurchaseOrderActivities(req.tenantId!, req.params.id as string);
  sendSuccess(res, activities);
}

export async function getPurchaseOrderCommentsRoute(req: Request, res: Response) {
  const comments = await purchaseOrderService.getPurchaseOrderComments(req.tenantId!, req.params.id as string);
  sendSuccess(res, comments);
}

export async function createPurchaseOrderCommentRoute(req: Request, res: Response) {
  const { content } = req.body as { content: string };
  if (!content || typeof content !== 'string') {
    throw ApiError.badRequest('Comment content is required.');
  }

  const comment = await purchaseOrderService.createPurchaseOrderComment(
    req.tenantId!,
    req.params.id as string,
    content,
    req.user?.id ?? null,
  );
  sendSuccess(res, comment, 'Comment added successfully.', 201);
}

export async function deletePurchaseOrderCommentRoute(req: Request, res: Response) {
  await purchaseOrderService.deletePurchaseOrderComment(
    req.tenantId!,
    req.params.id as string,
    req.params.commentId as string,
    req.user?.id,
  );
  sendSuccess(res, null, 'Comment deleted successfully.');
}
