import catalyst from 'zcatalyst-sdk-node';
import { env } from '../config/env.ts';

/**
 * L2 — Catalyst Cache: a key-value store **shared by every AppSail instance**.
 * The storage analogue of `lib/storage.ts`, and initialized the same way (a
 * standalone app from OAuth credentials, because we run on AppSail and need this
 * from places that have no Catalyst `req`).
 *
 * WHY THIS AND NOT REDIS
 * There is no Redis on Catalyst, so Redis would mean renting one elsewhere and
 * reaching it over the public internet — while this sits inside Zoho, next to the
 * app. Given Postgres is RDS in `ap-south-1` (a different cloud) and every
 * `runAsTenant` costs four sequential round trips to it (BEGIN, set_config,
 * SELECT, COMMIT), one in-network call here can replace four out-of-network ones.
 *
 * 🔴 **THREE LIMITS OF THIS SERVICE, ALL LOAD-BEARING**
 *
 * 1. **TTL is whole hours.** `put(key, value, expiry)` takes `expiry_in_hours`,
 *    so **one hour is the floor** — 10 minutes is not expressible. The TTL is
 *    therefore only a backstop; the real freshness mechanism is deleting the key
 *    on write. If a caller cannot guarantee that delete, it must not cache here.
 * 2. **No atomic increment.** There is no INCR/SETNX/Lua — only put/get/delete
 *    over HTTP. A read-modify-write across two calls is not atomic, so
 *    **counters (rate limits, quotas) can never live here.** They belong in
 *    Postgres, which does it in one statement.
 * 3. **No key scanning.** No SCAN/KEYS/pattern delete, so "drop everything for
 *    org X" is not expressible. Every key must be individually reconstructible
 *    from data the invalidating code already holds.
 *
 * 🔴 **EVERY OPERATION FAILS SOFT.** These are authenticated HTTPS calls to
 * another service. `tenantContext` is on the request path for every tenant route,
 * so a throwing cache would turn a Catalyst blip into a total auth outage. Each
 * function below therefore swallows its error and reports "miss" — the caller
 * falls through to Postgres and is merely slower. This is the `catch` that
 * CLAUDE.md permits: it changes behaviour and writes no response.
 *
 * Disabled unless `ZC_CACHE_SEGMENT_ID` is set (plus the usual `ZC_*` credentials),
 * so the whole layer is opt-in and can be switched off in production without a
 * deploy.
 */

/** Whether L2 is usable at all. Callers may check this to skip building a key. */
export const cacheEnabled: boolean = env.catalyst.cacheConfigured;

/** Catalyst caps a cache key at 255 characters. */
const MAX_KEY_LENGTH = 255;

/** Default backstop TTL. Hours is the only unit this service accepts. */
const DEFAULT_TTL_HOURS = 1;

type CacheSegment = ReturnType<ReturnType<typeof buildCache>['segment']>;

function buildCache() {
  const credential = catalyst.credential.refreshToken({
    // eslint-disable-next-line @typescript-eslint/naming-convention -- SDK wire key
    refresh_token: env.catalyst.refreshToken!,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- SDK wire key
    client_id: env.catalyst.clientId!,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- SDK wire key
    client_secret: env.catalyst.clientSecret!,
  });

  const app = catalyst.initializeApp({
    // eslint-disable-next-line @typescript-eslint/naming-convention -- SDK wire key
    project_id: env.catalyst.projectId!,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- SDK wire key
    project_key: env.catalyst.projectKey!,
    environment: env.catalyst.environment,
    credential,
  });

  return app.cache();
}

// Built once and reused: the credential holds a refreshable token, so a
// module-level singleton avoids re-authenticating on every call.
let segmentHandle: CacheSegment | undefined;

function getSegment(): CacheSegment | undefined {
  if (!cacheEnabled) return undefined;
  try {
    segmentHandle ??= buildCache().segment(env.catalyst.cacheSegmentId!);
    return segmentHandle;
  } catch {
    // Bad credentials or an SDK change. Degrade to "no cache" rather than
    // breaking every request that happens to consult it.
    return undefined;
  }
}

/** Reject a key the service would refuse anyway, before spending a round trip. */
function keyIsUsable(key: string): boolean {
  return key.length > 0 && key.length <= MAX_KEY_LENGTH;
}

/**
 * Read a raw string. Returns `null` for a miss, a disabled cache, **or any
 * failure** — the caller cannot distinguish them, and must not need to.
 */
export async function cacheGet(key: string): Promise<string | null> {
  const segment = getSegment();
  if (!segment || !keyIsUsable(key)) return null;

  try {
    const value = await segment.getValue(key);
    // Everything stored here is JSON, so an empty string is never a real value —
    // treat it as a miss rather than handing `JSON.parse('')` to a caller.
    return value ? value : null;
  } catch {
    return null;
  }
}

/**
 * Read and JSON-parse. A stored value that no longer parses (shape changed
 * between deploys) is treated as a miss, so a bad entry costs one DB read rather
 * than throwing on every request until its TTL expires.
 */
export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const raw = await cacheGet(key);
  if (raw === null) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Write a raw string. `ttlHours` is the backstop only — see limit 1 above; the
 * caller still owes a `cacheDelete` on every mutation of the underlying row.
 *
 * `update` is attempted when `put` reports the key already exists: the REST API
 * separates create from update, and this module deliberately presents one "set".
 */
export async function cacheSet(
  key: string,
  value: string,
  ttlHours: number = DEFAULT_TTL_HOURS,
): Promise<void> {
  const segment = getSegment();
  if (!segment || !keyIsUsable(key)) return;

  // Whole hours only, and at least one — a fractional value would either be
  // rejected or silently floored to "no expiry".
  const expiry = Math.max(1, Math.round(ttlHours));

  try {
    await segment.put(key, value, expiry);
  } catch {
    try {
      await segment.update(key, value, expiry);
    } catch {
      // Both failed. A write that does not land costs a future cache miss and
      // nothing else, so there is nothing to report.
    }
  }
}

/** JSON-serialize and write. */
export async function cacheSetJson(
  key: string,
  value: unknown,
  ttlHours: number = DEFAULT_TTL_HOURS,
): Promise<void> {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return; // Circular or otherwise unserializable — simply do not cache it.
  }
  await cacheSet(key, serialized, ttlHours);
}

/**
 * Drop one key across every instance. **This is the real invalidation
 * mechanism** — the TTL is only what covers a delete that never ran (a crash
 * mid-request, a row changed directly in psql, a migration). Call it on every
 * write to the underlying row.
 */
export async function cacheDelete(key: string): Promise<void> {
  const segment = getSegment();
  if (!segment || !keyIsUsable(key)) return;

  try {
    await segment.delete(key);
  } catch {
    // Already gone, or the service is unreachable. The TTL is the backstop.
  }
}

/**
 * Build a tenant-scoped key.
 *
 * 🔴 **A cache is a second data store with no RLS.** `runAsTenant` cannot help
 * here — the key is the *only* isolation this layer has. Every tenant-scoped
 * entry must therefore carry its `organizationId`, and going through this helper
 * is what makes that mechanical instead of remembered. A wrong org id then
 * produces a miss, never another tenant's data.
 */
export function tenantCacheKey(
  organizationId: string,
  namespace: string,
  ...parts: string[]
): string {
  return [namespace, organizationId, ...parts].join(':');
}
