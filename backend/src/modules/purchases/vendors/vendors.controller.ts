import type { Request, Response } from 'express';
import { getVendorsList, createNewVendor, getVendorById, updateVendorById, deleteVendorById } from './vendors.service.ts';
import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';

const createVendorSchema = openApiRegistry.register(
  'CreateVendorRequest',
  z.object({
    vendorName: z.string().min(1).openapi({ example: 'Acme Corp' }),
    vendorNumber: z.string().min(1).openapi({ example: 'V-001' }),
    emailAddress: z
      .string()
      .email()
      .optional()
      .or(z.literal(''))
      .openapi({ example: 'contact@acme.com' }),
    phone: z.string().optional().or(z.literal('')).openapi({ example: '+1234567890' }),
    gstTreatment: z.string().min(1).openapi({ example: 'Registered' }),
    sourceOfSupply: z.string().min(1).openapi({ example: 'State' }),
  }),
);

// Register GET route
openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/purchases/vendors',
  tags: ['Vendors'],
  summary: 'Get all vendors',
  request: {
    params: z.object({ orgId: z.string() }),
  },
  responses: {
    200: {
      description: 'List of vendors',
    },
  },
});

// Register POST route
openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/purchases/vendors',
  tags: ['Vendors'],
  summary: 'Create a new vendor',
  request: {
    params: z.object({ orgId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: createVendorSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Vendor created successfully',
    },
    400: {
      description: 'Validation failed',
    },
    409: {
      description: 'Vendor number already exists',
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/purchases/vendors/{id}',
  tags: ['Vendors'],
  summary: 'Get vendor by ID',
  request: {
    params: z.object({ orgId: z.string(), id: z.string() }),
  },
  responses: {
    200: { description: 'Vendor object' },
    404: { description: 'Vendor not found' }
  }
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{orgId}/purchases/vendors/{id}',
  tags: ['Vendors'],
  summary: 'Update an existing vendor',
  request: {
    params: z.object({ orgId: z.string(), id: z.string() }),
    body: {
      content: { 'application/json': { schema: createVendorSchema } },
    }
  },
  responses: {
    200: { description: 'Vendor updated successfully' },
    400: { description: 'Validation failed' },
    404: { description: 'Vendor not found' },
    409: { description: 'Vendor number already exists' }
  }
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/organizations/{orgId}/purchases/vendors/{id}',
  tags: ['Vendors'],
  summary: 'Delete a vendor by ID',
  request: {
    params: z.object({ orgId: z.string(), id: z.string() }),
  },
  responses: {
    204: { description: 'Vendor deleted successfully' },
    404: { description: 'Vendor not found' }
  }
});
export const getVendors = async (req: Request, res: Response) => {
  try {
    // req.tenantId, not the raw header: `tenantContext` has verified membership
    // against the database. The header is a client-supplied claim.
    const orgId = req.tenantId!;
    const vendors = await getVendorsList(orgId);
    res.json(vendors);
  } catch (error) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
};

export const createVendor = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
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
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      res.status(409).json({ error: 'Vendor number already exists in this organization.' });
    } else {
      res.status(500).json({ error: `Failed to create vendor: ${String(error)}` });
    }
  }
};

export const getVendor = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const vendorId = req.params.id as string;
    const vendor = await getVendorById(orgId, vendorId);
    
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    
    res.json(vendor);
  } catch (error) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({ error: 'Failed to fetch vendor' });
  }
};
export const updateVendor = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const vendorId = req.params.id as string;
    const parsedData = createVendorSchema.parse(req.body);

    const data = {
      ...parsedData,
      emailAddress: parsedData.emailAddress || null,
      phone: parsedData.phone || null,
    };

    const updatedVendor = await updateVendorById(orgId, vendorId, data);
    res.json(updatedVendor);
  } catch (error: unknown) {
    console.error('Error updating vendor:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.issues });
    } else if (error instanceof Error && error.message === 'Vendor not found') {
      res.status(404).json({ error: 'Vendor not found' });
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      res.status(409).json({ error: 'Vendor number already exists in this organization.' });
    } else {
      res.status(500).json({ error: `Failed to update vendor: ${String(error)}` });
    }
  }
};

export const deleteVendor = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const vendorId = req.params.id as string;
    await deleteVendorById(orgId, vendorId);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting vendor:', error);
    if (error instanceof Error && error.message === 'Vendor not found') {
      res.status(404).json({ error: 'Vendor not found' });
    } else {
      res.status(500).json({ error: 'Failed to delete vendor' });
    }
  }
};
