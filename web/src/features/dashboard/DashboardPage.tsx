import { Button } from '../../components/ui/Button';
import { Logo } from '../../components/ui/Logo';
import { useAuth } from '../../providers/auth-context';

export function DashboardPage() {
  const { user, clearSession } = useAuth();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' }}>
      {/* Topbar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'var(--space-3) var(--space-5)',
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Logo tone="light" size={28} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <span style={{ fontSize: 14, color: 'var(--color-text-muted)', fontWeight: 500 }}>
            {user?.email}
          </span>
          <Button variant="secondary" onClick={clearSession} style={{ padding: '6px 12px', fontSize: 14, height: 'auto' }}>
            Sign out
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, padding: 'var(--space-6) var(--space-5)', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        {/* Welcome Banner */}
        <section
          style={{
            background: 'linear-gradient(135deg, var(--navy-900) 0%, var(--color-primary) 100%)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-6)',
            color: 'white',
            marginBottom: 'var(--space-6)',
            boxShadow: 'var(--shadow-md)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'relative', zIndex: 1 }}>
            <h2 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 var(--space-2) 0', color: 'white' }}>
              Welcome back, {user?.name || 'User'}! 👋
            </h2>
            <p style={{ fontSize: 16, opacity: 0.9, margin: 0, maxWidth: 500, lineHeight: 1.6 }}>
              Here's what's happening in your workspace today. Manage your jobs, check approvals, and stay on top of your tasks.
            </p>
          </div>
          {/* Decorative circle */}
          <div
            style={{
              position: 'absolute',
              top: '-50%',
              right: '-5%',
              width: 300,
              height: 300,
              background: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '50%',
              filter: 'blur(40px)',
              zIndex: 0,
            }}
          />
        </section>

        {/* Stats Grid */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 'var(--space-5)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <StatCard title="Active Jobs" value="24" trend="+12% this week" isPositive={true} />
          <StatCard title="Pending Approvals" value="7" trend="-2% this week" isPositive={false} />
          <StatCard title="Total Revenue" value="$12,450" trend="+8% this week" isPositive={true} />
        </section>
        
        {/* Recent Activity Placeholder */}
        <section>
          <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 'var(--space-4)' }}>Recent Activity</h3>
          <div
            style={{
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              padding: 'var(--space-5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 200,
              color: 'var(--color-text-subtle)',
            }}
          >
            <p>Activity feed will appear here soon.</p>
          </div>
        </section>
      </main>
    </div>
  );
}

// Simple internal component for the cards to keep code clean
function StatCard({ title, value, trend, isPositive }: { title: string; value: string; trend: string; isPositive: boolean }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-5)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-muted)', margin: '0 0 var(--space-2) 0' }}>
        {title}
      </h3>
      <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--color-text)', marginBottom: 'var(--space-2)' }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: isPositive ? 'var(--color-success)' : 'var(--color-danger)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {isPositive ? '↑' : '↓'} {trend}
      </div>
    </div>
  );
}
