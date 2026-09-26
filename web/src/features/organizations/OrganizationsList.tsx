import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { organizationsApi } from './organizations.api';
import type { Organization } from './organizations.schemas';
import { PendingInvitationsPanel } from '../invitations/PendingInvitationsPanel';
import './OrganizationsList.css';

/**
 * The organization picker — where `/` sends anyone whose browser has no remembered
 * organization, and where the switcher links to.
 *
 * 🔴 Rebuilt 2026-08-31. It was written in Tailwind classes against a project that
 * has no Tailwind, so every class resolved to nothing and it rendered as unstyled
 * HTML; and its cards were inert `<div>`s, so the one thing a picker is for could
 * not be done. Both are fixed here — see `OrganizationsList.css`.
 */
export function OrganizationsList() {
  /**
   * 🔴 `useQuery` on the `['organizations']` key, not `useState` + `useEffect`.
   *
   * That key is shared: `OrgRedirect` reads it, and `PendingInvitationsPanel` —
   * rendered directly below — invalidates it after accepting an invitation. With
   * this page holding its own `useState` copy, that invalidation reached nothing,
   * so accepting an invitation left the list beneath it showing the organizations
   * you had a moment ago, missing the one you just joined.
   */
  const {
    data: organizations,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="orgs-page">
      <header className="orgs-head">
        <div>
          <h1 className="orgs-title">Your Organizations</h1>
          <p className="orgs-subtitle">{subtitleFor(organizations, isPending)}</p>
        </div>
        <Link to="/organizations/new" className="orgs-create">
          <Plus size={15} aria-hidden="true" />
          Create Organization
        </Link>
      </header>

      {isError && <div className="orgs-error">{toApiErrorMessage(error)}</div>}

      {/* Invitations addressed to this user. Renders nothing when there are none,
          so it only appears when there is actually something to act on. */}
      <PendingInvitationsPanel />

      {isPending ? (
        // Skeletons rather than "Loading…", so the empty state never flashes first
        // and the header does not jump when the real cards arrive.
        <div className="orgs-grid" aria-busy="true" aria-label="Loading organizations">
          {[0, 1, 2].map((i) => (
            <div key={i} className="orgs-skeleton" />
          ))}
        </div>
      ) : organizations && organizations.length > 0 ? (
        <div className="orgs-grid">
          {organizations.map((org) => (
            <OrganizationCard key={org.organizationId} org={org} />
          ))}
        </div>
      ) : (
        !isError && (
          <div className="orgs-panel">
            <p>You are not a member of any organization yet.</p>
            <Link to="/organizations/new" className="orgs-create">
              <Plus size={15} aria-hidden="true" />
              Create your first organization
            </Link>
          </div>
        )
      )}
    </div>
  );
}

function subtitleFor(organizations: Organization[] | undefined, isPending: boolean): string {
  if (isPending) return 'Loading…';
  const count = organizations?.length ?? 0;
  if (count === 0) return 'Create one to get started, or accept an invitation.';
  return count === 1 ? '1 organization' : `${count} organizations`;
}

/**
 * One organization.
 *
 * `AppLayout` writes `LAST_ORG_KEY` whenever the active organization changes, so
 * simply navigating here is what makes this the org `/` reopens next time — no
 * need to stamp it on the click.
 */
function OrganizationCard({ org }: { org: Organization }) {
  // City and industry are both optional and neither is worth a dangling separator.
  const meta = [org.industry?.name, org.address?.city].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/organizations/${org.organizationId}`}
      className="orgs-card"
      // The heading is the accessible name; the meta line is context, not identity.
      aria-label={`Open ${org.name}`}
    >
      {org.logo_url ? (
        <img className="orgs-avatar" src={org.logo_url} alt="" />
      ) : (
        <span className="orgs-avatar" aria-hidden="true">
          {org.name.trim().charAt(0)}
        </span>
      )}

      <div className="orgs-card-body">
        <h2 className="orgs-name" title={org.name}>
          {org.name}
        </h2>
        {meta && <p className="orgs-meta">{meta}</p>}
        {/* The support code, quietly — it is what a customer reads out on a call. */}
        {org.orgCode && <p className="orgs-code">#{org.orgCode}</p>}
      </div>
    </Link>
  );
}
