/** A member of an organization, as the members screen shows them. */
export interface PublicMember {
  /** The Membership id — this is what you PUT to when changing their role or access. */
  id: string;
  userId: string;
  fullName: string;
  email: string;
  /** The member's job title. Null when nobody has given them one — it grants
   * nothing either way. Independent of the permission template below. */
  roleId: string | null;
  roleName: string | null;
  /** The permission template that IS their authorization. Null only for a legacy
   * row: such a member can do nothing until a template is assigned. */
  permissionTemplateId: string | null;
  permissionTemplateName: string | null;
  /** True for the organization's owner. Nothing about their membership can be
   * changed, and they cannot be removed. */
  isOwner: boolean;
  joinedAt: string;
  userAgent: string;
}
