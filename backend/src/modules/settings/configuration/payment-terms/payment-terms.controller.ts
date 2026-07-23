import type { Request, Response } from 'express';
import { ApiError } from '../../../../lib/apiError.ts';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import { prisma } from '../../../../db/prisma.ts';
import type { CreatePaymentTermInput } from './payment-terms.schemas.js';

/**
 * Happy path only — no try/catch. The route validates the body and
 * `errorHandler` formats anything thrown. See CLAUDE.md "API responses".
 *
 * `req.tenantId`, not `req.params.orgId`: only tenantContext's copy has been
 * membership-checked.
 */

export async function getPaymentTerms(req: Request, res: Response) {
  const paymentTerms = await prisma.paymentTerm.findMany({
    where: { organizationId: req.tenantId!, isDeleted: false },
    orderBy: { dueAfterDays: 'asc' },
  });

  sendSuccess(res, paymentTerms);
}

export async function createPaymentTerm(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const { id: userId } = req.user!;
  const data = req.body as CreatePaymentTermInput;

  const existingTerm = await prisma.paymentTerm.findFirst({
    where: { organizationId: orgId, termName: data.termName, isDeleted: false },
  });

  if (existingTerm) {
    throw ApiError.conflict('A payment term with this name already exists');
  }

  const paymentTerm = await prisma.paymentTerm.create({
    data: {
      organizationId: orgId,
      termName: data.termName,
      dueAfterDays: data.dueAfterDays,
      createdBy: userId,
      updatedBy: userId,
    },
  });

  sendSuccess(res, paymentTerm, 'Payment term created.', 201);
}
