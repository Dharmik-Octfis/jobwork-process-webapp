import type { Request, Response } from 'express';
import { assembliesService } from './assemblies.service.js';
import { sendSuccess } from '../../../lib/apiResponse.js';
import { listQuerySchema } from '../../../lib/pagination.js';

export const getAssemblies = async (req: Request, res: Response) => {
  const opts = listQuerySchema.parse(req.query);
  const [results, count] = await Promise.all([
    assembliesService.findManyAssemblies(req.tenantId!, opts),
    req.query.count ? assembliesService.countAssemblies(req.tenantId!, opts) : undefined,
  ]);
  sendSuccess(res, { ...results, count });
};

export const getAssemblyById = async (req: Request, res: Response) => {
  const assembly = await assembliesService.getAssemblyById(req.tenantId!, req.params.id as string);
  sendSuccess(res, assembly);
};

export const createAssembly = async (req: Request, res: Response) => {
  const orgId = req.tenantId!;
  const userId = req.user!.id;
  
  const assembly = await assembliesService.createAssembly(orgId, userId, req.body);
  
  sendSuccess(res, assembly, 'Assembly created successfully', 201);
};

export const getNumberingPreference = async (req: Request, res: Response) => {
  sendSuccess(res, await assembliesService.getNumberPreference(req.tenantId!));
};

export const setNumberingPreference = async (req: Request, res: Response) => {
  const { prefix, nextNumber } = req.body as { prefix: string; nextNumber: number };
  sendSuccess(
    res,
    await assembliesService.updateNumberPreference(req.tenantId!, prefix, nextNumber),
  );
};
