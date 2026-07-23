import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Trash2, ShieldAlert } from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { organizationsApi } from '../organizations/organizations.api';
import { invitationsApi } from './invitations.api';
import { rolesApi } from '../roles/roles.api';
import { membersApi } from '../members/members.api';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import '../organizations/CreateOrganizationForm.css';

const inviteSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  permissionTemplateId: z.string().min(1, 'Select a role'),
});
type InviteValues = z.infer<typeof inviteSchema>;

/**
 * Settings → Members. Invite people, see who's in the org, and change what role
 * someone holds.
 *
 * An organization has no default roles — only Owner exists at creation — so the
 * invite form is disabled until the owner has created at least one role. Access
 * is always granted by assigning a role, never per person.
 */
export function InviteMembersPage() {
  const { orgId: id } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [inviteToRevoke, setInviteToRevoke] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<string | null>(null);

  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    staleTime: 5 * 60 * 1000,
  });
  const activeOrg = organizations?.find((o) => o.id === id);

  const invitesKey = ['invitations', id];
  const { data: invitations, isLoading } = useQuery({
    queryKey: invitesKey,
    queryFn: () => invitationsApi.listForOrg(id!),
    enabled: Boolean(id),
  });

  const membersKey = ['members', id];
  const { data: members } = useQuery({
    queryKey: membersKey,
    queryFn: () => membersApi.list(id!),
    enabled: Boolean(id),
  });

  const { data: roles } = useQuery({
    queryKey: ['permission-templates', id],
    queryFn: () => rolesApi.list(id!),
    enabled: Boolean(id),
  });

  // The Owner role is never assignable — ownership comes from creating the org.
  const assignableRoles = roles?.filter((r) => !r.isOwner) ?? [];
  const hasRoles = assignableRoles.length > 0;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', permissionTemplateId: '' },
  });

  const createMutation = useMutation({
    mutationFn: (values: InviteValues) => invitationsApi.create(id!, values),
    onSuccess: async () => {
      setServerError(null);
      reset({ email: '', permissionTemplateId: '' });
      await queryClient.invalidateQueries({ queryKey: invitesKey });
    },
    onError: (err) => setServerError(toApiErrorMessage(err)),
  });

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.revoke(id!, invitationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invitesKey });
    },
  });

  const assignRoleMutation = useMutation({
    mutationFn: ({ membershipId, roleId }: { membershipId: string; roleId: string }) =>
      membersApi.assignRole(id!, membershipId, roleId),
    onSuccess: async () => {
      setServerError(null);
      await queryClient.invalidateQueries({ queryKey: membersKey });
    },
    onError: (err) => setServerError(toApiErrorMessage(err)),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (membershipId: string) => membersApi.remove(id!, membershipId),
    onSuccess: async () => {
      setServerError(null);
      await queryClient.invalidateQueries({ queryKey: membersKey });
    },
    onError: (err) => setServerError(toApiErrorMessage(err)),
  });

  const onSubmit = handleSubmit((values) => createMutation.mutate(values));

  if (!id) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          flex: 1,
          maxWidth: 900,
          margin: '0 auto',
          width: '100%',
          padding: 'var(--space-6) var(--space-5)',
          gap: 'var(--space-6)',
        }}
      >
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Invite form */}
          <section
            style={{
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              padding: 'var(--space-6)',
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 var(--space-1) 0' }}>
              Invite members
            </h2>
            <p
              style={{
                color: 'var(--color-text-muted)',
                margin: '0 0 var(--space-5) 0',
                fontSize: 14,
              }}
            >
              Invite people to {activeOrg ? <strong>{activeOrg.name}</strong> : 'this organization'}{' '}
              by email. They'll get a link to join.
            </p>

            {serverError && (
              <div
                style={{
                  padding: 12,
                  background: 'var(--danger-50)',
                  color: 'var(--color-danger)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 20,
                  fontSize: 14,
                }}
              >
                {serverError}
              </div>
            )}

            {/* No roles yet → inviting is impossible by design. Point them at Roles. */}
            {!hasRoles ? (
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: 16,
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 14,
                }}
              >
                <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>Create a role first.</strong>
                  <div style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>
                    This organization has no roles yet besides Owner. A member must be given a role,
                    so create one before inviting anyone.
                  </div>
                  <Link
                    to={`/organizations/${id}/settings/roles`}
                    style={{
                      display: 'inline-block',
                      marginTop: 10,
                      color: 'var(--color-primary)',
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    Go to Roles →
                  </Link>
                </div>
              </div>
            ) : (
              <form
                onSubmit={onSubmit}
                style={{
                  display: 'flex',
                  gap: 'var(--space-3)',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                }}
              >
                <div className="org-form-group" style={{ flex: '1 1 260px', margin: 0 }}>
                  <label>Email address</label>
                  <input
                    type="email"
                    className={`org-form-input ${errors.email ? 'error' : ''}`}
                    placeholder="teammate@company.com"
                    {...register('email')}
                  />
                  {errors.email && <p className="org-form-error-msg">{errors.email.message}</p>}
                </div>

                <div className="org-form-group" style={{ flex: '0 0 180px', margin: 0 }}>
                  <label>Role</label>
                  <select className="org-form-select" {...register('permissionTemplateId')}>
                    <option value="">Select a role…</option>
                    {assignableRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  {errors.permissionTemplateId && (
                    <p className="org-form-error-msg">{errors.permissionTemplateId.message}</p>
                  )}
                </div>

                <div
                  className="org-form-group"
                  style={{
                    flex: '0 0 auto',
                    margin: 0,
                    alignSelf: 'stretch',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                  }}
                >
                  <label style={{ visibility: 'hidden' }}>Send</label>
                  <button
                    type="submit"
                    disabled={isSubmitting || createMutation.isPending}
                    style={{
                      background: 'var(--color-primary)',
                      color: 'white',
                      border: 'none',
                      padding: '10px 20px',
                      borderRadius: 'var(--radius-md)',
                      fontWeight: 600,
                      cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      whiteSpace: 'nowrap',
                      opacity: createMutation.isPending ? 0.7 : 1,
                    }}
                  >
                    <Mail size={16} /> {createMutation.isPending ? 'Sending…' : 'Send invite'}
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* Current members */}
          <section
            style={{
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: 'var(--space-4) var(--space-6)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Members</h2>
            </div>

            {!members || members.length === 0 ? (
              <div
                style={{
                  padding: 'var(--space-6)',
                  color: 'var(--color-text-muted)',
                  fontSize: 14,
                }}
              >
                No members yet.
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {members.map((m) => (
                  <li
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: 'var(--space-4) var(--space-6)',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{m.fullName}</div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                        {m.email}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {m.isOwner ? (
                        // The owner's role is fixed — no dropdown, nothing to change.
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: 'var(--color-text-muted)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 999,
                            padding: '4px 12px',
                          }}
                        >
                          Owner
                        </span>
                      ) : (
                        <>
                          <select
                            className="org-form-select"
                            style={{ minWidth: 160 }}
                            value={m.permissionTemplateId ?? ''}
                            disabled={assignRoleMutation.isPending || !hasRoles}
                            onChange={(e) =>
                              assignRoleMutation.mutate({
                                membershipId: m.id,
                                roleId: e.target.value,
                              })
                            }
                          >
                            {!m.permissionTemplateId && <option value="">No role</option>}
                            {assignableRoles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => setMemberToRemove(m.id)}
                            title="Remove member"
                            style={{
                              background: 'white',
                              color: 'var(--color-danger)',
                              border: '1px solid var(--color-danger)',
                              padding: '6px 12px',
                              borderRadius: 'var(--radius-md)',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Pending invitations */}
          <section
            style={{
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: 'var(--space-4) var(--space-6)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Pending invitations</h2>
            </div>

            {isLoading ? (
              <div style={{ padding: 'var(--space-6)', color: 'var(--color-text-muted)' }}>
                Loading…
              </div>
            ) : !invitations || invitations.length === 0 ? (
              <div
                style={{
                  padding: 'var(--space-6)',
                  color: 'var(--color-text-muted)',
                  fontSize: 14,
                }}
              >
                No pending invitations.
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {invitations.map((inv) => (
                  <li
                    key={inv.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: 'var(--space-4) var(--space-6)',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    <div>
                      <div
                        style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}
                      >
                        {inv.email}
                        {/* A declined invite stays listed so the admin actually
                            learns they said no, rather than watching it expire. */}
                        {inv.status === 'declined' && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: 'var(--color-danger)',
                              border: '1px solid var(--color-danger)',
                              borderRadius: 999,
                              padding: '2px 8px',
                            }}
                          >
                            Declined
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                        {inv.roleName} · invited by {inv.invitedByName} ·{' '}
                        {inv.status === 'declined'
                          ? 'invite again to re-send'
                          : `expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                      </div>
                    </div>
                    <button
                      onClick={() => setInviteToRevoke(inv.id)}
                      disabled={revokeMutation.isPending}
                      title="Revoke invitation"
                      style={{
                        background: 'white',
                        color: 'var(--color-danger)',
                        border: '1px solid var(--color-danger)',
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-md)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Trash2 size={14} /> Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>

      <ConfirmDialog
        isOpen={!!inviteToRevoke}
        title="Revoke Invitation"
        message="Are you sure you want to revoke this invitation? The user will no longer be able to join."
        confirmText="Revoke"
        onConfirm={() => {
          if (inviteToRevoke) {
            revokeMutation.mutate(inviteToRevoke);
            setInviteToRevoke(null);
          }
        }}
        onCancel={() => setInviteToRevoke(null)}
        isConfirming={revokeMutation.isPending}
      />

      <ConfirmDialog
        isOpen={!!memberToRemove}
        title="Remove member"
        message="Remove this person from the organization? They will lose access immediately."
        confirmText="Remove"
        onConfirm={() => {
          if (memberToRemove) {
            removeMemberMutation.mutate(memberToRemove);
            setMemberToRemove(null);
          }
        }}
        onCancel={() => setMemberToRemove(null)}
        isConfirming={removeMemberMutation.isPending}
      />
    </div>
  );
}
