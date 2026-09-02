import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { toApiErrorMessage } from '../../api/client';
import { useAuth } from '../../providers/auth-context';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { AuthShell } from '../auth/AuthShell';
import { FormErrorBanner } from '../auth/FormErrorBanner';
import { invitationsApi, type AcceptInvitationBody } from './invitations.api';
import styles from '../auth/Auth.module.css';

const signupSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(40),
  lastName: z.string().trim().min(1, 'Last name is required').max(40),
  password: z.string().min(8, 'Use at least 8 characters').max(72),
});
type SignupValues = z.infer<typeof signupSchema>;

/**
 * The invitation accept screen. Reached from the emailed link
 * (`/invite/accept?token=…`). It resolves the token, then branches on who's
 * looking:
 *
 *   • signed in as the invited email  → one-click "Join {org}"
 *   • signed in as someone else       → asked to switch accounts
 *   • not signed in, account exists    → sent to sign in, then reopen the link
 *   • not signed in, brand-new person  → inline "create account" form
 */
export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, isLoading: authLoading, setSession } = useAuth();
  const autoAcceptStarted = useRef(false);

  const lookup = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => invitationsApi.lookup(token),
    enabled: token.length > 0,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: (body: AcceptInvitationBody) => invitationsApi.accept(token, body),
    onSuccess: (result) => {
      // New account created during accept → store the session, then go in.
      if (result.user) setSession(result.user);
      navigate('/organizations/' + result.organization.id, { replace: true });
    },
  });

  // Declining just re-runs the lookup, which now resolves to 'declined' and
  // renders the "you declined this" screen — no separate local state needed.
  const declineMutation = useMutation({
    mutationFn: () => invitationsApi.decline(token),
    onSuccess: () => lookup.refetch(),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { firstName: '', lastName: '', password: '' },
  });

  const lookupEmail = lookup.data?.email ?? '';
  const shouldAutoAccept = Boolean(
    isAuthenticated &&
    user &&
    lookup.data?.status === 'valid' &&
    user.email.toLowerCase() === lookupEmail.toLowerCase(),
  );

  useEffect(() => {
    if (!shouldAutoAccept) return;
    if (acceptMutation.isPending || acceptMutation.isSuccess || autoAcceptStarted.current) return;
    autoAcceptStarted.current = true;
    acceptMutation.mutate({});
  }, [acceptMutation, acceptMutation.isPending, acceptMutation.isSuccess, shouldAutoAccept]);

  // ── Guard states ────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <Shell title="Invalid link" subtitle="This invitation link is missing its token.">
        <BackToSignIn />
      </Shell>
    );
  }

  if (lookup.isLoading || authLoading) {
    return <Shell title="Checking your invitation…" subtitle="One moment." />;
  }

  if (lookup.isError || !lookup.data) {
    return (
      <Shell title="Something went wrong" subtitle="We couldn't load this invitation.">
        <BackToSignIn />
      </Shell>
    );
  }

  const invite = lookup.data;

  if (invite.status !== 'valid') {
    const messages: Record<string, string> = {
      expired: 'This invitation has expired. Ask the organization to send a new one.',
      accepted: 'This invitation has already been accepted.',
      revoked: 'This invitation has been revoked.',
      declined: 'You declined this invitation. Ask the organization to send a new one.',
      invalid: 'This invitation link is not valid.',
    };
    return (
      <Shell title="Invitation unavailable" subtitle={messages[invite.status] ?? messages.invalid}>
        <BackToSignIn />
      </Shell>
    );
  }

  const orgName = invite.organizationName ?? 'the organization';
  const inviteEmail = invite.email ?? '';
  const loginPath =
    '/login?email=' +
    encodeURIComponent(inviteEmail) +
    '&next=' +
    encodeURIComponent('/invite/accept?token=' + token);
  const signupPath =
    '/signup?email=' +
    encodeURIComponent(inviteEmail) +
    '&next=' +
    encodeURIComponent('/invite/accept?token=' + token);
  // The job title if the inviter set one, otherwise the access they're getting —
  // a title is optional, and "invited as undefined" helps nobody.
  const invitedAs = invite.roleName ?? invite.permissionTemplateName ?? 'a member';
  const serverError = acceptMutation.isError ? toApiErrorMessage(acceptMutation.error) : null;

  // ── Case A: signed in ────────────────────────────────────────────────────────
  if (isAuthenticated && user) {
    const emailMatches = user.email.toLowerCase() === inviteEmail.toLowerCase();

    if (!emailMatches) {
      return <Navigate to={invite.accountExists ? loginPath : signupPath} replace />;
    }

    return (
      <Shell title={`Join ${orgName}`} subtitle={`You're invited as ${invitedAs}.`}>
        {serverError && <FormErrorBanner message={serverError} />}
        <Button
          fullWidth
          className={styles.submit}
          isLoading={acceptMutation.isPending}
          onClick={() => acceptMutation.mutate({})}
        >
          {acceptMutation.isPending ? 'Joining…' : `Join ${orgName}`}
        </Button>
        <DeclineButton
          isPending={declineMutation.isPending}
          onDecline={() => declineMutation.mutate()}
        />
      </Shell>
    );
  }

  // ── Case B: not signed in, but an account already exists ─────────────────────
  if (invite.accountExists) {
    return <Navigate to={loginPath} replace />;
  }

  // ── Case C: not signed in, brand-new person → create account + accept ────────
  const onSubmit = handleSubmit((values) => acceptMutation.mutate(values));

  return (
    <Shell title={`Join ${orgName}`} subtitle={`Create your account to accept as ${invitedAs}.`}>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {serverError && <FormErrorBanner message={serverError} />}

        <Input label="Email" type="email" value={inviteEmail} readOnly disabled />

        <div className={styles.row}>
          <Input
            label="First name"
            autoComplete="given-name"
            placeholder="Jane"
            autoFocus
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <Input
            label="Last name"
            autoComplete="family-name"
            placeholder="Doe"
            error={errors.lastName?.message}
            {...register('lastName')}
          />
        </div>

        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="Create a password"
          hint="* Password must contain at least 8 characters (1 uppercase, 1 lowercase, 1 number, 1 special)."
          error={errors.password?.message}
          {...register('password')}
        />

        <Button
          type="submit"
          fullWidth
          className={styles.submit}
          isLoading={acceptMutation.isPending}
        >
          {acceptMutation.isPending ? 'Creating account…' : `Create account & join`}
        </Button>
      </form>

      <DeclineButton
        isPending={declineMutation.isPending}
        onDecline={() => declineMutation.mutate()}
      />

      <p className={styles.switch}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </Shell>
  );
}

/** "No thanks" — tells the inviting admin the person said no, instead of leaving
 * the invite to expire silently a week later. Deliberately understated: declining
 * is a secondary action next to Join. */
function DeclineButton({ isPending, onDecline }: { isPending: boolean; onDecline: () => void }) {
  return (
    <p className={styles.switch}>
      Not expecting this?{' '}
      <button
        type="button"
        onClick={onDecline}
        disabled={isPending}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          font: 'inherit',
          color: 'var(--color-text-muted)',
          textDecoration: 'underline',
          cursor: isPending ? 'not-allowed' : 'pointer',
        }}
      >
        {isPending ? 'Declining…' : 'Decline invitation'}
      </button>
    </p>
  );
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <AuthShell title={title} subtitle={subtitle}>
      {children}
    </AuthShell>
  );
}

function BackToSignIn() {
  return (
    <p className={styles.switch}>
      <Link to="/login">Back to sign in</Link>
    </p>
  );
}
