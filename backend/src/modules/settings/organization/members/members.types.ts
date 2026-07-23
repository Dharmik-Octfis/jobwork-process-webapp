/** A member of an organization, as the members screen shows them. */
export interface PublicMember {
  /** The Membership id — this is what you PUT to when changing someone's role. */
  id: string;
  userId: string;
  fullName: string;
  email: string;
  /** The role (permission template) assigned. Null only for a legacy row that
   * predates the roles module — such a member has no permissions until assigned. */
  permissionTemplateId: string | null;
  roleName: string | null;
  /** True for the organization's owner. Their role cannot be changed or removed. */
  isOwner: boolean;
  joinedAt: string;
}
