import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, ShieldAlert, X } from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { invitationsApi } from '../invitations/invitations.api';
import { Select } from '../../components/ui/Select';
import type { Role } from '../roles/roles.api';
import type { PermissionTemplate } from '../permission-templates/permissionTemplates.api';

/**
 * "New User" — an invitation, not a directly-created account. Nobody gets a
 * password set for them: the person receives a link and sets their own, which keeps
 * the credential something only they ever know.
 *
 * First and last name are REQUIRED, and they are the person's name **in this
 * organization** — written to their Membership when they accept, never to their
 * account. Invite the same email into two orgs with two spellings and both stand.
 * Requiring them is also what makes a pending row in the roster readable: without a
 * name it is a bare email address that tells a reviewing admin nothing.
 */
const inviteSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(40),
  lastName: z.string().trim().min(1, 'Last name is required').max(40),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  // A job title is optional — it grants nothing, so requiring one would block
  // inviting for no gain. Access is not optional.
  roleId: z.string().optional(),
  permissionTemplateId: z.string().min(1, 'Select a permission template'),
});

type InviteValues = z.infer<typeof inviteSchema>;

interface NewUserModalProps {
  orgId: string;
  organizationName: string | undefined;
  roles: Role[];
  templates: PermissionTemplate[];
  onClose: () => void;
}

export function NewUserModal({
  orgId,
  organizationName,
  roles,
  templates,
  onClose,
}: NewUserModalProps) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  // Neither Owner one is assignable — ownership comes from creating the org.
  const assignableRoles = roles.filter((r) => !r.isSystem);
  const assignableTemplates = templates.filter((t) => !t.isSystem);
  const hasTemplates = assignableTemplates.length > 0;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      roleId: '',
      permissionTemplateId: '',
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: InviteValues) =>
      // An empty select means "no title", which the API expects as an absent field —
      // sending '' would fail uuid validation.
      invitationsApi.create(orgId, {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        permissionTemplateId: values.permissionTemplateId,
        ...(values.roleId ? { roleId: values.roleId } : {}),
      }),
    onSuccess: async () => {
      setServerError(null);
      // The new row lands in the Unconfirmed tab, so the roster and its counts both
      // have to refetch — they come from the same query.
      await queryClient.invalidateQueries({ queryKey: ['org-users', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['invitations', orgId] });
      onClose();
    },
    onError: (err) => setServerError(toApiErrorMessage(err)),
  });

  const onSubmit = handleSubmit((values) => createMutation.mutate(values));

  /** Indented so the org chart is legible in a flat `<select>`: the list arrives as
   * a depth-first walk, so `depth` alone is enough to show the shape. */
  const roleOptions = [
    { value: '', label: 'No role' },
    ...assignableRoles.map((r) => ({
      value: r.id,
      label: `${'  '.repeat(r.depth)}${r.depth > 0 ? '└ ' : ''}${r.name}`,
    })),
  ];

  return (
    <div
      className="users-modal-backdrop"
      role="presentation"
      // Click-outside to dismiss, but only on the backdrop itself — a click that
      // started inside the panel must not close it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="users-modal" role="dialog" aria-modal="true" aria-label="Invite a new user">
        <div className="users-modal-head">
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>New user</h2>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 13,
                color: 'var(--color-text-muted)',
              }}
            >
              They&apos;ll get an email invitation to join{' '}
              {organizationName ? <strong>{organizationName}</strong> : 'this organization'} and
              choose their own password.
            </p>
          </div>
          <button type="button" className="users-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="users-modal-body">
          {serverError && <div className="users-alert is-error">{serverError}</div>}

          {/* No permission templates yet → inviting is impossible by design, since a
              member must be given access. Point them at Permissions. (Roles are
              optional, so their absence never blocks an invite.) */}
          {!hasTemplates ? (
            <div className="users-alert is-info" style={{ display: 'flex', gap: 12 }}>
              <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>Create a permission template first.</strong>
                <div style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>
                  This organization has no permission templates yet besides Owner. A user must be
                  given access, so create one before inviting anyone.
                </div>
                <Link
                  to={`/organizations/${orgId}/settings/permissions`}
                  style={{
                    display: 'inline-block',
                    marginTop: 10,
                    color: 'var(--color-primary)',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  Go to Permissions →
                </Link>
              </div>
            </div>
          ) : (
            <form id="new-user-form" onSubmit={onSubmit} noValidate>
              <div className="users-form-row">
                <div>
                  <label className="users-field-label" htmlFor="nu-first">
                    First name *
                  </label>
                  <input
                    id="nu-first"
                    className={`users-input ${errors.firstName ? 'error' : ''}`}
                    placeholder="Priya"
                    {...register('firstName')}
                  />
                  {errors.firstName && (
                    <p className="users-error-msg">{errors.firstName.message}</p>
                  )}
                </div>
                <div>
                  <label className="users-field-label" htmlFor="nu-last">
                    Last name *
                  </label>
                  <input
                    id="nu-last"
                    className={`users-input ${errors.lastName ? 'error' : ''}`}
                    placeholder="Shah"
                    {...register('lastName')}
                  />
                  {errors.lastName && <p className="users-error-msg">{errors.lastName.message}</p>}
                </div>
              </div>

              <div className="users-form-field">
                <label className="users-field-label" htmlFor="nu-email">
                  Email address *
                </label>
                <input
                  id="nu-email"
                  type="email"
                  className={`users-input ${errors.email ? 'error' : ''}`}
                  placeholder="teammate@company.com"
                  {...register('email')}
                />
                {errors.email && <p className="users-error-msg">{errors.email.message}</p>}
                <p
                  style={{
                    margin: '6px 0 0',
                    fontSize: 11.5,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  The name above is how this person appears in this organization. If they already
                  have an account elsewhere, their name there is unaffected.
                </p>
              </div>

              {/* Two separate choices, here and everywhere: the title is optional and
                  grants nothing; the template is what they will actually be able to do. */}
              <div className="users-form-row">
                <div>
                  <label className="users-field-label">Role</label>
                  <Controller
                    control={control}
                    name="roleId"
                    render={({ field }) => (
                      <Select
                        value={field.value || ''}
                        onChange={field.onChange}
                        options={roleOptions}
                        ariaLabel="Role"
                      />
                    )}
                  />
                </div>
                <div>
                  <label className="users-field-label">Permissions *</label>
                  <Controller
                    control={control}
                    name="permissionTemplateId"
                    render={({ field }) => (
                      <Select
                        value={field.value || ''}
                        onChange={field.onChange}
                        hasError={Boolean(errors.permissionTemplateId)}
                        options={[
                          { value: '', label: 'Select a template…' },
                          ...assignableTemplates.map((t) => ({ value: t.id, label: t.name })),
                        ]}
                        ariaLabel="Permission template"
                      />
                    )}
                  />
                  {errors.permissionTemplateId && (
                    <p className="users-error-msg">{errors.permissionTemplateId.message}</p>
                  )}
                </div>
              </div>
            </form>
          )}
        </div>

        <div className="users-modal-foot">
          <button type="button" className="users-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="new-user-form"
            className="users-btn is-primary"
            disabled={!hasTemplates || isSubmitting || createMutation.isPending}
          >
            <Mail size={15} />
            {createMutation.isPending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
  );
}
