import { Button } from '../../components/ui/Button';
import { useAuth } from '../../providers/auth-context';

/**
 * Placeholder home screen behind the auth guard. Confirms the login/signup
 * flow end-to-end; the real dashboard feature is built later.
 */
export function DashboardPage() {
  const { user, clearSession } = useAuth();

  return (
    <main
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: 'var(--space-7) var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
      }}
    >
      <h1 style={{ fontSize: 28 }}>Welcome{user ? `, ${user.name}` : ''} 👋</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>
        You&apos;re signed in{user ? ` as ${user.email}` : ''}. The dashboard is coming soon.
      </p>
      <div>
        <Button variant="secondary" onClick={clearSession}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
