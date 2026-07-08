/** Roles per tenant (architecture §3.9). */
export type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

/** Current authenticated user (mirrors the backend auth DTO). */
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenantId: string;
}
