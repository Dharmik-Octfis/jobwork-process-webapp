import { runAsTenant } from '../../../../db/prisma.ts';
import {
  cacheDelete,
  cacheGetJson,
  cacheSetJson,
  tenantCacheKey,
} from '../../../../lib/catalystCache.ts';
import { createMemoryCache } from '../../../../lib/memoryCache.ts';

/**
 * The permission template body, cached for the request path.
 *
 * WHAT IS CACHED, AND — MORE IMPORTANTLY — WHAT IS NOT
 * `tenantContext` resolves a caller's permissions from two independent reads:
 *
 *   A. the membership  → { isOwner, permissionTemplateId }   ← stays LIVE
 *   B. the template    → { grantsAllPermissions, permissions } ← cached here
 *
 * The resolved `Set` is a pure function of those two, so it is rebuilt in memory
 * on every request and **never cached**. That split is deliberate:
 *
 *  - Read A is one index probe on `@@unique([userId, organizationId])`, outside
 *    any transaction. It is already cheap, and it is the security-critical half:
 *    caching it would break the guarantee that removing a member takes effect
 *    immediately on every device (CLAUDE.md).
 *  - Read B costs a whole `runAsTenant` — BEGIN, set_config, SELECT, COMMIT —
 *    four sequential round trips to RDS in another cloud, holding one of only
 *    five pool connections, on every request. That is the expensive half, and
 *    template bodies change roughly never.
 *
 * Reassigning a member to a different template needs no invalidation at all: the
 * new `permissionTemplateId` comes from read A, so the next request simply looks
 * up a different key. Only *editing* a template needs the delete below.
 *
 * Owners never reach this module — `resolvePermissions` short-circuits on
 * `membership.isOwner` before a template id is even considered.
 *
 * TWO LAYERS
 *  - **L1 (memory, 30s):** per-instance, so a delete only clears the local copy.
 *    The TTL is therefore the true staleness bound for a permission *revocation*
 *    on other instances. 30 seconds is chosen to be short enough to state
 *    plainly: a revoked permission can survive up to half a minute on instances
 *    other than the one that processed the edit.
 *  - **L2 (Catalyst Cache, 1h):** shared fleet-wide, and `cacheDelete` clears it
 *    for everyone at once. One hour is the *backstop* — the floor this service
 *    allows — covering only a delete that never ran (crash mid-request, a row
 *    changed directly in psql, a migration).
 */

export interface TemplateBody {
  grantsAllPermissions: boolean;
  permissions: string[];
}

/** See the L1 note above — this is the staleness bound on other instances. */
const L1_TTL_MS = 30 * 1000;
/** Catalyst Cache accepts whole hours only; 1 is its floor. */
const L2_TTL_HOURS = 1;

/**
 * Bounded so a large tenant base cannot grow this without limit. Entries are
 * ~100 bytes, so 2000 is well under a megabyte and covers far more concurrent
 * (org, template) pairs than one short-lived instance will see.
 */
const l1 = createMemoryCache<TemplateBody | null>({ ttlMs: L1_TTL_MS, maxEntries: 2000 });

function keyFor(organizationId: string, templateId: string): string {
  // Tenant-scoped by construction. The org id is redundant with the template
  // uuid in the happy path and that is the point: a cache has no RLS beneath it,
  // so the key is its only isolation. A wrong org yields a miss, never another
  // tenant's permissions.
  return tenantCacheKey(organizationId, 'perm:tpl', templateId);
}

/**
 * Read one template's body, preferring L1, then L2, then Postgres.
 *
 * Returns `null` when the template does not exist or was soft-deleted, which
 * `resolvePermissions` turns into an empty permission set — failing closed.
 */
export async function getTemplateBody(
  organizationId: string,
  templateId: string,
): Promise<TemplateBody | null> {
  const key = keyFor(organizationId, templateId);

  // L1 — `null` is a cached negative, so distinguish it from "absent".
  const local = l1.get(key);
  if (local !== undefined) return local;

  // L2 — shared. Failures surface as a miss (lib/catalystCache.ts fails soft),
  // so a Catalyst outage degrades to the query below rather than to a 500.
  const shared = await cacheGetJson<TemplateBody>(key);
  if (shared) {
    l1.set(key, shared);
    return shared;
  }

  const row = await runAsTenant(organizationId, (tx) =>
    tx.permissionTemplate.findFirst({
      where: { id: templateId, organizationId, isDeleted: false },
      select: { grantsAllPermissions: true, permissions: true },
    }),
  );

  // Store the RAW row, never the `withImpliedRead` expansion. The expansion is
  // derived from the code catalog (`permissions.catalog.ts`), so caching it
  // would let a stale entry outlive the release that changed the derivation
  // rules — serving stale *logic*, not merely stale data. Cache the fact,
  // recompute the derivation.
  if (row) {
    l1.set(key, row);
    await cacheSetJson(key, row, L2_TTL_HOURS);
    return row;
  }

  // Negative result: cached in L1 only. A membership pointing at a deleted
  // template would otherwise re-query on every single request forever, and an
  // hour of negative caching in L2 is not worth the recovery risk.
  l1.set(key, null);
  return null;
}

/**
 * 🔴 Call on **every** write to a permission template. This — not the TTL — is
 * what keeps permissions correct; the TTL only covers a delete that never ran.
 *
 * Clears L2 for the whole fleet and L1 for this instance. Other instances keep
 * their L1 copy for up to `L1_TTL_MS`.
 */
export async function invalidateTemplate(
  organizationId: string,
  templateId: string,
): Promise<void> {
  const key = keyFor(organizationId, templateId);
  l1.delete(key);
  await cacheDelete(key);
}

/** Drop this instance's L1 entirely. For tests. */
export function clearTemplateCacheL1(): void {
  l1.clear();
}
