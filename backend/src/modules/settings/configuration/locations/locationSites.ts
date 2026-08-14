import type { TenantClient } from '../../../../db/prisma.ts';

/**
 * 🔴 WHAT COUNTS AS ONE PREMISES — derived, never configured (2026-08-14).
 *
 * A job-work challan under GST Rule 55 carries ONE dispatched-from address, so
 * whether two godowns may appear on one challan is a question about the physical
 * site, not a preference. Customers differ: one models racks and floors inside a
 * single compound, the next models genuinely separate branches, and plenty have
 * both. A setting would push that question onto every customer and get answered
 * wrong by most of them.
 *
 * It does not need asking, because it is already recorded. `Location.parentId` is
 * the hierarchy the customer built when they set the place up, so:
 *
 *   DISPATCH SITE = the root of a location's ancestor chain.
 *
 * Two locations may share a challan iff they resolve to the same site. Racks under
 * one "Head Office" share an address, so one challan is honest. "Head Office" and
 * "Uttran Branch" as separate roots are separate addresses, so they need a challan
 * each — which is what the law wanted anyway.
 *
 * 🔴 THE SAFE DEGENERATE CASE, and the reason this is shippable: a flat setup with
 * no parents makes every location its own root, so every existing organization
 * behaves exactly as it did before this file existed. Nobody is upgraded into a
 * surprise, and a customer who wants challans to span their godowns gets there by
 * setting a parent — data entry, not a support ticket.
 *
 * ⚠️ Addresses are deliberately NOT compared. Two typos would split one site in
 * two and the failure would be silent; the parent link is explicit and visible on
 * screen.
 */

/** Every location in the org, as `id → parentId`. One read: an org has tens of
 * locations, not thousands, and walking them in memory beats a recursive CTE per
 * lookup. */
async function parentMap(tx: TenantClient, organizationId: string) {
  const rows = await tx.location.findMany({
    where: { organizationId, isDeleted: false },
    select: { id: true, parentId: true },
  });
  return new Map(rows.map((row) => [row.id, row.parentId]));
}

/** Walk to the root. Depth-capped so a cycle — which `parentId` does not forbid —
 * cannot hang a request; a cycle has no root, so the entry point is the honest
 * answer for it. */
function rootOf(locationId: string, parents: Map<string, string | null>): string {
  const seen = new Set<string>([locationId]);
  let current = locationId;

  for (;;) {
    const parent = parents.get(current);
    if (!parent || seen.has(parent)) return current;
    seen.add(parent);
    current = parent;
  }
}

export interface DispatchSite {
  /** The root location. Its address is what the challan prints. */
  siteId: string;
  /** Every location that dispatches under it, the root included. These are the
   * godowns one challan may draw from. */
  locationIds: string[];
}

/**
 * The site a location belongs to, with every other location that shares it.
 *
 * `locationIds` is what the availability query is scoped to — not the single
 * location the user picked — so the picker offers the whole site's stock and FIFO
 * can reach older material sitting in the next rack.
 */
export async function resolveDispatchSite(
  tx: TenantClient,
  organizationId: string,
  locationId: string,
): Promise<DispatchSite> {
  const parents = await parentMap(tx, organizationId);
  const siteId = rootOf(locationId, parents);

  const locationIds = [...parents.keys()].filter((id) => rootOf(id, parents) === siteId);
  // A location the map does not know (soft-deleted since the dialog opened) still
  // belongs to its own challan rather than vanishing from it.
  if (!locationIds.includes(locationId)) locationIds.push(locationId);

  return { siteId, locationIds };
}
