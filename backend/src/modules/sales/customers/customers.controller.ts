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
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';

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

export const createCustomerSchema = openApiRegistry.register(
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

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/** Body for the number-sequence preference endpoint. */
export const numberPreferenceSchema = z.object({
  prefix: z.string(),
  nextNumber: z.number().int().positive(),
});
export type NumberPreferenceInput = z.infer<typeof numberPreferenceSchema>;

// Register GET route
openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/sales/customers',
  tags: ['Customers'],
  summary: 'Get all customers (paginated, searchable)',
  request: {
    params: z.object({ orgId: z.string() }),
    query: z.object({
      search: z.string().optional(),
      page: z.string().optional(),
      perPage: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated list of customers: { results, pageContext }',
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
/**
 * Handlers do not catch-and-respond: Express 5 forwards a rejected promise to
 * `errorHandler`, the single place an error becomes a response. What remains is
 * translation only — a known failure becomes an `ApiError` and is rethrown.
 * Mirrors vendors.controller.ts.
 */
export const getCustomers = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  const data = await getCustomersList(req.tenantId!, parsed.data);
  sendSuccess(res, data);
};

export const createCustomer = async (req: Request, res: Response) => {
  const newCustomer = await createNewCustomer(
    req.tenantId!,
    req.body as CreateCustomerInput,
    req.user?.id,
  );
  sendSuccess(res, newCustomer, 'Customer created.', 201);
};

export const getCustomer = async (req: Request, res: Response) => {
  const customer = await getCustomerById(req.tenantId!, req.params.id as string);
  if (!customer) throw new ApiError(404, 'Customer not found');
  sendSuccess(res, customer);
};

export const updateCustomer = async (req: Request, res: Response) => {
  const updatedCustomer = await updateCustomerById(
    req.tenantId!,
    req.params.id as string,
    req.body as CreateCustomerInput,
    req.user?.id,
  );
  sendSuccess(res, updatedCustomer, 'Customer updated.');
};

export const deleteCustomer = async (req: Request, res: Response) => {
  await deleteCustomerById(req.tenantId!, req.params.id as string, req.user?.id);
  // 200 with data:null, not 204 — a 204 carries no body, so it cannot express
  // the standard envelope.
  sendSuccess(res, null, 'Customer deleted.');
};

export const getCustomerActivitiesRoute = async (req: Request, res: Response) => {
  const activities = await getCustomerActivities(req.tenantId!, req.params.id as string);
  sendSuccess(res, activities);
};

export const getCustomerCommentsRoute = async (req: Request, res: Response) => {
  const comments = await getCustomerComments(req.tenantId!, req.params.id as string);
  sendSuccess(res, comments);
};

export const createCustomerCommentRoute = async (req: Request, res: Response) => {
  const newComment = await createCustomerComment(
    req.tenantId!,
    req.params.id as string,
    req.body.content,
    req.user?.id ?? null,
  );
  sendSuccess(res, newComment, 'Comment added.', 201);
};

export const deleteCustomerCommentRoute = async (req: Request, res: Response) => {
  await deleteCustomerComment(
    req.tenantId!,
    req.params.id as string,
    req.params.commentId as string,
    req.user?.id,
  );
  sendSuccess(res, null, 'Comment deleted.');
};

export const getNumberPreferenceRoute = async (req: Request, res: Response) => {
  const pref = await getCustomerNumberPreference(req.tenantId!);
  sendSuccess(res, pref);
};

export const updateNumberPreferenceRoute = async (req: Request, res: Response) => {
  const { prefix, nextNumber } = req.body as NumberPreferenceInput;

  const pref = await updateCustomerNumberPreference(req.tenantId!, prefix, nextNumber);
  sendSuccess(res, pref, 'Number preference updated.');
};
