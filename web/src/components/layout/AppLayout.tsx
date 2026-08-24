import { useState, useRef, useEffect, Suspense} from 'react';
import { createPortal } from 'react-dom';
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { RouteFallback } from './RouteFallback';
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
  ShoppingBag,
  Receipt,
  Factory,
  ClipboardList,
  Send,
  PackageCheck,
  ChevronRight,
  Plus,
  Copy,
  Check,
} from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useAuth } from '../../providers/auth-context';
import { useLogout } from '../../features/auth/useLogout';
import { organizationsApi } from '../../features/organizations/organizations.api';
import type { Organization } from '../../features/organizations/organizations.schemas';
import type { User } from '../../features/auth/auth.types';
import { fetchAppModules } from '../../features/modules/modules.api';
import type { AppModule } from '../../features/modules/modules.schemas';
import { LAST_ORG_KEY } from '../../routes/OrgRedirect';

import { fetchVendors } from '../../features/purchases/vendors/vendors.api';
import { fetchCustomers } from '../../features/sales/customers/customers.api';
import { itemsApi } from '../../features/items/items.api';
import { fetchJobOrders } from '../../features/jobwork/job-orders/jobOrders.api';
import { fetchJobIssues } from '../../features/jobwork/issues/jobIssues.api';

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
  PURCHASE_ORDERS: '/purchases/purchase-orders',
  SALES: '/sales',
  CUSTOMERS: '/sales/customers',
  ITEMS: '/items',
  COMPOSITE_ITEMS: '/composite-items',
  INVENTORY_MANAGEMENT: '/inventory',
  ASSEMBLY: '/inventory/assembly',
  JOBWORK: '/jobwork',
  // No PROCESSES/ROUTES — both masters live under Settings since 2026-08-10 and
  // are reached from SettingsLayout's nav, not this one.
  JOB_ORDERS: '/jobwork/job-orders',
  ISSUES: '/jobwork/issues',
  RECEIPTS: '/jobwork/receipts',
};

function navPath(moduleCode: string, orgId: string | undefined): string {
  const suffix = ROUTE_MAP[moduleCode];
  if (suffix === undefined || !orgId) return '#';
  return `/organizations/${orgId}${suffix}`;
}

/**
 * 🔴 `ROUTE_MAP` — not the API — decides what this sidebar shows.
 *
 * `app_modules` is master data cached hard: the serialized tree sits in backend
 * instance memory for 6h and the response carries `max-age=3600`, so a row that
 * goes inactive can keep appearing here for an hour after the database says
 * otherwise. Worse, a module with no `ROUTE_MAP` entry renders as a link to '#' —
 * a nav item that looks live and goes nowhere.
 *
 * Filtering here makes the code the source of truth and both problems disappear
 * together. Adding a module still needs its `ROUTE_MAP` entry (as it always did);
 * forgetting one now means the item is simply absent, which is the loud failure.
 * A parent survives on its children — `JOBWORK` keeps its own '/jobwork' entry, so
 * it stays whatever happens to the masters beneath it.
 */
function navigableModules(modules: AppModule[]): AppModule[] {
  return modules.flatMap((module) => {
    const children = navigableModules(module.children ?? []);
    if (ROUTE_MAP[module.code] === undefined && children.length === 0) return [];
    return [{ ...module, children }];
  });
}

const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard,
  Home,
  ShoppingCart,
  ShoppingBag,
  Users,
  FileText,
  Receipt,
  Factory,
  // The jobwork children.
  ClipboardList,
  Send,
  PackageCheck,
};
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Which routes the global search box acts on, and how it labels itself there.
 * The box is one shared input in the top bar; the term travels in the URL as
 * `?search=` and each module's list page reads it — so criteria and results stay
 * per-module while the box stays global. To make a new module searchable, add its
 * path fragment here and have its list page read `?search=`.
 */
interface SearchHit {
  id: string;
  title: string;
  subtitle?: string;
}

interface SearchModule {
  /** Path fragment that marks this module as the active one. */
  match: string;
  label: string;
  /** A few suggestions for the typeahead dropdown, adapted to {id,title,subtitle}. */
  fetch: (orgId: string, term: string) => Promise<SearchHit[]>;
  /** Where clicking a suggestion navigates. */
  to: (orgId: string, id: string) => string;
}

/**
 * One shared box, but context-aware: it searches whichever module you're in. Each
 * entry adapts that module's paginated list endpoint into a common suggestion and
 * knows where a hit navigates. The term also rides the URL as `?search=` so the
 * underlying list filters in step. Add a module here (and have its list read
 * `?search=`) to make it searchable.
 */
const SEARCHABLE_ROUTES: SearchModule[] = [
  {
    match: '/purchases/vendors',
    label: 'Vendors',
    fetch: async (orgId, term) =>
      (await fetchVendors(orgId, { search: term, perPage: 6 })).results.map((v) => ({
        id: v.id,
        title: v.contactName,
        subtitle: v.companyName || v.email || undefined,
      })),
    to: (orgId, id) => `/organizations/${orgId}/purchases/vendors?id=${id}`,
  },
  {
    match: '/sales/customers',
    label: 'Customers',
    fetch: async (orgId, term) =>
      (await fetchCustomers(orgId, { search: term, perPage: 6 })).results.map((c) => ({
        id: c.id,
        title: c.contactName,
        subtitle: c.companyName || c.email || undefined,
      })),
    to: (orgId, id) => `/organizations/${orgId}/sales/customers?id=${id}`,
  },
  {
    match: '/items',
    label: 'Items',
    fetch: async (orgId, term) =>
      (await itemsApi.getItems(orgId, { search: term, perPage: 6 })).results.map((i) => ({
        id: i.id,
        title: i.name,
        subtitle: i.sku ? `SKU: ${i.sku}` : undefined,
      })),
    to: (orgId, id) => `/organizations/${orgId}/items?id=${id}`,
  },
  {
    // No Processes entry: that list moved under Settings, which renders outside
    // this layout and so has no top bar for this box to sit in.
    //
    // Before the bare '/jobwork' rule would ever match — these paths are checked
    // with `includes`, so the more specific entries have to come first.
    match: '/jobwork/job-orders',
    label: 'Job Orders',
    fetch: async (orgId, term) =>
      // `all_orders`, not the default view: someone searching by number wants
      // that job order, and a completed one silently missing reads as deleted.
      (await fetchJobOrders(orgId, { search: term, filter: 'all_orders', perPage: 6 })).results.map(
        (o) => ({
          id: o.id,
          title: o.jobOrderNumber,
          subtitle: o.inputItem?.name ?? undefined,
        }),
      ),
    to: (orgId, id) => `/organizations/${orgId}/jobwork/job-orders/${id}`,
  },
  {
    match: '/jobwork/issues',
    label: 'Challans',
    fetch: async (orgId, term) =>
      (await fetchJobIssues(orgId, { search: term, filter: 'all_issues', perPage: 6 })).results.map(
        (i) => ({
          id: i.id,
          title: i.challanNumber,
          subtitle: i.processorNameSnapshot ?? undefined,
        }),
      ),
    to: (orgId, id) => `/organizations/${orgId}/jobwork/issues?id=${id}`,
  },
];

/** Minimum characters before a search fires — a common standard (2–3) that keeps
 *  single-character queries (huge, useless result sets) off the server. */
const MIN_SEARCH_CHARS = 3;

const dropdownRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  alignItems: 'flex-start',
  width: '100%',
  textAlign: 'left',
  padding: '10px 14px',
  border: 'none',
  borderBottom: '1px solid #f1f5f9',
  background: 'transparent',
  cursor: 'pointer',
};

function GlobalSearch() {
  const location = useLocation();
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);

  const context = SEARCHABLE_ROUTES.find((r) => location.pathname.includes(r.match));
  const [value, setValue] = useState(searchParams.get('search') ?? '');
  const [debounced, setDebounced] = useState(value.trim());
  const [open, setOpen] = useState(false);

  // Re-seed the box only when the *module* changes (or on first load of a
  // bookmarked `?search=` URL). Done during render via a previous-value guard —
  // React's pattern for "reset state when a value changes" — not an effect. We
  // deliberately do NOT mirror the URL back into the input on every keystroke:
  // dropping below the threshold clears the URL param, and a continuous mirror
  // would then wipe what the user is still typing.
  const [prevMatch, setPrevMatch] = useState(context?.match);
  if (context?.match !== prevMatch) {
    setPrevMatch(context?.match);
    setValue(searchParams.get('search') ?? '');
  }

  // Debounce the raw input; `debounced` feeds both the dropdown query and the URL.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 300);
    return () => clearTimeout(t);
  }, [value]);

  // Mirror the term into the URL so the underlying list filters in step. Below the
  // threshold the param is removed. `replace` so searching doesn't stack history.
  useEffect(() => {
    if (!context) return;
    const desired = debounced.length >= MIN_SEARCH_CHARS ? debounced : '';
    if (desired === (searchParams.get('search') ?? '')) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (desired) next.set('search', desired);
        else next.delete('search');
        return next;
      },
      { replace: true },
    );
  }, [debounced, context, searchParams, setSearchParams]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const canSearch = Boolean(context) && debounced.length >= MIN_SEARCH_CHARS;

  // Suggestions for the dropdown — a small page fetched only while it's open.
  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['global-search', context?.match, orgId, debounced],
    queryFn: () => context!.fetch(orgId!, debounced),
    enabled: canSearch && open && Boolean(orgId),
    placeholderData: (prev) => prev,
  });

  const disabled = !context;
  const showDropdown = open && canSearch;

  const selectHit = (id: string) => {
    setOpen(false);
    setValue('');
    if (context && orgId) navigate(context.to(orgId, id));
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: 320 }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Search
          size={16}
          color="#94a3b8"
          style={{ position: 'absolute', left: 12, pointerEvents: 'none' }}
        />
        <input
          type="text"
          value={value}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={context ? `Search in ${context.label}...` : 'Search...'}
          title={disabled ? 'Open a list to search' : undefined}
          style={{
            padding: '8px 16px 8px 34px',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            fontSize: '13px',
            width: '100%',
            outline: 'none',
            background: disabled ? '#f1f5f9' : '#f8fafc',
            color: disabled ? '#94a3b8' : '#0f172a',
          }}
        />
      </div>

      {showDropdown && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            zIndex: 60,
            overflow: 'hidden',
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {isFetching && hits.length === 0 ? (
            <div style={{ padding: '12px 14px', fontSize: 13, color: '#64748b' }}>Searching…</div>
          ) : hits.length === 0 ? (
            <div style={{ padding: '12px 14px', fontSize: 13, color: '#64748b' }}>
              No {context!.label.toLowerCase()} match “{debounced}”.
            </div>
          ) : (
            hits.map((hit) => (
              <button
                key={hit.id}
                onClick={() => selectHit(hit.id)}
                style={dropdownRowStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>{hit.title}</span>
                {hit.subtitle && (
                  <span style={{ fontSize: 12, color: '#64748b' }}>{hit.subtitle}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const { user } = useAuth();
  const logoutMutation = useLogout();

  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
  });

  const { data: fetchedModules = [] } = useQuery({
    queryKey: ['modules'],
    queryFn: fetchAppModules,
  });
  const modules = navigableModules(fetchedModules);

  // The URL is the single source of truth for which organization is active.
  // Previously this was React state mirrored into localStorage, which meant the
  // active org was invisible in the URL, unbookmarkable, and impossible to have
  // two of in two tabs.
  const { orgId: activeOrgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);

  const isSidebarCollapsed = location.pathname.endsWith('/opening-stock');

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
  const rememberedOrgId = localStorage.getItem(LAST_ORG_KEY);
  const effectiveOrgId = activeOrgId || rememberedOrgId || organizations?.[0]?.organizationId;

  const switchOrg = (nextOrgId: string) => {
    if (!activeOrgId) {
      navigate(`/organizations/${nextOrgId}`);
      return;
    }
    const nextPath = location.pathname.replace(
      `/organizations/${activeOrgId}`,
      `/organizations/${nextOrgId}`,
    );
    navigate(nextPath);
  };

  const activeOrg =
    organizations?.find((o) => o.organizationId === effectiveOrgId) || organizations?.[0];

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
          width: isSidebarCollapsed ? 72 : 220,
          transition: 'width 0.3s ease',
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
            height: '50px',
            boxSizing: 'border-box',
            padding: '0 var(--space-4)',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {activeOrg?.logo_url ? (
            <img
              src={activeOrg.logo_url}
              alt={activeOrg.name}
              style={{
                maxWidth: isSidebarCollapsed ? 40 : 190,
                maxHeight: 40,
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                display: 'block',
                transition: 'max-width 0.3s ease',
              }}
            />
          ) : activeOrg?.name ? (
            <span
              style={{
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 16,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: isSidebarCollapsed ? 'none' : 'block',
              }}
            >
              {isSidebarCollapsed ? activeOrg.name.charAt(0) : activeOrg.name}
            </span>
          ) : null}
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
              onToggle={(id) => setExpandedModuleId((prev) => (prev === id ? null : id))}
              isSidebarCollapsed={isSidebarCollapsed}
            />
          ))}
        </nav>

        {effectiveOrgId && (
          <div
            style={{
              height: isSidebarCollapsed ? '50px' : '44px',
              boxSizing: 'border-box',
              padding: isSidebarCollapsed ? '0 8px' : '0 var(--space-3)',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: isSidebarCollapsed ? 'center' : 'flex-start'
            }}
          >
            <NavLink
              to={`/organizations/${effectiveOrgId}/settings`}
              style={({ isActive }) => ({
                width: '100%',
                display: 'flex',
                flexDirection: isSidebarCollapsed ? 'column' : 'row',
                alignItems: 'center',
                justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                gap: isSidebarCollapsed ? '4px' : 'var(--space-3)',
                padding: isSidebarCollapsed ? '8px 4px' : '6px 14px',
                borderRadius: 'var(--radius-md)',
                textDecoration: 'none',
                color: isActive ? 'white' : 'rgba(255,255,255,0.7)',
                background: isActive ? '#186337' : 'transparent',
                fontWeight: isActive ? 600 : 500,
                transition: 'all 0.2s ease',
              })}
            >
              <Settings size={isSidebarCollapsed ? 22 : 18} />
              {!isSidebarCollapsed && <span style={{ fontSize: 13 }}>Settings</span>}
            </NavLink>
          </div>
        )}
      </aside>

      {/* Main Container */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Topbar */}
        <header
          style={{
            height: '50px',
            boxSizing: 'border-box',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0 20px',
            background: 'white',
            borderBottom: '1px solid var(--color-border)',
            position: 'sticky',
            top: 0,
            zIndex: 50,
          }}
        >
          {/* Global Search — one box, context-aware per module (see GlobalSearch) */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <GlobalSearch />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <OrgDropdown
              organizations={organizations || []}
              activeOrgId={effectiveOrgId ?? null}
              onSelectOrg={switchOrg}
            />
            <ProfileDropdown
              user={user}
              logoutMutation={logoutMutation}
              activeOrgCode={activeOrg?.orgCode}
            />
          </div>
        </header>

        {/* Page Content. Suspense sits INSIDE <main> so a route chunk still
            loading swaps only this area — the sidebar and header stay on screen.
            Every page under this layout is lazy (see app/router.tsx). */}
        <main style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function ModuleNavGroup({
  module,
  depth = 0,
  expandedId,
  onToggle,
  isSidebarCollapsed,
}: {
  module: AppModule;
  depth?: number;
  expandedId?: string | null;
  onToggle?: (id: string) => void;
  isSidebarCollapsed?: boolean;
}) {
  const Icon = module.icon && ICON_MAP[module.icon] ? ICON_MAP[module.icon] : FileText;
  const { orgId } = useParams<{ orgId: string }>();
  const effectiveOrgId = orgId || localStorage.getItem(LAST_ORG_KEY) || undefined;
  const to = navPath(module.code, effectiveOrgId);

  const isParent = module.children && module.children.length > 0;

  // States for old accordion
  const [localExpanded, setLocalExpanded] = useState(false);
  const [expandedChildId, setExpandedChildId] = useState<string | null>(null);
  const isExpanded = onToggle ? expandedId === module.id : localExpanded;

  const handleToggle = () => {
    if (onToggle) onToggle(module.id);
    else setLocalExpanded(!localExpanded);
  };

  // States for new flyout
  const [isHovered, setIsHovered] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const handleMouseEnter = (e: React.MouseEvent) => {
    setIsHovered(true);
    setRect(e.currentTarget.getBoundingClientRect());
  };
  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  if (!isSidebarCollapsed) {
    // --- OLD ACCORDION STYLE ---
    if (isParent) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <button
            onClick={handleToggle}
            className="sidebar-nav-link"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 14px',
              paddingLeft: 14 + depth * 12,
              borderRadius: 'var(--radius-md)',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.7)',
              fontWeight: 500,
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
              transition: 'background-color 0.2s ease',
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
              {depth === 0 && <Icon size={16} />}
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
                <ModuleNavGroup
                  key={child.id}
                  module={child}
                  depth={depth + 1}
                  expandedId={expandedChildId}
                  onToggle={(id) => setExpandedChildId((prev) => (prev === id ? null : id))}
                  isSidebarCollapsed={false}
                />
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
        className="sidebar-nav-link"
        style={({ isActive }) => ({
          display: 'flex',
          alignItems: 'center',
          padding: '8px 14px',
          paddingLeft: 14 + depth * 12,
          justifyContent: 'flex-start',
          borderRadius: 'var(--radius-md)',
          textDecoration: 'none',
          color: isActive ? 'white' : 'rgba(255,255,255,0.7)',
          background: isActive ? '#186337' : 'transparent',
          fontWeight: isActive ? 600 : 500,
          transition: 'all 0.2s ease',
        })}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%', justifyContent: 'flex-start' }}>
          <div style={{ width: 16 }}></div>
          {depth === 0 && <Icon size={16} />}
          <span style={{ fontSize: 13, marginLeft: 4 }}>{module.name}</span>
        </div>
      </NavLink>
    );
  }

  // --- NEW ZOHO-STYLE COMPACT FLYOUT (when isSidebarCollapsed is true) ---
  if (depth > 0) {
    return (
      <NavLink
        to={to}
        end={module.code === 'DASHBOARD'}
        style={({ isActive }) => ({
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          textDecoration: 'none',
          color: isActive ? '#fff' : '#cbd5e1',
          background: isActive ? '#186337' : 'transparent',
          fontSize: '13px',
          fontWeight: 500,
          transition: 'all 0.2s ease',
          borderRadius: '4px',
          margin: '0 8px 4px 8px',
        })}
        onMouseEnter={(e) => {
          if (e.currentTarget.style.background !== '#186337') {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
          }
        }}
        onMouseLeave={(e) => {
          if (e.currentTarget.style.background !== '#186337') {
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        {({ isActive }) => (
          <>
            <span>{module.name}</span>
            {isActive && <Plus size={14} color="#fff" />}
          </>
        )}
      </NavLink>
    );
  }

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ position: 'relative' }}
    >
      <NavLink
        to={isParent ? '#' : to}
        end={module.code === 'DASHBOARD'}
        onClick={(e) => {
           if (isParent) e.preventDefault();
        }}
        style={({ isActive }) => ({
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '10px 4px',
          gap: '4px',
          borderRadius: 'var(--radius-md)',
          textDecoration: 'none',
          color: (isActive && !isParent) || isHovered ? 'white' : 'rgba(255,255,255,0.7)',
          background: (isActive && !isParent) ? '#186337' : isHovered ? 'rgba(255,255,255,0.08)' : 'transparent',
          transition: 'all 0.2s ease',
        })}
      >
        <Icon size={20} />
        <span style={{ fontSize: '11px', fontWeight: 500, textAlign: 'center', lineHeight: 1.2 }}>
          {module.name}
        </span>
      </NavLink>

      {isParent && isHovered && rect && createPortal(
        <div
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={handleMouseLeave}
          style={{
            position: 'fixed',
            top: Math.max(10, Math.min(rect.top, window.innerHeight - (module.children!.length * 40 + 40))),
            left: rect.right + 8,
            width: '200px',
            background: '#1e293b',
            borderRadius: '6px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            padding: '8px 0',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <div style={{ padding: '4px 16px 8px', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            {module.name}
          </div>
          {module.children!.map((child) => (
            <ModuleNavGroup key={child.id} module={child} depth={depth + 1} isSidebarCollapsed={true} />
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function TopBarAvatar({ user, size }: { user: User; size: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  const url = !imgFailed ? user.avatarUrl : null;
  const iconSize = size === 32 ? 18 : 28;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {!url && (
        <UserIcon size={iconSize} color={size === 32 ? 'inherit' : 'var(--color-text-secondary)'} />
      )}
      {url && (
        <img
          src={url}
          alt={user.fullName}
          onError={() => setImgFailed(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        />
      )}
    </div>
  );
}

function ProfileDropdown({
  user,
  logoutMutation,
  activeOrgCode,
}: {
  user: User | null;
  logoutMutation: ReturnType<typeof useLogout>;
  activeOrgCode?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSignoutDialogOpen, setIsSignoutDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
          overflow: 'hidden',
        }}
      >
        {user ? <TopBarAvatar user={user} size={32} /> : <UserIcon size={18} />}
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 12px)',
            right: -8,
            width: 340,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            zIndex: 50,
            padding: '20px',
            animation: 'slideInRightProfile 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            transformOrigin: 'top right',
          }}
        >
          <style>
            {`
              @keyframes slideInRightProfile {
                from { opacity: 0; transform: translateX(30px); }
                to { opacity: 1; transform: translateX(0); }
              }
            `}
          </style>

          <div
            style={{
              position: 'absolute',
              top: -6,
              right: 18,
              width: 12,
              height: 12,
              background: 'var(--color-surface)',
              borderTop: '1px solid var(--color-border)',
              borderLeft: '1px solid var(--color-border)',
              transform: 'rotate(45deg)',
            }}
          />

          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
          >
            <div style={{ display: 'flex', gap: 16 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {user ? (
                  <TopBarAvatar user={user} size={56} />
                ) : (
                  <UserIcon size={28} color="var(--color-text-secondary)" />
                )}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 500,
                    color: 'var(--color-text)',
                    marginBottom: 2,
                  }}
                >
                  {user?.fullName}
                </div>
                <div style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  {user?.email}
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-danger)',
                padding: 4,
              }}
            >
              <X size={18} />
            </button>
          </div>

          <div
            style={{
              marginTop: 16,
              fontSize: 14,
              color: 'var(--color-text-secondary)',
              borderBottom: '1px solid var(--color-border)',
              paddingBottom: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              Organization Code:{' '}
              <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>
                {activeOrgCode || 'N/A'}
              </span>
            </div>
            {activeOrgCode && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(activeOrgCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                title="Copy Organization Code"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: copied ? 'var(--color-success, #10b981)' : 'var(--color-text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 4,
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              onClick={() => {
                setIsOpen(false);
                setIsSignoutDialogOpen(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'none',
                border: 'none',
                color: 'var(--color-danger)',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
                padding: '4px 8px',
              }}
            >
              <LogOut size={16} /> Sign Out
            </button>
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
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [copiedOrgId, setCopiedOrgId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const rememberedOrgId = localStorage.getItem(LAST_ORG_KEY);
  const effectiveOrgId = activeOrgId || rememberedOrgId;
  const activeOrg =
    organizations?.find((o) => o.organizationId === effectiveOrgId) || organizations?.[0];

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
          gap: 8,
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
            top: 'calc(100% + 12px)',
            right: -56,
            width: 400,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '90vh',
            overflow: 'hidden',
            animation: 'slideInRightOrg 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            transformOrigin: 'top right',
          }}
        >
          <style>
            {`
              @keyframes slideInRightOrg {
                from { opacity: 0; transform: translateX(30px); }
                to { opacity: 1; transform: translateX(0); }
              }
            `}
          </style>

          {/* Caret pointing to Org button */}
          <div
            style={{
              position: 'absolute',
              top: -6,
              right: 76,
              width: 12,
              height: 12,
              background: 'var(--color-surface)',
              borderTop: '1px solid var(--color-border)',
              borderLeft: '1px solid var(--color-border)',
              transform: 'rotate(45deg)',
            }}
          />

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
                key={org.organizationId}
                onClick={() => {
                  onSelectOrg(org.organizationId);
                  setIsOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  cursor: 'pointer',
                  background: org.organizationId === activeOrgId ? '#f8fafc' : 'none',
                  borderLeft:
                    org.organizationId === activeOrgId
                      ? '3px solid var(--color-primary)'
                      : '3px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (org.organizationId !== activeOrgId) {
                    e.currentTarget.style.background = 'var(--color-bg)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (org.organizationId !== activeOrgId) {
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
                    overflow: 'hidden',
                  }}
                >
                  {org.logo_url ? (
                    <img
                      src={org.logo_url}
                      alt={org.name}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <FileText size={20} color="#94a3b8" />
                  )}
                </div>
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--color-text)' }}>
                      {org.name}
                    </div>
                    {/* The support code, labelled. A bare ten-digit number under an
                        org name reads as an account number, a GST number, or a
                        phone number — the label is what makes it answerable when
                        support asks for it. Digits are monospaced because they get
                        read aloud rather than clicked. */}
                    {org.orgCode && (
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: 11,
                          color: 'var(--color-text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <div>
                          Organization Code:{' '}
                          <span
                            style={{
                              fontFamily:
                                'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                              letterSpacing: '0.03em',
                            }}
                          >
                            {org.orgCode}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(org.orgCode || '');
                            setCopiedOrgId(org.organizationId);
                            setTimeout(() => setCopiedOrgId(null), 2000);
                          }}
                          title="Copy Organization Code"
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color:
                              copiedOrgId === org.organizationId
                                ? 'var(--color-success, #10b981)'
                                : 'var(--color-text-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            padding: 2,
                            borderRadius: 'var(--radius-sm)',
                          }}
                        >
                          {copiedOrgId === org.organizationId ? (
                            <Check size={12} />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>
                    )}
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
