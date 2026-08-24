import type { Adapter, AdapterPayload } from 'oidc-provider';
import { prisma } from '../db/prisma.ts';

/**
 * `oidc-provider`'s storage, backed by the `oidc_payloads` table.
 *
 * The library addresses everything it persists as (model name, id) — authorization
 * codes, access tokens, refresh tokens, device codes, its own Session and Grant
 * objects, and the short-lived Interaction that carries a login across a redirect.
 * The same id can legitimately exist under two models, which is why the primary key
 * is composite and why nothing here looks a row up by `id` alone.
 *
 * 🔴 `Client` is deliberately NOT stored here. Clients come from `oidc_clients` via
 * the static `clients` array (see clients.ts) so that registering an app is a
 * reviewed database change rather than something the protocol layer can create.
 */

/** Seconds → absolute expiry. The library hands us a TTL, the table stores a time. */
function expiresAtFrom(expiresIn?: number): Date {
  // No TTL means the library expects the row to outlive the request; an hour is a
  // floor, not a promise — anything the library still wants is re-upserted.
  return new Date(Date.now() + (expiresIn ?? 3600) * 1000);
}

export function createPrismaAdapter(): (name: string) => Adapter {
  return function adapterFor(name: string): Adapter {
    return {
      async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
        const data = {
          payload: payload as unknown as object,
          grantId: payload.grantId ?? null,
          userCode: payload.userCode ?? null,
          uid: payload.uid ?? null,
          expiresAt: expiresAtFrom(expiresIn),
        };

        await prisma.oidcPayload.upsert({
          where: { type_id: { type: name, id } },
          create: { type: name, id, ...data },
          update: data,
        });
      },

      async find(id: string): Promise<AdapterPayload | undefined> {
        const row = await prisma.oidcPayload.findUnique({ where: { type_id: { type: name, id } } });
        if (!row) return undefined;

        // 🔴 Expiry is enforced on READ, not only by the sweep. Nothing guarantees
        // the sweep has run, and returning an expired authorization code would let
        // a code replayed hours later still buy a token.
        if (row.expiresAt <= new Date()) return undefined;

        return row.payload as AdapterPayload;
      },

      async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
        const row = await prisma.oidcPayload.findFirst({
          where: { type: name, userCode, expiresAt: { gt: new Date() } },
        });
        return (row?.payload as AdapterPayload) ?? undefined;
      },

      async findByUid(uid: string): Promise<AdapterPayload | undefined> {
        const row = await prisma.oidcPayload.findFirst({
          where: { type: name, uid, expiresAt: { gt: new Date() } },
        });
        return (row?.payload as AdapterPayload) ?? undefined;
      },

      /**
       * Mark spent without deleting. The library uses `consumed` to detect an
       * authorization code being redeemed twice — which is how stolen-code reuse is
       * caught — so the row has to survive its own consumption to be evidence.
       */
      async consume(id: string): Promise<void> {
        const row = await prisma.oidcPayload.findUnique({ where: { type_id: { type: name, id } } });
        if (!row) return;

        const payload = {
          ...(row.payload as AdapterPayload),
          consumed: Math.floor(Date.now() / 1000),
        };
        await prisma.oidcPayload.update({
          where: { type_id: { type: name, id } },
          data: { payload: payload as unknown as object },
        });
      },

      async destroy(id: string): Promise<void> {
        // deleteMany, not delete: the library destroys optimistically and a missing
        // row is normal, but `delete` throws P2025 on one that is already gone.
        await prisma.oidcPayload.deleteMany({ where: { type: name, id } });
      },

      /**
       * Every token, code and session tied to one grant, across ALL models — which
       * is why this does not filter by `name`. Consent revocation and logout both
       * land here, and leaving one model behind leaves a live credential.
       */
      async revokeByGrantId(grantId: string): Promise<void> {
        await prisma.oidcPayload.deleteMany({ where: { grantId } });
      },
    };
  };
}

/**
 * Delete expired rows. Nothing calls this on a schedule yet — see the note on
 * `OidcPayload` in the schema. Until something does, the table only grows, and a
 * pile of spent authorization codes is a liability nobody chose to keep.
 */
export async function sweepExpiredPayloads(): Promise<number> {
  const { count } = await prisma.oidcPayload.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}
