import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getCurrencyList,
  createNewCurrency,
  getCurrencyById,
  updateCurrencyById,
  deleteCurrencyById,
} from './currencies.service.ts';
import { createCurrencySchema, updateCurrencySchema } from './currencies.schemas.ts';

export const getCurrencies = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const currencies = await getCurrencyList(orgId);
    res.json(currencies);
  } catch (error) {
    console.error('Error fetching Currencies:', error);
    res.status(500).json({ error: 'Failed to fetch Currencies' });
  }
};

export const createCurrency = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const parsedData = createCurrencySchema.parse(req.body);

    const userId = req.user?.id;
    const newCurrency = await createNewCurrency(orgId, parsedData, userId);
    res.status(201).json(newCurrency);
  } catch (error: unknown) {
    console.error('Error creating Currency:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.issues });
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      res.status(409).json({ error: 'Currency code already exists in this organization.' });
    } else {
      res.status(500).json({ error: `Failed to create Currency: ${String(error)}` });
    }
  }
};

export const getCurrency = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const id = req.params.id as string;
    const currency = await getCurrencyById(orgId, id);

    if (!currency) {
      return res.status(404).json({ error: 'Currency not found' });
    }

    res.json(currency);
  } catch (error) {
    console.error('Error fetching Currency:', error);
    res.status(500).json({ error: 'Failed to fetch Currency' });
  }
};

export const updateCurrency = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const id = req.params.id as string;
    const parsedData = updateCurrencySchema.parse(req.body);

    const userId = req.user?.id;
    const updatedCurrency = await updateCurrencyById(orgId, id, parsedData, userId);
    res.json(updatedCurrency);
  } catch (error: unknown) {
    console.error('Error updating Currency:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.issues });
    } else if (error instanceof Error && error.message === 'Currency not found') {
      res.status(404).json({ error: 'Currency not found' });
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      res.status(409).json({ error: 'Currency code already exists in this organization.' });
    } else {
      res.status(500).json({ error: `Failed to update Currency: ${String(error)}` });
    }
  }
};

export const deleteCurrency = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const id = req.params.id as string;
    await deleteCurrencyById(orgId, id, req.user?.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting Currency:', error);
    res.status(500).json({ error: 'Failed to delete Currency' });
  }
};
