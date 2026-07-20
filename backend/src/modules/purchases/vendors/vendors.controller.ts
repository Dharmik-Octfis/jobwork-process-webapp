import type { Request, Response } from 'express';
import {
  getVendorsList,
  createNewVendor,
  getVendorById,
  updateVendorById,
  deleteVendorById,
  getVendorActivities,
  getVendorComments,
  createVendorComment,
  deleteVendorComment,
} from './vendors.service.ts';
import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';

const vendorAddressSchema = z.object({
  id: z.string().optional(),
  addressType: z.string().min(1),
  attention: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  street1: z.string().nullable().optional(),
  street2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  pinCode: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

const vendorContactPersonSchema = z.object({
  id: z.string().optional(),
  salutation: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  emailAddress: z.string().email().or(z.literal('')).nullable().optional(),
  workPhone: z.string().nullable().optional(),
  mobilePhone: z.string().nullable().optional(),
});

const createVendorSchema = openApiRegistry.register(
  'CreateVendorRequest',
  z.object({
    primaryContactSalutation: z.string().nullable().optional(),
    primaryContactFirstName: z.string().nullable().optional(),
    primaryContactLastName: z.string().nullable().optional(),
    companyName: z.string().nullable().optional(),
    displayName: z.string(),
    vendorNumber: z.string(),
    emailAddress: z.string().email().or(z.literal('')).nullable().optional(),
    workPhone: z.string().or(z.literal('')).nullable().optional(),
    mobilePhone: z.string().or(z.literal('')).nullable().optional(),
    currency: z.string().nullable().optional(),
    paymentTerms: z.string().nullable().optional(),
    status: z.string().optional(),

    addresses: z.array(vendorAddressSchema).optional(),
    contactPersons: z.array(vendorContactPersonSchema).optional(),
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
    404: { description: 'Vendor not found' },
  },
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
    },
  },
  responses: {
    200: { description: 'Vendor updated successfully' },
    400: { description: 'Validation failed' },
    404: { description: 'Vendor not found' },
    409: { description: 'Vendor number already exists' },
  },
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
    404: { description: 'Vendor not found' },
  },
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

    const data = {
      ...parsedData,
    };

    const userId = req.user?.id;
    const newVendor = await createNewVendor(orgId, data, userId);
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
    };

    const userId = req.user?.id;
    const updatedVendor = await updateVendorById(orgId, vendorId, data, userId);
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
    await deleteVendorById(orgId, vendorId, req.user?.id);
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

export const getVendorActivitiesRoute = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const vendorId = req.params.id as string;
    const activities = await getVendorActivities(orgId, vendorId);
    res.json(activities);
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
};

export const getVendorCommentsRoute = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const vendorId = req.params.id as string;
    const comments = await getVendorComments(orgId, vendorId);
    res.json(comments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
};

export const createVendorCommentRoute = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const vendorId = req.params.id as string;
    const content = req.body.content;
    const userId = req.user?.id || null;
    const newComment = await createVendorComment(orgId, vendorId, content, userId);
    res.status(201).json(newComment);
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
};

export const deleteVendorCommentRoute = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const vendorId = req.params.id as string;
    const commentId = req.params.commentId as string;
    await deleteVendorComment(orgId, vendorId, commentId, req.user?.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting comment:', error);
    if (error instanceof Error && error.message === 'Comment not found') {
      res.status(404).json({ error: 'Comment not found' });
    } else {
      res.status(500).json({ error: 'Failed to delete comment' });
    }
  }
};
