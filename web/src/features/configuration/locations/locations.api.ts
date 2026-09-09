import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';

export interface Location {
  id: string;
  organizationId: string;
  type: string;
  name: string;
  parentId: string | null;
  logo: string | null;
  street1: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
  addressString: string | null;
  isPrimary: boolean;
}

export type CreateLocationData = Omit<Location, 'id' | 'organizationId' | 'addressString'>;
export type UpdateLocationData = Partial<CreateLocationData>;

/**
 * 🔴 LOCATION TYPES THAT ARE NOT OUR PREMISES — the client's copy of the
 * server's `EXTERNAL_LOCATION_TYPES` (`backend/.../jobwork.types.ts`), which
 * stays the source of truth for anything the ledger decides.
 *
 * A `processor` row stands for somebody else's shed. It exists because goods at
 * a jobworker are our stock at THEIR location (domain §5.4) — that is what makes
 * "stock lying with processors" a plain ledger query — and it is auto-created the
 * first time material is issued to that vendor, so these rows appear without
 * anyone adding them.
 *
 * Which means: they are real locations for the LEDGER and wrong answers for a
 * PERSON being asked "where shall I put this?". Every picker that means one of
 * our own godowns filters with `isOwnLocation`. Defined here, beside the type it
 * tests, because it is now asked across items, purchases, inventory and settings
 * — and three copies of a list is three chances for one of them to be widened.
 *
 * ⚠️ The jobwork screens are the exception and must NOT use this: an issue may
 * be raised FROM a processor's location (processor-to-processor is a real move)
 * and a receipt may land goods at the one the challan already put them in.
 */
export const EXTERNAL_LOCATION_TYPES: readonly string[] = [
  'processor',
  'in_transit',
  'customer_site',
];

/** Somewhere we hold — a godown, a branch, a shop floor, a work centre. */
export function isOwnLocation(location: { type?: string | null }): boolean {
  return !EXTERNAL_LOCATION_TYPES.includes(location.type ?? '');
}

/**
 * 🔴 THE TWO SIDES OF A LOCATION PICKER — the same line `isOwnLocation` draws,
 * named for the person reading it: one of OUR places, or the shed of the vendor
 * currently holding the goods.
 *
 * ⚠️ It is a way of SPLITTING one list for display, not a second field. Both
 * sides resolve to one `Location`, and what any form saves is still a single
 * location id — a `processor` row is a location, not a rival kind of thing (see
 * the note above, and domain §5.4). Lives here rather than beside the radio
 * because it is vocabulary about locations, and the jobwork Issue and Receive
 * forms must not drift apart on which word means which side.
 */
export type LocationKind = 'location' | 'vendor';

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  location: 'Location',
  vendor: 'Vendor',
};

export async function fetchLocations(orgId: string): Promise<Location[]> {
  const response = await apiClient.get(endpoints.configuration.locations(orgId));
  return response.data;
}

export async function fetchLocationById(orgId: string, id: string): Promise<Location> {
  const response = await apiClient.get(`${endpoints.configuration.locations(orgId)}/${id}`);
  return response.data;
}

export async function createLocation(orgId: string, data: CreateLocationData): Promise<Location> {
  const response = await apiClient.post(endpoints.configuration.locations(orgId), data);
  return response.data;
}

export async function updateLocation({
  orgId,
  id,
  data,
}: {
  orgId: string;
  id: string;
  data: UpdateLocationData;
}): Promise<Location> {
  const response = await apiClient.patch(`${endpoints.configuration.locations(orgId)}/${id}`, data);
  return response.data;
}

export async function deleteLocation(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.configuration.locations(orgId)}/${id}`);
}

export async function markLocationAsPrimary(orgId: string, id: string): Promise<void> {
  await apiClient.post(`${endpoints.configuration.locations(orgId)}/${id}/primary`);
}
