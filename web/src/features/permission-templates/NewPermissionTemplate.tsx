import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PermissionTemplateEditor } from './PermissionTemplateEditor';

/**
 * Route page for `/settings/permissions/new` — the thin create wrapper around the
 * shared editor, matching `CreateVendor` / `CreateLocation`.
 *
 * A route rather than a modal because the permission grid is a hundred checkboxes
 * wide: it needs the full page, and a URL of its own so an interrupted edit is
 * reachable again.
 */
export function NewPermissionTemplate() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  if (!orgId) return null;

  const listPath = `/organizations/${orgId}/settings/permissions`;

  return (
    <PermissionTemplateEditor
      orgId={orgId}
      template={null}
      onDone={async (saved) => {
        // Both keys: the paginated list AND the flat one the user/invite pickers read.
        await queryClient.invalidateQueries({ queryKey: ['permission-templates', orgId] });
        await queryClient.invalidateQueries({ queryKey: ['permission-templates-all', orgId] });
        // Land on the profile that was just created rather than a bare list —
        // the next thing an admin does is check what they granted.
        navigate(`${listPath}?id=${saved.id}`);
      }}
      onCancel={() => navigate(listPath)}
    />
  );
}
