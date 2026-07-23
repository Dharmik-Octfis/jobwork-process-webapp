/** Shape returned to clients for a permission template. */
export interface PublicPermissionTemplate {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isOwner: boolean;
  /** The template's granted permission keys. For the Owner template this is the
   * full computed catalog, so the UI can render its checkboxes like any other. */
  permissions: string[];
  /** How many memberships currently use this template — surfaced so admins can
   * spot single-user templates (sprawl) and know a template is safe to delete. */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}
