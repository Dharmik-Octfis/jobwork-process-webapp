/** Centralized API path constants (relative to `env.apiUrl`). */
export const endpoints = {
  auth: {
    login: '/auth/login',
    signup: '/auth/signup',
    logout: '/auth/logout',
    refresh: '/auth/refresh-token',
    me: '/auth/me',
    avatar: '/auth/me/avatar',
    forgotPassword: '/auth/forgot-password',
    resetPassword: '/auth/reset-password',
    changePassword: '/auth/change-password',
  },
  invitations: {
    /** Public: look up an invite by its raw token (for the accept page). */
    byToken: (token: string) => `/invitations/${encodeURIComponent(token)}`,
    /** Public: accept an invite (optionally authenticated). */
    accept: (token: string) => `/invitations/${encodeURIComponent(token)}/accept`,
    /** Public: decline an invite — the token is the credential, no session needed. */
    decline: (token: string) => `/invitations/${encodeURIComponent(token)}/decline`,
    /**
     * The signed-in user's own invitation inbox. Addressed by invitation **id**,
     * not by token — the emailed token is unrecoverable (only its hash is stored),
     * so these routes authorize by session + email match instead. This is what
     * answers "I lost the invitation email".
     */
    mine: '/me/invitations',
    acceptMine: (invitationId: string) => `/me/invitations/${invitationId}/accept`,
    declineMine: (invitationId: string) => `/me/invitations/${invitationId}/decline`,
    /** Org admin: list/create invitations for an organization. */
    forOrg: (orgId: string) => `/organizations/${orgId}/invitations`,
    /** Org admin: revoke a pending invitation. */
    revoke: (orgId: string, invitationId: string) =>
      `/organizations/${orgId}/invitations/${invitationId}`,
  },
  /**
   * Roles = job titles. They carry NO permissions — a role grants nothing, and
   * nothing on the server reads one. What a member may DO comes from their
   * permission template below. A membership points at one of each, independently.
   */
  roles: {
    forOrg: (orgId: string) => `/organizations/${orgId}/roles`,
    byId: (orgId: string, id: string) => `/organizations/${orgId}/roles/${id}`,
  },
  /** Permission templates = the access bundles. An org starts with only "Owner";
   * the owner creates the rest before anyone can be invited. */
  permissionTemplates: {
    forOrg: (orgId: string) => `/organizations/${orgId}/permission-templates`,
    byId: (orgId: string, id: string) => `/organizations/${orgId}/permission-templates/${id}`,
    /** The permission vocabulary the role editor renders as checkboxes. */
    catalog: (orgId: string) => `/organizations/${orgId}/permission-templates/catalog`,
  },
  members: {
    forOrg: (orgId: string) => `/organizations/${orgId}/members`,
    /** PUT to change a member's role; DELETE to remove them. `id` is a membership id. */
    byId: (orgId: string, membershipId: string) =>
      `/organizations/${orgId}/members/${membershipId}`,
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
    vendorPreferences: (orgId: string) =>
      `/organizations/${orgId}/purchases/vendors/preferences/number-sequence`,
    purchaseOrders: (orgId: string) => `/organizations/${orgId}/purchases/purchase-orders`,
    purchaseOrderPreferences: (orgId: string) =>
      `/organizations/${orgId}/purchases/purchase-orders/preferences/number-sequence`,
  },
  sales: {
    customers: (orgId: string) => `/organizations/${orgId}/sales/customers`,
    customerPreferences: (orgId: string) =>
      `/organizations/${orgId}/sales/customers/preferences/number-sequence`,
  },
  configuration: {
    locations: (orgId: string) => `/organizations/${orgId}/configuration/locations`,
    paymentTerms: (orgId: string) => `/organizations/${orgId}/configuration/payment-terms`,
    taxes: (orgId: string) => `/organizations/${orgId}/configuration/taxes`,
    accounts: (orgId: string) => `/organizations/${orgId}/configuration/accounts`,
  },
  seedData: {
    items: (orgId: string) => `/organizations/${orgId}/items`,
  },
  /** Per-user list column layout ("Customize Columns") for one module. */
  listViews: (orgId: string, entityType: string) =>
    `/organizations/${orgId}/list-views/${entityType}`,
} as const;
