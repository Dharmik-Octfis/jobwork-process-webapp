import { prisma } from '../db/prisma.ts';
import { cacheDelete, cacheGetJson, cacheSetJson, tenantCacheKey } from './catalystCache.ts';
import { createMemoryCache } from './memoryCache.ts';

/**
 * One organization's `userId → display name` directory: the single place
 * `createdBy` / `updatedBy` becomes a name a human can read.
 *
 * WHY A DIRECTORY AND NOT A JOIN
 * The audit columns are FKs to `users.id`, but since 2026-07-30 the name shown
 * inside an org lives on `memberships`. Rendering "Modified by" therefore needs a
 * `(organizationId, userId) → memberships` lookup on every list screen in the app.
 * Doing that as a per-row join would mean:
 *   - a hand-written `organizationId` filter in every module's query, on a table
 *     with NO RLS policy (CLAUDE.md: `memberships` is deliberately un-gated) —
 *     i.e. N copies of the one filter that stands between tenants, and
 *   - a cost paid on every request forever, because a per-row join cannot be cached.
 * A per-org directory is one filter to review and, being tiny and near-static, is
 * the most cacheable object in the app. Load it once, map ids to names in memory.
 *
 * NOT `runAsTenant`. `memberships` carries no RLS policy, so this is a plain
 * indexed probe outside any transaction — exactly like `tenantContext`'s own
 * membership read. That matters: a `runAsTenant` here would cost BEGIN +
 * set_config + SELECT + COMMIT (four sequential round trips) and hold one of only
 * five pool connections. Because it needs no tenant context it can also run
 * concurrently with the caller's tenant query:
 *
 *   const [rows, dir] = await Promise.all([listVendors(orgId, q), getMemberDirectory(orgId)]);
 *
 * 🔴 `organizationId` in the `where` below is the ONLY thing keeping this
 * tenant-safe. There is no RLS beneath it and no second layer to catch a mistake.
 * Do not add a parameter that could make it optional.
 *
 * CACHING — display names only, never authorization. Contrast
 * `permissionTemplates.cache.ts`, which refuses to cache the membership row
 * because that would delay member removal. Nothing here gates access: the worst a
 * stale entry does is show yesterday's spelling of a name for up to 30 seconds.
 */

/** Matches `permissionTemplates.cache.ts` — the staleness bound on other instances. */
const L1_TTL_MS = 30 * 1000;
/** Catalyst Cache accepts whole hours only; 1 is its floor. */
const L2_TTL_HOURS = 1;

/** ~60 bytes per member, so a few hundred orgs of a few hundred people each. */
const l1 = createMemoryCache<DirectoryEntry[]>({ ttlMs: L1_TTL_MS, maxEntries: 500 });

interface DirectoryEntry {
  userId: string;
  fullName: string;
  /** True for someone who has left the org. Still listed — see the note below. */
  hasLeft: boolean;
}

/** What a caller gets: a lookup, not a list. */
export interface MemberDirectory {
  /** The org-scoped name for `userId`, or null if they are not (and never were) a
   * member here. Prefer `resolveActorName` — it handles the null cases. */
  nameFor(userId: string | null | undefined): string | null;
  /** Ready-made attribution string for an audit column. Never blank. */
  actorName(userId: string | null | undefined): string;
}

/**
 * Attribution for a write whose actor is not a member of this organization.
 *
 * 🔴 Never fall back to `users.fullName` here. A support engineer fixing a row
 * would surface their real name inside a customer's tenant — confusing for the
 * customer and a needless disclosure of our own staff. See the resolution ladder
 * in `actorName` below.
 */
const OUT_OF_ORG_LABEL = 'Support';
/** No actor at all: migrations, `seed.ts`, self-signup, or a deleted user row
 * (the audit FKs are `onDelete: SetNull`, so those become NULL). */
const NO_ACTOR_LABEL = 'System';

function keyFor(organizationId: string): string {
  // Tenant-scoped by construction. A cache has no RLS beneath it, so the key is
  // its only isolation: a wrong org id yields a miss, never another org's names.
  return tenantCacheKey(organizationId, 'members', 'directory');
}

/**
 * Load one org's directory from Postgres.
 *
 * 🔴 No `isDeleted: false` filter, and that is deliberate — it is the one read of
 * `memberships` in the codebase that must NOT apply the soft-delete rule from
 * CLAUDE.md. Rows created by someone who has since left the organization still
 * have to render their name; filtering them out would make every such row read
 * "Support", which looks like data corruption. The Users *list* filters to current
 * members; this attribution directory does not. Do not "fix" the missing filter.
 */
async function loadDirectory(organizationId: string): Promise<DirectoryEntry[]> {
  const rows = await prisma.membership.findMany({
    where: { organizationId },
    select: { userId: true, fullName: true, isDeleted: true },
  });

  return rows.map((r) => ({ userId: r.userId, fullName: r.fullName, hasLeft: r.isDeleted }));
}

/**
 * This org's attribution directory, preferring L1, then L2, then Postgres.
 *
 * Safe to call once per request from any serializer; on an L1 hit it costs no
 * query and no round trip.
 */
export async function getMemberDirectory(organizationId: string): Promise<MemberDirectory> {
  const key = keyFor(organizationId);

  let entries = l1.get(key);

  if (entries === undefined) {
    // L2 is shared fleet-wide. `catalystCache` fails soft, so a Catalyst outage
    // degrades to the query below rather than to a 500.
    const shared = await cacheGetJson<DirectoryEntry[]>(key);
    if (shared) {
      entries = shared;
      l1.set(key, shared);
    } else {
      entries = await loadDirectory(organizationId);
      l1.set(key, entries);
      await cacheSetJson(key, entries, L2_TTL_HOURS);
    }
  }

  const byUserId = new Map(entries.map((e) => [e.userId, e.fullName]));

  return {
    nameFor: (userId) => (userId ? (byUserId.get(userId) ?? null) : null),

    /**
     * The resolution ladder, in order:
     *
     *   1. no actor recorded            → "System"
     *   2. a member of this org         → their per-org name (current OR former)
     *   3. a real user, but not a member → "Support", never their account name
     *
     * Case 3 should be rare, so it is logged: an id we expected renders quietly,
     * one we did not shows up in the logs instead of living forever as a dash in
     * the UI. It also means something wrote to tenant data without going through
     * `tenantContext` — which is worth knowing regardless of the name it renders.
     */
    actorName: (userId) => {
      if (!userId) return NO_ACTOR_LABEL;
      const name = byUserId.get(userId);
      if (name) return name;
      console.warn(
        '[memberDirectory] unresolvable actor on tenant data',
        JSON.stringify({ organizationId, userId }),
      );
      return OUT_OF_ORG_LABEL;
    },
  };
}

/**
 * 🔴 Call after EVERY write that changes who is in an org or what they are
 * called: invite accept, member rename, deactivate, remove, rejoin.
 *
 * This — not the TTL — is what keeps attribution current. Clears L2 for the whole
 * fleet and L1 for this instance; other instances keep their L1 copy for up to
 * `L1_TTL_MS`, which is the true staleness bound for a rename.
 */
export async function invalidateMemberDirectory(organizationId: string): Promise<void> {
  const key = keyFor(organizationId);
  l1.delete(key);
  await cacheDelete(key);
}

/** Drop this instance's L1 entirely. For tests. */
export function clearMemberDirectoryL1(): void {
  l1.clear();
}

/**
 * `first` + `last` → the stored `full_name`. The ONLY place that concatenation
 * happens, on both `memberships` and `users`, so the denormalized column can
 * never disagree with its parts. Never accept `fullName` from a client.
 */
export function composeFullName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}
