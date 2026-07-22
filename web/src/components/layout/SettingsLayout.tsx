import { useState } from 'react';
import { NavLink, Outlet, useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ChevronLeft,
  Building2,
  Users,
  Package,
  Coins,
  LayoutGrid,
  ChevronRight,
} from 'lucide-react';
import { CUSTOM_FIELD_MODULES } from '../../features/custom-fields/customFields.schemas';

export function SettingsLayout() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const onModulesRoute = location.pathname.includes('/settings/modules');
  const [modulesOpen, setModulesOpen] = useState(onModulesRoute);

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
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              padding: '0 12px',
              marginBottom: 4,
              letterSpacing: '0.05em',
            }}
          >
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

          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              padding: '0 12px',
              marginTop: 16,
              marginBottom: 4,
              letterSpacing: '0.05em',
            }}
          >
            Inventory
          </div>

          <NavLink
            to={`/organizations/${orgId}/settings/inventory/uom`}
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
            <Package size={18} />
            <span style={{ fontSize: 14 }}>Unit of Measurement</span>
          </NavLink>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              padding: '0 12px',
              marginTop: 16,
              marginBottom: 4,
              letterSpacing: '0.05em',
            }}
          >
            Configuration
          </div>

          <NavLink
            to={`/organizations/${orgId}/settings/configuration/currencies`}
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
            <Coins size={18} />
            <span style={{ fontSize: 14 }}>Currencies</span>
          </NavLink>

          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              padding: '0 12px',
              marginTop: 16,
              marginBottom: 4,
              letterSpacing: '0.05em',
            }}
          >
            Customization
          </div>

          {/* Modules — expandable dropdown listing the modules that support custom fields. */}
          <button
            type="button"
            onClick={() => setModulesOpen((o) => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: onModulesRoute ? 'var(--primary-50)' : 'transparent',
              color: onModulesRoute ? 'var(--color-primary)' : 'var(--color-text)',
              fontWeight: onModulesRoute ? 600 : 500,
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
            }}
          >
            <LayoutGrid size={18} />
            <span style={{ fontSize: 14, flex: 1 }}>Modules</span>
            {/* Rotating chevron — same effect as the main sidebar's module groups. */}
            <span
              style={{
                display: 'flex',
                transform: modulesOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            >
              <ChevronRight size={16} />
            </span>
          </button>

          {/* Grid-rows height animation — identical to AppLayout's ModuleNavGroup. */}
          <div
            style={{
              display: 'grid',
              gridTemplateRows: modulesOpen ? '1fr' : '0fr',
              transition: 'grid-template-rows 0.2s ease',
            }}
          >
            <div
              style={{
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-1)',
              }}
            >
              {CUSTOM_FIELD_MODULES.map((m) => (
                <NavLink
                  key={m.entityType}
                  to={`/organizations/${orgId}/settings/modules/${m.entityType}`}
                  style={({ isActive }) => ({
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: '7px 12px 7px 40px',
                    borderRadius: 'var(--radius-md)',
                    textDecoration: 'none',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
                    background: isActive ? 'var(--primary-50)' : 'transparent',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: 13,
                    transition: 'all 0.2s ease',
                  })}
                >
                  {m.label}
                </NavLink>
              ))}
            </div>
          </div>
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
