import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '../../db/prisma.ts';
import type { ApiEnvelope } from '../../lib/apiResponse.ts';
import { createMemoryCache } from '../../lib/memoryCache.ts';

/**
 * Global geo + industry reference data, served to every client that renders an
 * address form.
 *
 * WHY THIS ONE IS CACHED IN INSTANCE MEMORY (L1) AND NOT IN CATALYST CACHE
 * The payload is large — `prisma/data/states.json` is ~347 KB and
 * `cities-in.json` ~203 KB — and it is built from a nested join that pulls every
 * city of every state. Uncached, each request pays that join, plus serializing
 * roughly half a megabyte of JSON.
 *
 * Putting it in a shared cache would replace the join with a network fetch of
 * ~500 KB followed by a `JSON.parse` of ~500 KB on every request — real work,
 * every time. Holding it in memory costs one variable read.
 *
 * The usual objection to instance memory (`ARCHITECTURE_AND_TECH_STACK.md:269` —
 * instances share none) does not apply here, because there is nothing to keep in
 * sync: `countries`, `states`, `cities` and `industries` are master-data
 * reference tables. They change when someone reseeds, not when a user acts. Each
 * instance warms its own copy with one query and is then correct until the TTL
 * lapses.
 *
 * The response body is cached **already serialized**, so a hit skips the query
 * AND the `JSON.stringify`. That is why this is the one controller that writes
 * the envelope itself instead of calling `sendSuccess` — the bytes are identical
 * (see the `ApiEnvelope` annotation below, which is what keeps them identical),
 * they are simply produced once instead of per request.
 */

interface SeedData {
  industries: { id: string; code: string; name: string }[];
  states: {
    code: string;
    name: string;
    countryCode: string;
    cities: { id: string; name: string }[];
  }[];
  countries: { id: string; name: string; code: string; isoCode: string; dialCode: string }[];
}

interface CachedResponse {
  /** The full `{ statusCode, message, data }` envelope, pre-serialized. */
  body: string;
  /** Strong ETag over `body`, so a repeat client can be answered with a 304. */
  etag: string;
}

/**
 * Six hours: long, because this data only changes on a reseed, but not infinite,
 * so a reseed reaches every running instance the same day without a redeploy.
 * Restarting the app clears it immediately.
 */
const SEED_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_KEY = 'seed:geo';

const seedCache = createMemoryCache<CachedResponse>({ ttlMs: SEED_TTL_MS, maxEntries: 1 });

/** Exported for the reseed path and for tests — drops this instance's copy. */
export function invalidateSeedDataCache(): void {
  seedCache.clear();
}

async function loadSeedData(): Promise<SeedData> {
  const [industries, states, countries] = await Promise.all([
    prisma.industry.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.state.findMany({
      where: { isActive: true },
      select: {
        code: true,
        name: true,
        countryCode: true,
        cities: {
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.country.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, isoCode: true, dialCode: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return { industries, states, countries };
}

async function getCachedResponse(): Promise<CachedResponse> {
  const hit = seedCache.get(CACHE_KEY);
  if (hit) return hit;

  const data = await loadSeedData();

  // Annotated as ApiEnvelope so this stays byte-identical to what `sendSuccess`
  // would emit — if that shape ever changes, this fails to compile rather than
  // silently drifting from every other endpoint.
  const envelope: ApiEnvelope<SeedData> = { statusCode: 200, message: 'Success', data };
  const body = JSON.stringify(envelope);

  const fresh: CachedResponse = {
    body,
    etag: `"${createHash('sha1').update(body).digest('base64url')}"`,
  };
  seedCache.set(CACHE_KEY, fresh);
  return fresh;
}

// No try/catch — Express 5 sends a rejected promise to `errorHandler`.
export async function getSeedData(req: Request, res: Response) {
  const { body, etag } = await getCachedResponse();

  res.setHeader('ETag', etag);
  // `private`: the payload is identical for everyone, but the route sits behind
  // `authenticate`, and a shared proxy must not serve it to an unauthenticated
  // caller just because someone signed in earlier.
  res.setHeader('Cache-Control', 'private, max-age=3600');

  // The client already holds this exact body — answer with 304 and no payload.
  // This is the one legitimate empty-bodied response in the API: unlike a 204,
  // a 304 is not "success with no data", it is "reuse what you have", and the
  // envelope it refers to is the one we sent the first time.
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.type('application/json').send(body);
}
