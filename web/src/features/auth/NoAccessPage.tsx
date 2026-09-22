import { Button } from '../../components/ui/Button';
import { AuthShell } from './AuthShell';
import styles from './Auth.module.css';

/**
 * Where a REFUSED sign-in lands: the identity is fine at accounts, but jobwork said
 * no. docs/SSO_WEBSITE_ENTRY_PLAN.md §5.4.
 *
 * Since self-signup (2026-09-22) that is rare: the account was disabled or removed in
 * jobwork, or its email was never confirmed (accounts normally confirms it before
 * sign-in completes). A NEW account is never sent here — it lands on "Create
 * organization" instead.
 *
 * The only action is signing out, and it is the one that matters: the person is
 * still signed in at accounts, so "Access Jobwork" on the website would bring them
 * straight back here. Signing out is what lets them choose a different account.
 */
export function NoAccessPage() {
  return (
    <AuthShell title="No access to Jobwork" subtitle="for the account you signed in with">
      <p className={styles.notice}>
        This account can't use Jobwork right now. It may have been disabled by your organization's
        administrator — ask them to restore it.
      </p>
      <p className={styles.notice}>Or sign out and sign in with a different account.</p>
      {/*
        A full navigation, not `navigate()`: it has to reach the provider to end the
        SSO session there, exactly as `useLogout` does.
      */}
      <Button
        type="button"
        fullWidth
        onClick={() => window.location.assign('/api/auth/sso/logout')}
      >
        Sign out and use another account
      </Button>
    </AuthShell>
  );
}
