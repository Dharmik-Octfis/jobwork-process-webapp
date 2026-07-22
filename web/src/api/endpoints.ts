/** Centralized API path constants (relative to `env.apiUrl`). */
export const endpoints = {
  auth: {
    login: '/auth/login',
    signup: '/auth/signup',
    logout: '/auth/logout',
    refresh: '/auth/refresh-token',
    me: '/auth/me',
    forgotPassword: '/auth/forgot-password',
    resetPassword: '/auth/reset-password',
  },
  invitations: {
    /** Public: look up an invite by its raw token (for the accept page). */
    byToken: (token: string) => `/invitations/${encodeURIComponent(token)}`,
    /** Public: accept an invite (optionally authenticated). */
    accept: (token: string) => `/invitations/${encodeURIComponent(token)}/accept`,
    /** Org admin: list/create invitations for an organization. */
    forOrg: (orgId: string) => `/organizations/${orgId}/invitations`,
    /** Org admin: revoke a pending invitation. */
    revoke: (orgId: string, invitationId: string) =>
      `/organizations/${orgId}/invitations/${invitationId}`,
  },
  purchases: {
    /**
     * Tenant-scoped data nests under `/organizations/:orgId/…`, matching the
     * invitations routes above. The server reads `:orgId` and verifies the
     * caller's membership (`tenantContext`) before any handler runs, so passing
     * the id here is not a security decision — forgetting to pass it is a
     * compile error, which is the point.
     */
    vendors: (orgId: string) => `/organizations/${orgId}/purchases/vendors`,
    vendorPreferences: (orgId: string) => `/organizations/${orgId}/purchases/vendors/preferences/number-sequence`,
  },
  seedData: {
    items: (orgId: string) => `/organizations/${orgId}/items`,
  },
} as const;
