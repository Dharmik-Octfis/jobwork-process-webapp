import type { Request, Response } from 'express';
import {
  getVendorsList,
  countVendors,
  createNewVendor,
  getVendorById,
  updateVendorById,
  deleteVendorById,
  getVendorActivities,
  getVendorComments,
  createVendorComment,
  deleteVendorComment,
  getVendorNumberPreference,
  updateVendorNumberPreference,
} from './vendors.service.ts';
import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { sendSuccess } from '../../../lib/apiResponse.ts';
import { listQuerySchema } from '../../../lib/pagination.ts';

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
  email: z.string().email().or(z.literal('')).nullable().optional(),
  phone: z.string().nullable().optional(),
  mobile: z.string().nullable().optional(),
});

export const createVendorSchema = openApiRegistry.register(
  'CreateVendorRequest',
  z.object({
    primaryContactSalutation: z.string().nullable().optional(),
    primaryContactFirstName: z.string().nullable().optional(),
    primaryContactLastName: z.string().nullable().optional(),
    companyName: z.string().nullable().optional(),
    contactName: z.string(),
    contactNumber: z.string(),
    email: z.string().email().or(z.literal('')).nullable().optional(),
    phone: z.string().or(z.literal('')).nullable().optional(),
    mobile: z.string().or(z.literal('')).nullable().optional(),
    currency: z.string().nullable().optional(),
    paymentTerms: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),

    status: z.string().optional(),

    // Per-org dynamic custom fields — validated against this org's definitions in
    // the service (customFields.engine.ts), so the shape is intentionally open here.
    customFields: z.record(z.string(), z.unknown()).optional(),

    addresses: z.array(vendorAddressSchema).optional(),
    contactPersons: z.array(vendorContactPersonSchema).optional(),
  }),
);

export type CreateVendorInput = z.infer<typeof createVendorSchema>;

/** Body for the number-sequence preference endpoint. */
export const numberPreferenceSchema = z.object({
  prefix: z.string(),
  nextNumber: z.number().int().positive(),
});
export type NumberPreferenceInput = z.infer<typeof numberPreferenceSchema>;

// Register GET route
openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/purchases/vendors',
  tags: ['Vendors'],
  summary: 'Get all vendors (paginated, searchable)',
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
      description: 'Paginated list of vendors: { results, pageContext }',
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

// Register preferences routes
openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/purchases/vendors/preferences/number-sequence',
  tags: ['Vendors'],
  summary: 'Get vendor number sequence preferences',
  request: { params: z.object({ orgId: z.string() }) },
  responses: { 200: { description: 'Number sequence preferences' } },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{orgId}/purchases/vendors/preferences/number-sequence',
  tags: ['Vendors'],
  summary: 'Update vendor number sequence preferences',
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
  path: '/organizations/{orgId}/purchases/vendors/preferences/number-sequence',
  tags: ['Vendors'],
  summary: 'Get vendor number sequence preferences',
  request: { params: z.object({ orgId: z.string() }) },
  responses: { 200: { description: 'Number sequence preferences' } },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{orgId}/purchases/vendors/preferences/number-sequence',
  tags: ['Vendors'],
  summary: 'Update vendor number sequence preferences',
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
 *
 * The previous catches returned `Failed to update vendor: ${String(error)}` to
 * the client, which can leak a connection string or file path. errorHandler logs
 * the real error server-side and returns a flat message.
 */
export const getVendors = async (req: Request, res: Response) => {
  // req.tenantId, not the raw header: `tenantContext` has verified membership
  // against the database. The header is a client-supplied claim.
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  const data = await getVendorsList(req.tenantId!, parsed.data);
  sendSuccess(res, data);
};

/** Total matching vendors — the "Total count: view" link. Same query params as
 * the list so the number always describes the rows on screen. */
export const getVendorCount = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Invalid search parameters.');
  const total = await countVendors(req.tenantId!, parsed.data);
  sendSuccess(res, { total });
};

export const createVendor = async (req: Request, res: Response) => {
  const newVendor = await createNewVendor(
    req.tenantId!,
    req.body as CreateVendorInput,
    req.user?.id,
  );
  sendSuccess(res, newVendor, 'Vendor created.', 201);
};

export const getVendor = async (req: Request, res: Response) => {
  const vendor = await getVendorById(req.tenantId!, req.params.id as string);
  if (!vendor) throw new ApiError(404, 'Vendor not found');
  sendSuccess(res, vendor);
};

export const updateVendor = async (req: Request, res: Response) => {
  const updatedVendor = await updateVendorById(
    req.tenantId!,
    req.params.id as string,
    req.body as CreateVendorInput,
    req.user?.id,
  );
  sendSuccess(res, updatedVendor, 'Vendor updated.');
};

export const deleteVendor = async (req: Request, res: Response) => {
  await deleteVendorById(req.tenantId!, req.params.id as string, req.user?.id);
  // 200 with data:null, not 204 — a 204 carries no body, so it cannot express
  // the standard envelope.
  sendSuccess(res, null, 'Vendor deleted.');
};

export const getVendorActivitiesRoute = async (req: Request, res: Response) => {
  const activities = await getVendorActivities(req.tenantId!, req.params.id as string);
  sendSuccess(res, activities);
};

export const getVendorCommentsRoute = async (req: Request, res: Response) => {
  const comments = await getVendorComments(req.tenantId!, req.params.id as string);
  sendSuccess(res, comments);
};

export const createVendorCommentRoute = async (req: Request, res: Response) => {
  const newComment = await createVendorComment(
    req.tenantId!,
    req.params.id as string,
    req.body.content,
    req.user?.id ?? null,
  );
  sendSuccess(res, newComment, 'Comment added.', 201);
};

export const deleteVendorCommentRoute = async (req: Request, res: Response) => {
  await deleteVendorComment(
    req.tenantId!,
    req.params.id as string,
    req.params.commentId as string,
    req.user?.id,
  );
  sendSuccess(res, null, 'Comment deleted.');
};

export const getNumberPreferenceRoute = async (req: Request, res: Response) => {
  const pref = await getVendorNumberPreference(req.tenantId!);
  sendSuccess(res, pref);
};

export const updateNumberPreferenceRoute = async (req: Request, res: Response) => {
  const { prefix, nextNumber } = req.body as NumberPreferenceInput;

  const pref = await updateVendorNumberPreference(req.tenantId!, prefix, nextNumber);
  sendSuccess(res, pref, 'Number preference updated.');
};
