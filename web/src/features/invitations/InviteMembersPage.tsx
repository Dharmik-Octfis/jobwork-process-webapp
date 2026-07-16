import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronLeft, Mail, Trash2 } from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { organizationsApi } from '../organizations/organizations.api';
import { invitationsApi } from './invitations.api';
import '../organizations/CreateOrganizationForm.css';

const inviteSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  role: z.enum(['admin', 'member']),
});
type InviteValues = z.infer<typeof inviteSchema>;

/** Owner/admin screen to invite members to an organization and manage pending invites. */
export function InviteMembersPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role: 'member' },
  });

  const createMutation = useMutation({
    mutationFn: (values: InviteValues) => invitationsApi.create(id!, values),
    onSuccess: async () => {
      setServerError(null);
      reset({ email: '', role: 'member' });
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

  const onSubmit = handleSubmit((values) => createMutation.mutate(values));

  if (!id) return null;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          background: 'var(--navy-900)',
          padding: 'var(--space-3) var(--space-5)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
        }}
      >
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            color: 'white',
            padding: 8,
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <ChevronLeft size={16} /> Back to Dashboard
        </button>
      </header>

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

              <div className="org-form-group" style={{ flex: '0 0 140px', margin: 0 }}>
                <label>Role</label>
                <select className="org-form-select" {...register('role')}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
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
                      <div style={{ fontWeight: 500 }}>{inv.email}</div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                        {inv.role} · invited by {inv.invitedByName} · expires{' '}
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => revokeMutation.mutate(inv.id)}
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
    </div>
  );
}
