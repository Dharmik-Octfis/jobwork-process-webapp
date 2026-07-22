import { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  FileText,
  Users,
  LogOut,
  User as UserIcon,
  Settings,
  LayoutDashboard,
  Home,
  ShoppingCart,
  Receipt,
  ChevronRight,
} from 'lucide-react';
import { Logo } from '../ui/Logo';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useAuth } from '../../providers/auth-context';
import { useLogout } from '../../features/auth/useLogout';
import { organizationsApi } from '../../features/organizations/organizations.api';
import type { Organization } from '../../features/organizations/organizations.schemas';
import type { User } from '../../features/auth/auth.types';
import { fetchAppModules } from '../../features/modules/modules.api';
import type { AppModule } from '../../features/modules/modules.schemas';
import { LAST_ORG_KEY } from '../../routes/OrgRedirect';

/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Nav paths, relative to the organization they belong to. Every tenant-scoped
 * page hangs off `/organizations/:orgId`, so these are suffixes rather than
 * absolute paths — see `navPath` below and app/router.tsx.
 */
const ROUTE_MAP: Record<string, string> = {
  DASHBOARD: '',
  PURCHASES: '/purchases',
  VENDORS: '/purchases/vendors',
  PO: '/purchases/po',
  BILLS: '/purchases/bills',
  ITEMS: '/items',
};

function navPath(moduleCode: string, orgId: string | undefined): string {
  const suffix = ROUTE_MAP[moduleCode];
  if (suffix === undefined || !orgId) return '#';
  return `/organizations/${orgId}${suffix}`;
}

const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard,
  Home,
  ShoppingCart,
  Users,
  FileText,
  Receipt,
};
/* eslint-enable @typescript-eslint/naming-convention */

export function AppLayout() {
  const { user } = useAuth();
  const logoutMutation = useLogout();

  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
  });

  const { data: modules = [] } = useQuery({
    queryKey: ['modules'],
    queryFn: fetchAppModules,
  });

  // The URL is the single source of truth for which organization is active.
  // Previously this was React state mirrored into localStorage, which meant the
  // active org was invisible in the URL, unbookmarkable, and impossible to have
  // two of in two tabs.
  const { orgId: activeOrgId } = useParams<{ orgId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);

  // Remember it only so `/` can send the user back here next visit (OrgRedirect).
  // Not an authorization input: the server re-checks membership on every request.
  useEffect(() => {
    if (activeOrgId) localStorage.setItem(LAST_ORG_KEY, activeOrgId);
  }, [activeOrgId]);

  /**
   * Switching organization is a *navigation*, not a state change: swap the org
   * id in the current path and keep the user on the same page. No manual cache
   * invalidation needed — every tenant query keys on orgId, so React Query
   * refetches on its own. The old code called `queryClient.invalidateQueries()`
   * with no key, nuking every cache in the app including master data.
   */
  const switchOrg = (nextOrgId: string) => {
    const rest = activeOrgId ? location.pathname.replace(`/organizations/${activeOrgId}`, '') : '';
    navigate(`/organizations/${nextOrgId}${rest}`);
  };

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--color-bg)',
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          width: 220,
          background: 'var(--navy-900)',
          color: 'white',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-md)',
          zIndex: 20,
        }}
      >
        <div
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <Logo tone="dark" size={28} />
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
          {modules.map((module) => (
            <ModuleNavGroup
              key={module.id}
              module={module}
              expandedId={expandedModuleId}
              onToggle={(id) => setExpandedModuleId(prev => prev === id ? null : id)}
            />
          ))}
        </nav>

        {activeOrgId && (
          <div style={{ padding: 'var(--space-3)', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <NavLink
              to={`/organizations/${activeOrgId}/settings`}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: '8px 14px',
                borderRadius: 'var(--radius-md)',
                textDecoration: 'none',
                color: isActive ? 'white' : 'rgba(255,255,255,0.7)',
                background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                fontWeight: isActive ? 600 : 500,
                transition: 'all 0.2s ease',
              })}
            >
              <Settings size={18} />
              <span style={{ fontSize: 13 }}>Settings</span>
            </NavLink>
          </div>
        )}
      </aside>

      {/* Main Container */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Topbar */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 16px',
            background: 'white',
            borderBottom: '1px solid var(--color-border)',
            position: 'sticky',
            top: 0,
            zIndex: 50,
          }}
        >
          {/* Global Search */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search..."
              style={{
                padding: '8px 16px',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                fontSize: '13px',
                width: '300px',
                outline: 'none',
                background: '#f8fafc',
                color: '#0f172a'
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <OrgDropdown
              organizations={organizations || []}
              activeOrgId={activeOrgId ?? null}
              onSelectOrg={switchOrg}
            />
            <ProfileDropdown user={user} logoutMutation={logoutMutation} />
          </div>
        </header>

        {/* Page Content */}
        <main style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function ModuleNavGroup({
  module,
  depth = 0,
  expandedId,
  onToggle
}: {
  module: AppModule;
  depth?: number;
  expandedId?: string | null;
  onToggle?: (id: string) => void;
}) {
  const Icon = module.icon && ICON_MAP[module.icon] ? ICON_MAP[module.icon] : FileText;
  const { orgId } = useParams<{ orgId: string }>();
  const to = navPath(module.code, orgId);

  const isParent = module.children && module.children.length > 0;
  const [localExpanded, setLocalExpanded] = useState(false);

  const isExpanded = onToggle ? expandedId === module.id : localExpanded;

  const handleToggle = () => {
    if (onToggle) onToggle(module.id);
    else setLocalExpanded(!localExpanded);
  };

  if (isParent) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
        }}
      >
        <button
          onClick={handleToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px 14px',
            paddingLeft: 14 + depth * 12,
            borderRadius: 'var(--radius-md)',
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.7)',
            fontWeight: 500,
            cursor: 'pointer',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 16,
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            >
              <ChevronRight size={14} />
            </div>
            <Icon size={16} />
            <span style={{ fontSize: 13, marginLeft: 4 }}>{module.name}</span>
          </div>
        </button>

        <div
          style={{
            display: 'grid',
            gridTemplateRows: isExpanded ? '1fr' : '0fr',
            transition: 'grid-template-rows 0.2s ease',
          }}
        >
          <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {module.children?.map((child) => (
              <ModuleNavGroup key={child.id} module={child} depth={depth + 1} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <NavLink
      to={to}
      end={module.code === 'DASHBOARD'}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        padding: '8px 14px',
        paddingLeft: 14 + depth * 12,
        borderRadius: 'var(--radius-md)',
        textDecoration: 'none',
        color: isActive ? 'white' : 'rgba(255,255,255,0.7)',
        background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
        fontWeight: isActive ? 600 : 500,
        transition: 'all 0.2s ease',
      })}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%' }}>
        <div style={{ width: 16 }}></div>
        <Icon size={16} />
        <span style={{ fontSize: 13, marginLeft: 4 }}>{module.name}</span>
      </div>
    </NavLink>
  );
}

function ProfileDropdown({
  user,
  logoutMutation,
}: {
  user: User | null;
  logoutMutation: ReturnType<typeof useLogout>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSignoutDialogOpen, setIsSignoutDialogOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          color: 'var(--color-text)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <UserIcon size={18} />
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            width: 350,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            zIndex: 20,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '16px', position: 'relative' }}>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#ef4444',
              }}
            >
              <X size={16} />
            </button>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '4px',
                  background: '#e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                }}
              >
                <Users size={20} color="white" />
              </div>
              <div>
                <div style={{ fontWeight: 500, fontSize: 14, color: '#1e293b' }}>
                  {user?.fullName || 'User'}
                </div>
                <div style={{ fontSize: 13, color: '#64748b' }}>{user?.email || ''}</div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTop: '1px solid #f1f5f9',
                paddingTop: 16,
              }}
            >
              <button
                onClick={() => {
                  setIsOpen(false);
                  navigate('/profile');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Edit Profile
              </button>
              <button
                onClick={() => {
                  setIsOpen(false);
                  setIsSignoutDialogOpen(true);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={isSignoutDialogOpen}
        title="Sign Out"
        message="Are you sure you want to sign out?"
        confirmText="Sign Out"
        onConfirm={() => {
          setIsSignoutDialogOpen(false);
          logoutMutation.mutate();
        }}
        onCancel={() => setIsSignoutDialogOpen(false)}
      />
    </div>
  );
}

function OrgDropdown({
  organizations,
  activeOrgId,
  onSelectOrg,
}: {
  organizations: Organization[];
  activeOrgId: string | null;
  onSelectOrg: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const activeOrg = organizations?.find((o) => o.id === activeOrgId) || organizations?.[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        title={activeOrg?.name}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          color: 'var(--color-text)',
        }}
      >
        <span>
          {activeOrg?.name
            ? activeOrg.name.length > 15
              ? activeOrg.name.substring(0, 15) + '...'
              : activeOrg.name
            : 'Select Organization'}
        </span>
        <span style={{ fontSize: 10 }}>▼</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            width: 400,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '90vh',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 16px 12px',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Organizations</h3>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Organizations List */}
          <div style={{ padding: '16px 0', overflowY: 'auto' }}>
            <div style={{ padding: '0 16px', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              My Organizations
            </div>

            {organizations?.map((org) => (
              <div
                key={org.id}
                onClick={() => {
                  onSelectOrg(org.id);
                  setIsOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  cursor: 'pointer',
                  background: org.id === activeOrgId ? '#f8fafc' : 'none',
                  borderLeft:
                    org.id === activeOrgId
                      ? '3px solid var(--color-primary)'
                      : '3px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (org.id !== activeOrgId) {
                    e.currentTarget.style.background = 'var(--color-bg)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (org.id !== activeOrgId) {
                    e.currentTarget.style.background = 'none';
                  }
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'white',
                  }}
                >
                  <FileText size={20} color="#94a3b8" />
                </div>
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--color-text)' }}>
                    {org.name}
                  </div>
                </div>
              </div>
            ))}

            {(!organizations || organizations.length === 0) && (
              <div
                style={{
                  padding: '16px',
                  textAlign: 'center',
                  color: 'var(--color-text-muted)',
                  fontSize: 14,
                }}
              >
                No organizations found.
              </div>
            )}
          </div>

          <div
            style={{
              padding: '12px 16px',
              background: 'var(--color-surface)',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <button
              onClick={() => {
                setIsOpen(false);
                navigate('/organizations/new');
              }}
              style={{
                width: '100%',
                padding: '10px',
                background: 'var(--color-primary)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: 14,
              }}
            >
              + Add Organization
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
