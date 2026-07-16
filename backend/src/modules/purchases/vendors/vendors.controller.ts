import type { Request, Response } from 'express';
import { getVendorsList, createNewVendor } from './vendors.service.ts';
import { z } from 'zod';

const createVendorSchema = z.object({
  vendorName: z.string().min(1),
  vendorNumber: z.string().min(1),
  emailAddress: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  gstTreatment: z.string().min(1),
  sourceOfSupply: z.string().min(1),
});

export const getVendors = async (req: Request, res: Response) => {
  try {
    const orgId = req.headers['x-organization-id'] as string;
    const vendors = await getVendorsList(orgId);
    res.json(vendors);
  } catch (error) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
};

export const createVendor = async (req: Request, res: Response) => {
  try {
    const orgId = req.headers['x-organization-id'] as string;
    const parsedData = createVendorSchema.parse(req.body);
    
    // Convert empty strings to null for optional fields
    const data = {
      ...parsedData,
      emailAddress: parsedData.emailAddress || null,
      phone: parsedData.phone || null,
    };

    const newVendor = await createNewVendor(orgId, data);
    res.status(201).json(newVendor);
  } catch (error: unknown) {
    console.error('Error creating vendor:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.issues });
    } else if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      res.status(409).json({ error: 'Vendor number already exists in this organization.' });
    } else {
      res.status(500).json({ error: `Failed to create vendor: ${String(error)}` });
    }
  }
};
