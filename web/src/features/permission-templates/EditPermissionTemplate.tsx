import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { permissionTemplatesApi } from './permissionTemplates.api';
import { PermissionTemplateEditor } from './PermissionTemplateEditor';

/**
 * Route page for `/settings/permissions/:id/edit` — the thin edit wrapper around
 * the shared editor, matching `EditVendor` / `EditLocation`.
 *
 * The row is fetched here rather than passed through router state so the URL is
 * openable on its own: a bookmarked or refreshed edit page still works.
 */
export function EditPermissionTemplate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { orgId, id } = useParams<{ orgId: string; id: string }>();

  const { data: template, isLoading } = useQuery({
    queryKey: ['permission-template', orgId, id],
    queryFn: () => permissionTemplatesApi.get(orgId!, id!),
    enabled: Boolean(orgId && id),
  });

  if (!orgId || !id) return null;

  const listPath = `/organizations/${orgId}/settings/permissions`;

  if (isLoading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
        Loading profile...
      </div>
    );
  }

  if (!template) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
        Profile not found.
      </div>
    );
  }

  return (
    <PermissionTemplateEditor
      orgId={orgId}
      template={template}
      onDone={async () => {
        await queryClient.invalidateQueries({ queryKey: ['permission-templates', orgId] });
        await queryClient.invalidateQueries({ queryKey: ['permission-templates-all', orgId] });
        await queryClient.invalidateQueries({ queryKey: ['permission-template', orgId, id] });
        // Back to the profile's own pane, so the change is visible immediately.
        navigate(`${listPath}?id=${id}`);
      }}
      onCancel={() => navigate(`${listPath}?id=${id}`)}
    />
  );
}
