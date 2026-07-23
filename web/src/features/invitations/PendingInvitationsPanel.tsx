import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { invitationsApi } from './invitations.api';

/**
 * The recipient's invitation inbox.
 *
 * Rendered on the organizations list, because that is where someone looks when
 * they expect to see an organization that isn't there yet. Without this, an
 * invitation is only reachable through the emailed link — so losing the email
 * meant losing the invitation entirely.
 *
 * Accept/decline here go through `/me/invitations/:id/…`, which authorize by
 * session + email match rather than by the emailed token (the raw token is never
 * recoverable — only its hash is stored). Renders nothing when there is nothing
 * pending, so it stays invisible in the normal case.
 */
export function PendingInvitationsPanel() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const invitesKey = ['my-invitations'];
  const { data: invitations } = useQuery({
    queryKey: invitesKey,
    queryFn: () => invitationsApi.listMine(),
  });

  const refresh = async () => {
    setError(null);
    // Accepting adds an organization, so the org list must refetch too.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: invitesKey }),
      queryClient.invalidateQueries({ queryKey: ['organizations'] }),
    ]);
  };

  const acceptMutation = useMutation({
    mutationFn: (id: string) => invitationsApi.acceptMine(id),
    onSuccess: refresh,
    onError: (err) => setError(toApiErrorMessage(err)),
  });

  const declineMutation = useMutation({
    mutationFn: (id: string) => invitationsApi.declineMine(id),
    onSuccess: refresh,
    onError: (err) => setError(toApiErrorMessage(err)),
  });

  const busy = acceptMutation.isPending || declineMutation.isPending;

  if (!invitations || invitations.length === 0) return null;

  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        marginBottom: 'var(--space-6)',
      }}
    >
      <div
        style={{
          padding: 'var(--space-4) var(--space-6)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Mail size={16} />
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
          {invitations.length === 1
            ? 'You have an invitation'
            : `You have ${invitations.length} invitations`}
        </h2>
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            margin: 'var(--space-4) var(--space-6) 0',
            background: 'var(--danger-50)',
            color: 'var(--color-danger)',
            borderRadius: 'var(--radius-md)',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

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
              flexWrap: 'wrap',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{inv.organizationName}</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Invited as <strong>{inv.roleName}</strong> by {inv.invitedByName} · expires{' '}
                {new Date(inv.expiresAt).toLocaleDateString()}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => acceptMutation.mutate(inv.id)}
                disabled={busy}
                style={{
                  background: 'var(--color-primary)',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {acceptMutation.isPending ? 'Joining…' : 'Accept'}
              </button>
              <button
                onClick={() => declineMutation.mutate(inv.id)}
                disabled={busy}
                style={{
                  background: 'white',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
