/** Shape returned to clients for a permission template. */
export interface PublicPermissionTemplate {
  id: string;
  name: string;
  description: string | null;
  /** The seeded Owner template: immutable and never assignable. The other seeds
   * ("Full access", "View only") are ordinary editable rows, so this is false. */
  isSystem: boolean;
  /** Resolves to the whole catalog at runtime rather than reading `permissions`,
   * so future permissions apply with no backfill. Only the Owner template has it;
   * it is not settable through the API. */
  grantsAllPermissions: boolean;
  /** The template's granted permission keys. For an auto-granting template this is
   * the full computed catalog, so the UI can render its checkboxes like any other. */
  permissions: string[];
  /** How many memberships currently use this template — surfaced so admins can
   * spot single-user templates (sprawl) and know a template is safe to delete. */
  memberCount: number;
  /**
   * Attribution for the list's "Created By & Time" / "Modified By & Time" columns,
   * resolved through `lib/memberDirectory.ts` — so it is THIS organization's name
   * for the person, "System" for a seeded row (an org's templates are created
   * during signup, before there is an acting user), and "Support" for an actor who
   * is not a member here. Never the raw `users.fullName`.
   */
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
}
