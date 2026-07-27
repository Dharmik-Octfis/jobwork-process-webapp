/**
 * L1 — an in-process, TTL'd cache. One per caller, held in this Node process's
 * memory and nowhere else.
 *
 * 🔴 **Per-instance by definition.** AppSail runs many short-lived instances
 * (db/prisma.ts), and they share no memory. Two consequences that decide what
 * may live here:
 *
 *  1. **A `delete()` clears only THIS instance's copy.** Every other instance
 *     keeps serving its own until that entry's TTL expires. So the TTL is the
 *     real staleness bound, not the delete — pick it as if the delete never
 *     happened.
 *  2. **Never cache a counter here.** Each instance would count separately, so a
 *     limit of 5 becomes 5-per-instance. Counters need one shared home
 *     (Postgres); see the rate-limiting note in the caching plan.
 *
 * That makes this the right home for exactly two kinds of data:
 *
 *  - **Immutable reference data** (`countries`, `states`, `cities`,
 *    `app_modules`) — it cannot go stale, because it does not change until a
 *    redeploy. `ARCHITECTURE_AND_TECH_STACK.md:269` warns against caching in
 *    instance memory; that warning is about data needing *coordinated*
 *    invalidation, which immutable data does not.
 *  - **Small hot reads where a few seconds of staleness is acceptable** — with a
 *    TTL short enough to say so out loud. See `customFields.engine.ts`.
 *
 * Anything needing invalidation to be immediate and fleet-wide belongs in a
 * shared store instead — `lib/catalystCache.ts`.
 */

interface Entry<T> {
  value: T;
  /** Epoch ms after which this entry is treated as absent. */
  expiresAt: number;
}

export interface MemoryCache<T> {
  /** The value, or `undefined` if absent or expired. */
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  /** Drop one key — **on this instance only**. */
  delete(key: string): void;
  /** Drop every key on this instance. Used by tests and by broad invalidations. */
  clear(): void;
  /** Live entry count, expired-but-unswept included. Diagnostics only. */
  size(): number;
}

export interface MemoryCacheOptions {
  /** How long an entry stays valid, in milliseconds. */
  ttlMs: number;
  /**
   * Hard cap on entries, so a per-org or per-user key space cannot grow without
   * bound and push the instance into an OOM. On overflow the oldest-inserted
   * entry is dropped — approximate LRU, which is all a cache owes you.
   */
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 1000;

export function createMemoryCache<T>(options: MemoryCacheOptions): MemoryCache<T> {
  const { ttlMs, maxEntries = DEFAULT_MAX_ENTRIES } = options;
  // Map preserves insertion order, which is what makes the overflow eviction
  // below a one-liner: the first key is the oldest.
  const store = new Map<string, Entry<T>>();

  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;

      if (hit.expiresAt <= Date.now()) {
        // Sweep on read. There is no timer anywhere in this module on purpose —
        // a setInterval would keep the event loop alive and delay shutdown.
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },

    set(key, value) {
      // Re-inserting must move the key to the back of the eviction order, or a
      // frequently-refreshed key stays "oldest" forever and is evicted first.
      store.delete(key);
      store.set(key, { value, expiresAt: Date.now() + ttlMs });

      while (store.size > maxEntries) {
        const oldest = store.keys().next();
        if (oldest.done) break;
        store.delete(oldest.value);
      }
    },

    delete(key) {
      store.delete(key);
    },

    clear() {
      store.clear();
    },

    size() {
      return store.size;
    },
  };
}
