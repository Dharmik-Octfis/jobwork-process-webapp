import type { Request, Response } from 'express';
import {
  getCustomersList,
  createNewCustomer,
  getCustomerById,
  updateCustomerById,
  deleteCustomerById,
  getCustomerActivities,
  getCustomerComments,
  createCustomerComment,
  deleteCustomerComment,
  getCustomerNumberPreference,
  updateCustomerNumberPreference,
} from './customers.service.ts';
import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { ApiError } from '../../../lib/apiError.ts';

const customerAddressSchema = z.object({
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

const customerContactPersonSchema = z.object({
  id: z.string().optional(),
  salutation: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  emailAddress: z.string().email().or(z.literal('')).nullable().optional(),
  workPhone: z.string().nullable().optional(),
  mobilePhone: z.string().nullable().optional(),
});

const createCustomerSchema = openApiRegistry.register(
  'CreateCustomerRequest',
  z.object({
    customerType: z.enum(['business', 'individual']).optional().default('business'),
    primaryContactSalutation: z.string().nullable().optional(),
    primaryContactFirstName: z.string().nullable().optional(),
    primaryContactLastName: z.string().nullable().optional(),
    companyName: z.string().nullable().optional(),
    displayName: z.string(),
    customerNumber: z.string(),
    emailAddress: z.string().email().or(z.literal('')).nullable().optional(),
    workPhone: z.string().or(z.literal('')).nullable().optional(),
    mobilePhone: z.string().or(z.literal('')).nullable().optional(),
    currency: z.string().nullable().optional(),
    paymentTerms: z.string().nullable().optional(),
    remarks: z.string().nullable().optional(),

    status: z.string().optional(),

    // Per-org dynamic custom fields — validated against this org's definitions in
    // the service (customFields.engine.ts), so the shape is intentionally open here.
    customFields: z.record(z.string(), z.unknown()).optional(),

    addresses: z.array(customerAddressSchema).optional(),
    contactPersons: z.array(customerContactPersonSchema).optional(),
  }),
);

// Register GET route
openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/sales/customers',
  tags: ['Customers'],
  summary: 'Get all customers',
  request: {
    params: z.object({ orgId: z.string() }),
  },
  responses: {
    200: {
      description: 'List of customers',
    },
  },
});

// Register POST route
openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/sales/customers',
  tags: ['Customers'],
  summary: 'Create a new customer',
  request: {
    params: z.object({ orgId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: createCustomerSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Customer created successfully',
    },
    400: {
      description: 'Validation failed',
    },
    409: {
      description: 'Customer number already exists',
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/sales/customers/{id}',
  tags: ['Customers'],
  summary: 'Get customer by ID',
  request: {
    params: z.object({ orgId: z.string(), id: z.string() }),
  },
  responses: {
    200: { description: 'Customer object' },
    404: { description: 'Customer not found' },
  },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{orgId}/sales/customers/{id}',
  tags: ['Customers'],
  summary: 'Update an existing customer',
  request: {
    params: z.object({ orgId: z.string(), id: z.string() }),
    body: {
      content: { 'application/json': { schema: createCustomerSchema } },
    },
  },
  responses: {
    200: { description: 'Customer updated successfully' },
    400: { description: 'Validation failed' },
    404: { description: 'Customer not found' },
    409: { description: 'Customer number already exists' },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/organizations/{orgId}/sales/customers/{id}',
  tags: ['Customers'],
  summary: 'Delete a customer by ID',
  request: {
    params: z.object({ orgId: z.string(), id: z.string() }),
  },
  responses: {
    204: { description: 'Customer deleted successfully' },
    404: { description: 'Customer not found' },
  },
});

// Register preferences routes
openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/sales/customers/preferences/number-sequence',
  tags: ['Customers'],
  summary: 'Get customer number sequence preferences',
  request: { params: z.object({ orgId: z.string() }) },
  responses: { 200: { description: 'Number sequence preferences' } },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{orgId}/sales/customers/preferences/number-sequence',
  tags: ['Customers'],
  summary: 'Update customer number sequence preferences',
  request: {
    params: z.object({ orgId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ prefix: z.string(), nextNumber: z.number().int().positive() }),
        },
      },
    },
  },
  responses: { 200: { description: 'Updated number sequence preferences' } },
});

// Register preferences routes
openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/sales/customers/preferences/number-sequence',
  tags: ['Customers'],
  summary: 'Get customer number sequence preferences',
  request: { params: z.object({ orgId: z.string() }) },
  responses: { 200: { description: 'Number sequence preferences' } },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{orgId}/sales/customers/preferences/number-sequence',
  tags: ['Customers'],
  summary: 'Update customer number sequence preferences',
  request: {
    params: z.object({ orgId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ prefix: z.string(), nextNumber: z.number().int().positive() }),
        },
      },
    },
  },
  responses: { 200: { description: 'Updated number sequence preferences' } },
});
export const getCustomers = async (req: Request, res: Response) => {
  try {
    // req.tenantId, not the raw header: `tenantContext` has verified membership
    // against the database. The header is a client-supplied claim.
    const orgId = req.tenantId!;
    const customers = await getCustomersList(orgId);
    res.json(customers);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
};

export const createCustomer = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const parsedData = createCustomerSchema.parse(req.body);

    const data = {
      ...parsedData,
    };

    const userId = req.user?.id;
    const newCustomer = await createNewCustomer(orgId, data, userId);
    res.status(201).json(newCustomer);
  } catch (error: unknown) {
    console.error('Error creating customer:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.issues });
    } else if (error instanceof ApiError) {
      // e.g. custom-field validation from the service — keep status + field details.
      res
        .status(error.status)
        .json({ error: error.message, message: error.message, details: error.details });
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      res.status(409).json({ error: 'Customer number already exists in this organization.' });
    } else {
      res.status(500).json({ error: `Failed to create customer: ${String(error)}` });
    }
  }
};

export const getCustomer = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const customerId = req.params.id as string;
    const customer = await getCustomerById(orgId, customerId);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(customer);
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
};
export const updateCustomer = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const customerId = req.params.id as string;
    const parsedData = createCustomerSchema.parse(req.body);

    const data = {
      ...parsedData,
    };

    const userId = req.user?.id;
    const updatedCustomer = await updateCustomerById(orgId, customerId, data, userId);
    res.json(updatedCustomer);
  } catch (error: unknown) {
    console.error('Error updating customer:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.issues });
    } else if (error instanceof ApiError) {
      res
        .status(error.status)
        .json({ error: error.message, message: error.message, details: error.details });
    } else if (error instanceof Error && error.message === 'Customer not found') {
      res.status(404).json({ error: 'Customer not found' });
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      res.status(409).json({ error: 'Customer number already exists in this organization.' });
    } else {
      res.status(500).json({ error: `Failed to update customer: ${String(error)}` });
    }
  }
};

export const deleteCustomer = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const customerId = req.params.id as string;
    await deleteCustomerById(orgId, customerId, req.user?.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting customer:', error);
    if (error instanceof Error && error.message === 'Customer not found') {
      res.status(404).json({ error: 'Customer not found' });
    } else {
      res.status(500).json({ error: 'Failed to delete customer' });
    }
  }
};

export const getCustomerActivitiesRoute = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const customerId = req.params.id as string;
    const activities = await getCustomerActivities(orgId, customerId);
    res.json(activities);
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
};

export const getCustomerCommentsRoute = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const customerId = req.params.id as string;
    const comments = await getCustomerComments(orgId, customerId);
    res.json(comments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
};

export const createCustomerCommentRoute = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const customerId = req.params.id as string;
    const content = req.body.content;
    const userId = req.user?.id || null;
    const newComment = await createCustomerComment(orgId, customerId, content, userId);
    res.status(201).json(newComment);
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
};

export const deleteCustomerCommentRoute = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const customerId = req.params.id as string;
    const commentId = req.params.commentId as string;
    await deleteCustomerComment(orgId, customerId, commentId, req.user?.id);
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

export const getNumberPreferenceRoute = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const pref = await getCustomerNumberPreference(orgId);
    res.json(pref);
  } catch (error) {
    console.error('Error fetching number preference:', error);
    res.status(500).json({ error: 'Failed to fetch number preference' });
  }
};

export const updateNumberPreferenceRoute = async (req: Request, res: Response) => {
  try {
    const orgId = req.tenantId!;
    const { prefix, nextNumber } = z
      .object({
        prefix: z.string(),
        nextNumber: z.number().int().positive(),
      })
      .parse(req.body);

    const pref = await updateCustomerNumberPreference(orgId, prefix, nextNumber);
    res.json(pref);
  } catch (error) {
    console.error('Error updating number preference:', error);
    res.status(500).json({ error: 'Failed to update number preference' });
  }
};
