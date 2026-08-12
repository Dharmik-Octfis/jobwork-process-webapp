import type { Request, Response } from 'express';
import { sendSuccess } from '../../../../lib/apiResponse.js';
import { ApiError } from '../../../../lib/apiError.js';
import * as locationService from './locations.service.js';
import { createLocationSchema, updateLocationSchema, locationQuerySchema } from './locations.schemas.js';

export async function getLocations(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const { search } = locationQuerySchema.parse(req.query);
  const items = await locationService.getLocations(orgId, search);
  sendSuccess(res, items);
}

export async function getLocation(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const item = await locationService.getLocationById(orgId, req.params.id as string);
  if (!item) throw new ApiError(404, 'Location not found');
  sendSuccess(res, item);
}

export async function createLocation(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const data = createLocationSchema.parse(req.body);
  const item = await locationService.createLocation(orgId, req.user!.id, data);
  sendSuccess(res, item, 'Location created', 201);
}

export async function updateLocation(req: Request, res: Response) {
  const orgId = req.tenantId!;
  const data = updateLocationSchema.parse(req.body);
  await locationService.updateLocation(orgId, req.params.id as string, req.user!.id, data);
  const item = await locationService.getLocationById(orgId, req.params.id as string);
  sendSuccess(res, item);
}

export async function deleteLocation(req: Request, res: Response) {
  const orgId = req.tenantId!;
  await locationService.deleteLocation(orgId, req.params.id as string);
  sendSuccess(res, null, 'Location deleted');
}

export async function markAsPrimary(req: Request, res: Response) {
  const orgId = req.tenantId!;
  await locationService.markLocationAsPrimary(orgId, req.params.id as string, req.user!.id);
  sendSuccess(res, null, 'Location marked as primary');
}
