import { z } from 'zod';
import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';

/**
 * Lots — read only.
 *
 * 🔴 `fetchAvailableLots` IS THE PICKER, AND IT IS A LEDGER QUERY. It is not "the
 * lots list filtered". A lot row exists from the moment it is created and goes on
 * existing after the last metre of it has been issued, so a picker built on the
 * `lots` table offers material that has been at the dyer's for a fortnight
 * (field-sources §10). There is no create/update/delete here because a lot is
 * born from the document that physically brought material in, never from a form.
 */

export const availablePackageSchema = z.object({
  lotPackageId: z.string(),
  packageNumber: z.number(),
  label: z.string().nullable(),
  /** The MEASURED quantity on the tag — ticking the box takes all of it. */
  qty: z.string(),
  availableQty: z.string(),
});

export type AvailablePackage = z.infer<typeof availablePackageSchema>;

export const availableLotSchema = z.object({
  lotId: z.string(),
  lotNumber: z.string(),
  supplierLotRef: z.string().nullable(),
  itemId: z.string(),
  uomId: z.string().nullable(),
  ownership: z.string(),
  ownerPartyId: z.string().nullable(),
  availableQty: z.string(),
  accumulatedValue: z.string(),
  costPerUnit: z.string().nullable(),
  /** Server date − first inward movement. Drives the FIFO suggestion and the
   * 180-day GST clock, so it is computed in one place, not two. */
  ageDays: z.number().nullable(),
  lotTracking: z.string(),
  packages: z.array(availablePackageSchema).default([]),
});

export type AvailableLot = z.infer<typeof availableLotSchema>;

export const stockLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  /** Set when the location belongs to a vendor — i.e. it is a PROCESSOR’s own
   * place. The Issue dialog uses it to drop the party it is issuing to. */
  vendorId: z.string().nullable().optional(),
  availableQty: z.string(),
});

export type StockLocation = z.infer<typeof stockLocationSchema>;

export async function fetchAvailableLots(
  orgId: string,
  params: { itemId: string; locationId?: string; ownership?: string; withPackages?: boolean },
): Promise<AvailableLot[]> {
  const response = await apiClient.get(endpoints.inventory.availableLots(orgId), {
    params: { ...params, withPackages: params.withPackages ? 'true' : undefined },
  });
  return z.array(availableLotSchema).parse(response.data);
}

/** 🔴 Also a ledger query, not a location list: offering a godown that holds none
 * of this item is how users get stuck on the Issue dialog (§5.1). */
export async function fetchStockLocations(
  orgId: string,
  params: { itemId: string; ownership?: string },
): Promise<StockLocation[]> {
  const response = await apiClient.get(endpoints.inventory.stockLocations(orgId), { params });
  return z.array(stockLocationSchema).parse(response.data);
}
