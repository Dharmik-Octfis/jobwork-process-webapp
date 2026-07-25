/** Shape returned to clients for a role (a job title). */
export interface PublicRole {
  id: string;
  name: string;
  description: string | null;
  /** The seeded "Owner" role. Cannot be edited, deleted, or assigned by invite. */
  isSystem: boolean;
  /** How many memberships currently carry this title — lets the UI say why a role
   * can't be deleted, and spot titles nobody uses. */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}
