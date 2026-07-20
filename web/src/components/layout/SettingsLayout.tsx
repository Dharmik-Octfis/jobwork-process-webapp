import { NavLink, Outlet, useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Building2, Users } from 'lucide-react';

export function SettingsLayout() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--color-bg)',
      }}
    >
      {/* Settings Sidebar */}
      <aside
        style={{
          width: 250,
          background: 'white',
          borderRight: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
        }}
      >
        <div
          style={{
            padding: 'var(--space-4)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
          }}
        >
          <button
            onClick={() => navigate(`/organizations/${orgId}`)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 13,
              fontWeight: 500,
              padding: 0,
            }}
          >
            <ChevronLeft size={16} /> Back to Dashboard
          </button>
          
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--color-text)' }}>
            Settings
          </h2>
        </div>

        <nav
          style={{
            flex: 1,
            padding: 'var(--space-4) var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)', padding: '0 12px', marginBottom: 4, letterSpacing: '0.05em' }}>
            Organization
          </div>
          
          <NavLink
            to={`/organizations/${orgId}/settings`}
            end
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              textDecoration: 'none',
              color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
              background: isActive ? 'var(--primary-50)' : 'transparent',
              fontWeight: isActive ? 600 : 500,
              transition: 'all 0.2s ease',
            })}
          >
            <Building2 size={18} />
            <span style={{ fontSize: 14 }}>Profile</span>
          </NavLink>

          <NavLink
            to={`/organizations/${orgId}/settings/members`}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              textDecoration: 'none',
              color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
              background: isActive ? 'var(--primary-50)' : 'transparent',
              fontWeight: isActive ? 600 : 500,
              transition: 'all 0.2s ease',
            })}
          >
            <Users size={18} />
            <span style={{ fontSize: 14 }}>Members & Invites</span>
          </NavLink>
        </nav>
      </aside>

      {/* Main Settings Content */}
      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          background: 'var(--color-bg)',
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}
