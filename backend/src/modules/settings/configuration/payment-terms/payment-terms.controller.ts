import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../../lib/apiError.ts';
import { prisma } from '../../../../db/prisma.ts';
import { createPaymentTermSchema } from './payment-terms.schemas.js';
import { z } from 'zod';

export async function getPaymentTerms(req: Request, res: Response) {
  const orgId = req.params.orgId as string;

  const paymentTerms = await prisma.paymentTerm.findMany({
    where: { organizationId: orgId, isDeleted: false },
    orderBy: { dueAfterDays: 'asc' },
  });

  res.json(paymentTerms);
}

export async function createPaymentTerm(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.params.orgId as string;
    const { id: userId } = req.user!;
    
    const data = createPaymentTermSchema.parse(req.body);

    const existingTerm = await prisma.paymentTerm.findFirst({
      where: {
        organizationId: orgId,
        termName: data.termName,
        isDeleted: false,
      }
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

    res.status(201).json(paymentTerm);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      next(ApiError.badRequest('Validation failed', error.issues));
    } else {
      next(error);
    }
  }
}
