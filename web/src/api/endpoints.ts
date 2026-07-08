/** Centralized API path constants (relative to `env.apiUrl`). */
export const endpoints = {
  auth: {
    login: '/auth/login',
    signup: '/auth/signup',
    logout: '/auth/logout',
    me: '/auth/me',
  },
} as const;
