import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../lib/apiError.js';

export function requireOrganization(req: Request, _res: Response, next: NextFunction): void {
  const orgId = req.headers['x-organization-id'];

  if (!orgId || typeof orgId !== 'string') {
    next(new ApiError(400, 'Organization ID is required in headers (x-organization-id).'));
    return;
  }

  next();
}
