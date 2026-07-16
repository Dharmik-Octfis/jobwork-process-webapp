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
} as const;
