import type { Request, Response } from 'express';
import { ApiError } from '../../../../lib/apiError.ts';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import {
  getCurrencyList,
  createNewCurrency,
  getCurrencyById,
  updateCurrencyById,
  deleteCurrencyById,
} from './currencies.service.ts';
import type { CreateCurrencyInput, UpdateCurrencyInput } from './currencies.schemas.ts';

/**
 * Handlers describe the happy path only — no try/catch anywhere.
 *
 *   route     validates the body (`validateBody`)        → 400 + field details
 *   service   enforces rules and throws `ApiError`       → 404 / 409
 *   handler   sends the success envelope
 *   errorHandler turns any thrown error into a response
 *
 * See CLAUDE.md "API responses — one envelope, one error path".
 */

export const getCurrencies = async (req: Request, res: Response) => {
  const currencies = await getCurrencyList(req.tenantId!);
  sendSuccess(res, currencies);
};

export const createCurrency = async (req: Request, res: Response) => {
  const newCurrency = await createNewCurrency(
    req.tenantId!,
    req.body as CreateCurrencyInput,
    req.user?.id,
  );
  sendSuccess(res, newCurrency, 'Currency created.', 201);
};

export const getCurrency = async (req: Request, res: Response) => {
  const currency = await getCurrencyById(req.tenantId!, req.params.id as string);
  if (!currency) throw ApiError.notFound('Currency not found');
  sendSuccess(res, currency);
};

export const updateCurrency = async (req: Request, res: Response) => {
  const updatedCurrency = await updateCurrencyById(
    req.tenantId!,
    req.params.id as string,
    req.body as UpdateCurrencyInput,
    req.user?.id,
  );
  sendSuccess(res, updatedCurrency, 'Currency updated.');
};

export const deleteCurrency = async (req: Request, res: Response) => {
  await deleteCurrencyById(req.tenantId!, req.params.id as string, req.user?.id);
  sendSuccess(res, null, 'Currency deleted.');
};
