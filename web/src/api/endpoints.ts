/** Centralized API path constants (relative to `env.apiUrl`). */
export const endpoints = {
  auth: {
    login: '/auth/login',
    signup: '/auth/signup',
    logout: '/auth/logout',
    refresh: '/auth/refresh-token',
    me: '/auth/me',
    location: '/auth/me/location',
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
    /** `?search=…&filter=…&page=…&perPage=…` → `{ results, pageContext }`. */
    forOrg: (orgId: string) => `/organizations/${orgId}/permission-templates`,
    /** Opt-in total behind the "Total count: view" link, same as every other list. */
    count: (orgId: string) => `/organizations/${orgId}/permission-templates/count`,
    byId: (orgId: string, id: string) => `/organizations/${orgId}/permission-templates/${id}`,
    /** The permission vocabulary the role editor renders as checkboxes. */
    catalog: (orgId: string) => `/organizations/${orgId}/permission-templates/catalog`,
  },
  /**
   * Settings → **Users**. The path stays `/members` on purpose: the screen was
   * renamed, the API was not, and changing it would break every existing client
   * for a label.
   */
  members: {
    /** `?status=active|inactive|unconfirmed|all&search=…` — one list containing
     * joined members AND unaccepted invitations. */
    forOrg: (orgId: string) => `/organizations/${orgId}/members`,
    /** Opt-in total behind the "Total count: view" link, same as every other list. */
    count: (orgId: string) => `/organizations/${orgId}/members/count`,
    /** GET the detail pane; PUT to change profile/role/access/active state;
     * DELETE to remove them. `id` is a membership id, not a user id. */
    byId: (orgId: string, membershipId: string) =>
      `/organizations/${orgId}/members/${membershipId}`,
    /**
     * Your OWN record in this organization — a different route, not a convenience
     * alias. It needs no `member:update` permission (nobody should need permission
     * to fix their own name), and in exchange it cannot change role, permissions or
     * active state. Editing your name here does NOT change it in any other
     * organization, nor your account name.
     */
    me: (orgId: string) => `/organizations/${orgId}/members/me`,
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
  /**
   * Jobwork. `stock_ledger` has no HTTP surface at all, deliberately: it is
   * plumbing behind one backend service, and a route onto it would be a way to
   * write stock history from outside the documents that caused it.
   */
  jobwork: {
    processes: (orgId: string) => `/organizations/${orgId}/jobwork/processes`,
    routes: (orgId: string) => `/organizations/${orgId}/jobwork/routes`,
    jobOrders: (orgId: string) => `/organizations/${orgId}/jobwork/job-orders`,
    /** The prefix + next number new job orders are numbered from. */
    jobOrderPreferences: (orgId: string) =>
      `/organizations/${orgId}/jobwork/job-orders/preferences/number-sequence`,
    /** The stepper page — one request, so every tile describes the same moment. */
    jobOrderOverview: (orgId: string, id: string) =>
      `/organizations/${orgId}/jobwork/job-orders/${id}/overview`,
    issues: (orgId: string) => `/organizations/${orgId}/jobwork/issues`,
    receipts: (orgId: string) => `/organizations/${orgId}/jobwork/receipts`,
    /** The Receive dialog's opening state: mode, open challans, per-taka rows. */
    receiptPrefill: (orgId: string) => `/organizations/${orgId}/jobwork/receipts/prefill`,
    rejectionReasons: (orgId: string) => `/organizations/${orgId}/jobwork/rejection-reasons`,
  },
  /**
   * Lots — READ ONLY. There is no create/update/delete path here because a lot is
   * born from the document that physically brought material in, never a form.
   */
  inventory: {
    lots: (orgId: string) => `/organizations/${orgId}/inventory/lots`,
    /** 🔴 The picker's query. Reads the LEDGER, not the lots table — a lot row
     * outlives its last metre. */
    availableLots: (orgId: string) => `/organizations/${orgId}/inventory/lots/available`,
    /** Locations that actually hold an item, with balances. Also a ledger query:
     * offering a godown with no stock is how users get stuck. */
    stockLocations: (orgId: string) => `/organizations/${orgId}/inventory/lots/locations`,
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
