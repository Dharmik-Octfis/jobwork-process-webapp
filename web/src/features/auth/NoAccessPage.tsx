import { Button } from '../../components/ui/Button';
import { AuthShell } from './AuthShell';
import styles from './Auth.module.css';

/**
 * Where a REFUSED sign-in lands: the identity is fine at accounts, but jobwork said
 * no — not invited, or disabled here. docs/SSO_WEBSITE_ENTRY_PLAN.md §5.4.
 *
 * 🔴 One page and one wording for every refusal. `provisionOrRefuse` deliberately
 * answers "unverified email" and "no invitation" identically so the sign-in cannot be
 * used to learn who is invited where; this page must not undo that by explaining
 * which one happened.
 *
 * The only action is signing out, and it is the one that matters: the person is
 * still signed in at accounts, so "Access Jobwork" on the website would bring them
 * straight back here. Signing out is what lets them choose a different account.
 */
export function NoAccessPage() {
  return (
    <AuthShell title="No access to Jobwork" subtitle="for the account you signed in with">
      <p className={styles.notice}>
        This account doesn't have access to Jobwork. If it should, ask your administrator to invite
        you.
      </p>
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
