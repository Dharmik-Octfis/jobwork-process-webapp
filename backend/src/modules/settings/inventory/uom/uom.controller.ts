import type { Request, Response } from 'express';
import { ApiError } from '../../../../lib/apiError.ts';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import {
  getUomList,
  createNewUom,
  getUomById,
  updateUomById,
  deleteUomById,
} from './uom.service.ts';
import type { CreateUomInput, UpdateUomInput } from './uom.schemas.ts';

/**
 * Happy path only — no try/catch. The route validates the body, the service
 * throws `ApiError` (404 / 409), and `errorHandler` formats whatever is thrown.
 * See CLAUDE.md "API responses — one envelope, one error path".
 */

export const getUoms = async (req: Request, res: Response) => {
  sendSuccess(res, await getUomList(req.tenantId!));
};

export const createUom = async (req: Request, res: Response) => {
  const newUom = await createNewUom(req.tenantId!, req.body as CreateUomInput, req.user?.id);
  sendSuccess(res, newUom, 'Unit created.', 201);
};

export const getUom = async (req: Request, res: Response) => {
  const uom = await getUomById(req.tenantId!, req.params.id as string);
  if (!uom) throw ApiError.notFound('UOM not found');
  sendSuccess(res, uom);
};

export const updateUom = async (req: Request, res: Response) => {
  const updatedUom = await updateUomById(
    req.tenantId!,
    req.params.id as string,
    req.body as UpdateUomInput,
    req.user?.id,
  );
  sendSuccess(res, updatedUom, 'Unit updated.');
};

export const deleteUom = async (req: Request, res: Response) => {
  await deleteUomById(req.tenantId!, req.params.id as string, req.user?.id);
  sendSuccess(res, null, 'Unit deleted.');
};
