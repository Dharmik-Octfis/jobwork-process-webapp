import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getUomList,
  createNewUom,
  getUomById,
  updateUomById,
  deleteUomById,
} from './uom.service.ts';
import { createUomSchema, updateUomSchema } from './uom.schemas.ts';

export const getUoms = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const uoms = await getUomList(orgId);
    res.json(uoms);
  } catch (error) {
    console.error('Error fetching UOMs:', error);
    res.status(500).json({ error: 'Failed to fetch UOMs' });
  }
};

export const createUom = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const parsedData = createUomSchema.parse(req.body);

    const userId = req.user?.id;
    const newUom = await createNewUom(orgId, parsedData, userId);
    res.status(201).json(newUom);
  } catch (error: unknown) {
    console.error('Error creating UOM:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.issues });
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      res.status(409).json({ error: 'Unit name already exists in this organization.' });
    } else {
      res.status(500).json({ error: `Failed to create UOM: ${String(error)}` });
    }
  }
};

export const getUom = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const id = req.params.id as string;
    const uom = await getUomById(orgId, id);

    if (!uom) {
      return res.status(404).json({ error: 'UOM not found' });
    }

    res.json(uom);
  } catch (error) {
    console.error('Error fetching UOM:', error);
    res.status(500).json({ error: 'Failed to fetch UOM' });
  }
};

export const updateUom = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const id = req.params.id as string;
    const parsedData = updateUomSchema.parse(req.body);

    const userId = req.user?.id;
    const updatedUom = await updateUomById(orgId, id, parsedData, userId);
    res.json(updatedUom);
  } catch (error: unknown) {
    console.error('Error updating UOM:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.issues });
    } else if (error instanceof Error && error.message === 'UOM not found') {
      res.status(404).json({ error: 'UOM not found' });
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      res.status(409).json({ error: 'Unit name already exists in this organization.' });
    } else {
      res.status(500).json({ error: `Failed to update UOM: ${String(error)}` });
    }
  }
};

export const deleteUom = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const id = req.params.id as string;
    await deleteUomById(orgId, id, req.user?.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting UOM:', error);
    if (error instanceof Error && error.message === 'UOM not found') {
      res.status(404).json({ error: 'UOM not found' });
    } else {
      res.status(500).json({ error: 'Failed to delete UOM' });
    }
  }
};
