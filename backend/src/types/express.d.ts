/**
 * Adds `req.user` to the Express request (architecture §4). `tenantId` joins it
 * once organizations and memberships exist.
 */
declare global {
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}

export {};
