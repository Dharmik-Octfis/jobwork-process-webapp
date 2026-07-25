/**
 * Adds `req.user`, `req.tenantId`, and `req.membership` to the Express request
 * (architecture §4).
 *
 * `user` is set by `authenticate` — who you are.
 * `tenantId` and `membership` are set by `tenantContext` — which organization you
 * are acting inside, and with what role. They are only ever populated after a
 * membership has been verified against the database, so a controller reading
 * `req.tenantId` can trust it. Reading the raw `x-organization-id` header
 * instead is how a cross-tenant leak happens: the client chooses that value.
 */
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; sid: string };
      tenantId?: string;
      membership?: {
        /** The org creator. Already folded into `permissions` (an owner resolves
         * to the whole catalog), so routes should NOT branch on this to allow an
         * action — use `requirePermission`. It exists for `requireOwner`, which
         * gates the few actions no permission may grant, and for display. */
        isOwner: boolean;
        permissionTemplateId: string | null;
        /** Permission keys this member holds — from their template, or the whole
         * catalog if they own the org. `requirePermission()` checks this set. */
        permissions: Set<string>;
      };
    }
  }
}

export {};
