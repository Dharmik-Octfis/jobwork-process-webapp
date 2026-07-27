# Caching — How It Works Here

**Project:** Jobwork Process (multi-tenant SaaS)
**Audience:** Engineering, all levels — written assuming you have never built a cache before
**Purpose:** Explain what we cache, what we deliberately do _not_ cache, and the rules you must
follow when you add caching to a new module.
**Status:** Explainer **and** working reference — the code described here is live.
**Last updated:** 2026-07-27

---

## 0. Read this first

A cache is the easiest thing in this codebase to get subtly, dangerously wrong. A slow app annoys
people. A wrong cache shows one company's data to another, or lets someone keep a permission you
just took away.

So this document spends more time on **what not to cache** than on what to cache. If you only
remember one thing, remember §9.

---

## 1. What a cache actually is

A cache is a **copy of something you already have**, kept somewhere faster to reach.

That definition carries two consequences that everything else follows from:

1. **Losing a cache is never data loss.** The real data is still in Postgres. An empty cache just
   means the app is slower for a moment while it refills.
2. **A cache can be _wrong_.** The original changed, and your copy didn't hear about it. That is
   the entire difficulty. Everything in §6 exists to manage it.

---

## 2. The mental model: how far away is the data?

Picture your app as a person working at a desk.

| Where the data is        | The analogy                                  | How long it takes       |
| ------------------------ | -------------------------------------------- | ----------------------- |
| **L1** — app memory      | A notepad on your own desk                   | Instant                 |
| **L2** — Catalyst Cache  | A shared whiteboard down the hall            | A short walk            |
| **Postgres** — the truth | The archive, in another building across town | A drive across the city |

Two details make this analogy fit our setup exactly:

**The archive really is across town.** Our Postgres is Amazon RDS in `ap-south-1`, and our app runs
on Zoho Catalyst AppSail. Different companies' data centres. Every query leaves Zoho's network.

**And we don't drive there once — we drive there four times.** Every tenant-scoped query goes
through `runAsTenant`, which is a transaction:

```
1. BEGIN                     → drive across town
2. SELECT set_config(...)    → drive across town
3. SELECT the actual row     → drive across town
4. COMMIT                    → drive across town
```

That is why caching is worth doing here at all. One walk down the hall replaces four drives.

---

## 3. Our two layers

### L1 — the notepad on your desk (`lib/memoryCache.ts`)

Just a variable inside the Node process. Nothing but a `Map` with expiry times.

**The one thing you must internalise:** AppSail runs **many instances** of our app, and they share
no memory. Each one has its own notepad. So:

- Instance A can clear its own notepad. **It cannot reach instance B's.**
- Therefore the **TTL is the real staleness bound** — write it as if `delete()` never happens on the
  other instances, because it doesn't.

### L2 — the shared whiteboard (`lib/catalystCache.ts`)

Catalyst Cache. A separate Zoho service that **every instance reads and writes**. Instance A writes,
instance B sees it. Deleting a key removes it for everyone at once.

Three limits of this service, all of which shape our design:

| Limit                     | What it means for you                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| **TTL is in whole hours** | 1 hour is the floor. "Expire in 10 minutes" is not expressible.               |
| **No safe counting**      | No atomic increment → **rate limits and quotas can never live here.**         |
| **No key scanning**       | Can't say "delete everything for org X". Keys must be rebuildable one by one. |

And one rule we enforce ourselves:

> **Every operation fails soft.** These are HTTPS calls to another service. `tenantContext` runs on
> every tenant request, so a cache that throws would turn a Catalyst hiccup into a total login
> outage. Every function in `catalystCache.ts` swallows its error and reports "miss" — the caller
> just falls through to Postgres and is merely slower.

L2 is **off** unless `ZC_CACHE_SEGMENT_ID` is set. That's the production on/off switch.

---

## 4. What we cache today

| What                                       | Layer       | TTL      | Why that layer                                    |
| ------------------------------------------ | ----------- | -------- | ------------------------------------------------- |
| `/api/seed-data` (countries/states/cities) | **L1 only** | 6h       | ~500 KB and it never changes. See §5.             |
| `/api/modules` (sidebar tree)              | **L1 only** | 6h       | Same — reference data, changes on reseed only.    |
| Permission template bodies                 | **L1 + L2** | 30s / 1h | Replaces a 4-trip transaction on _every_ request. |
| Custom field definitions                   | **L1 only** | 30s      | See the warning in §8.                            |

---

## 5. Why the big one is L1 and not L2

`/api/seed-data` returns every country, every state, and every city nested inside its state. About
half a megabyte.

It's tempting to put something that big on the shared whiteboard. Don't. If it lived in L2, every
single request would:

1. fetch ~500 KB across the network, then
2. `JSON.parse` ~500 KB.

That's real work, every time. In L1 it's a variable read — effectively free.

And the usual objection to L1 doesn't apply here. `countries`, `states`, `cities` and `app_modules`
are **master-data reference tables**. They change when someone reseeds, not when a user clicks
something. There is nothing to keep in sync between instances, so "each instance has its own copy"
costs nothing.

> Both endpoints also store the response **already serialized**, so a cache hit skips the database
> query _and_ the `JSON.stringify`. That's why those two controllers write the envelope themselves
> instead of calling `sendSuccess` — the bytes are identical (the `ApiEnvelope<T>` annotation is what
> guarantees it), they're just produced once instead of per request.

---

## 6. The most important example: permissions

This is the part to understand properly, because it's where a mistake is a security bug.

### What `tenantContext` does on every request

It answers "what is this person allowed to do here?" from **two separate reads**:

```
A. the membership  →  { isOwner, permissionTemplateId }
B. the template    →  { grantsAllPermissions, permissions }
                              ↓
                    Set<string>   ← built fresh, every request
```

### We cache B. We do NOT cache A. And we never cache the Set.

| Read               | Cached? | Why                                                                                                                                                                                                   |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** — membership | ❌ No   | It's already cheap (one index lookup, no transaction) — and it's the security-critical half. Caching it would break our promise that **removing a member takes effect immediately, on every device.** |
| **B** — template   | ✅ Yes  | Costs a full 4-trip transaction, and template contents change roughly never.                                                                                                                          |
| The resolved `Set` | ❌ No   | It's a pure function of A and B. Rebuilding it from ~40 strings takes microseconds.                                                                                                                   |

### Why this split is elegant

Trace what happens when things change:

- **A member is removed** → read A returns nothing on the very next request, on every device,
  instantly. The cache is never even consulted. ✅
- **A member is moved to a different template** → read A returns a different
  `permissionTemplateId`, so the next request looks up a **different cache key** and gets the right
  answer. **No invalidation needed at all.** ✅
- **An admin edits a template's checkboxes** → this is the _only_ case that needs an explicit
  delete, because the key stays the same while its contents changed underneath. See §7.

One cache entry also serves **every member on that template**. Fifty people on "Warehouse Staff" =
one entry, because the per-person part of the answer (which template, and are they still a member)
is re-read live for each of them.

> **Owners never touch this cache.** `resolvePermissions` returns the full catalog on
> `membership.isOwner` before a template id is even considered.

### One subtle rule

We cache the **raw** `permissions` array from the row, never the `withImpliedRead()` expansion. That
expansion is derived from the code catalog. If we cached the expanded version, a stale entry could
outlive the release that changed the derivation rules — serving stale **logic**, not just stale data.

> **Cache the fact. Recompute the derivation.**

---

## 7. Keeping it fresh: the delete is the mechanism, the TTL is the safety net

Two things keep a cache correct, and people usually mix up which does the work:

- **The delete** — you change the row, so you delete the cache entry. This is the real mechanism.
  It's precise and immediate.
- **The TTL** — the entry expires on its own eventually. This is only a **backup**, for when the
  delete never ran: the server crashed mid-request, someone edited the row directly in psql, a
  migration changed it.

That's why L2's 1-hour floor is acceptable for us. An hour is a long time to be wrong — but we're
only relying on it in cases where the delete failed, which should be never.

### 🔴 Always invalidate AFTER the transaction commits

This is the bug that's easiest to write and hardest to spot:

```ts
// ❌ WRONG — inside the transaction
await runAsTenant(orgId, async (tx) => {
  await tx.permissionTemplate.updateMany({ ... });
  await invalidateTemplate(orgId, id);   // ← too early!
});
```

Here's the failure, step by step:

1. You delete the cache entry — but your transaction hasn't committed yet.
2. Another request arrives, finds nothing cached, and reads Postgres — which **still shows the old
   row**, because you haven't committed.
3. That request caches the **old** value.
4. Your transaction commits.
5. The cache now holds stale data, and nothing will ever invalidate it again.

```ts
// ✅ RIGHT — after it commits
const result = await runAsTenant(orgId, async (tx) => {
  await tx.permissionTemplate.updateMany({ ... });
  return ...;
});
await invalidateTemplate(orgId, id);
return result;
```

---

## 8. ⚠️ Never cache across an open transaction

A Prisma transaction holds **one of only five pool connections** for its entire life
(`db/prisma.ts`, `max: 5`).

`loadActiveDefinitions` is called from _inside_ an already-open `runAsTenant` (see
`vendors.service.ts` and `items.service.ts` on create and update). If we made an HTTPS call to
Catalyst Cache in there, we'd pin a database connection while waiting on the network — **worse than
the query we replaced.**

That's why custom field definitions are **L1 only**, even though L2 would otherwise suit them.

> **The rule:** a shared cache only pays off when the lookup happens _before_ the transaction opens.
> Check your call site before reaching for L2.

---

## 9. Things that must never go in a cache

Read this list twice.

**❌ Never cache a counter in L1.** Rate limits, quotas, attempt counts. Each instance would count
separately, so "5 attempts" silently becomes 5-per-instance. Counters need one shared home — and
since Catalyst Cache can't increment safely either, **counters go in Postgres**, which does it
atomically in a single statement.

**❌ Never build a tenant cache key without `organizationId`.** This is the big one.

> A cache is a second data store, and **it has no RLS underneath it.** `runAsTenant` cannot help
> you here. The key is the _only_ isolation the cache layer has.

Always go through `tenantCacheKey(organizationId, namespace, ...parts)`. It looks redundant when the
id is already a UUID — that's the point. A wrong org id then produces a **miss**, never another
tenant's data.

**❌ Never cache list/search results.** Vendors, customers, items. They're written often, staleness
is immediately visible to the user, and `search × filter × page × perPage` explodes the key space.
Fix those with indexes, not caching.

**❌ Never cache anything you can't invalidate.** If you can't name the exact line of code that will
delete this entry when the data changes, you're not ready to cache it.

---

## 10. Adding caching to a new module — the checklist

- [ ] **Does it actually need it?** Measure first. Most queries are fine.
- [ ] **How bad is stale data here?** Wrong permissions = security bug. Wrong dropdown label =
      nobody notices. That answers your TTL.
- [ ] **Pick a layer.** Never changes, or per-instance is fine → **L1**. Must be identical
      everywhere, and invalidated fleet-wide → **L2**.
- [ ] **Is the call site inside an open transaction?** If yes → L1 only (§8).
- [ ] **Is it tenant data?** Then use `tenantCacheKey`. No exceptions.
- [ ] **Name the invalidation site.** Which function deletes this on write? Write the delete
      **after** the commit (§7).
- [ ] **Is it a counter?** Then it isn't a cache. Use Postgres.
- [ ] **Does a cache failure degrade gracefully?** It must fall through to Postgres, never throw.

---

## 11. Where the code lives

| File                                                    | What it is                                      |
| ------------------------------------------------------- | ----------------------------------------------- |
| `src/lib/memoryCache.ts`                                | L1 — in-process TTL cache                       |
| `src/lib/catalystCache.ts`                              | L2 — Catalyst Cache wrapper + `tenantCacheKey`  |
| `.../permission-templates/permissionTemplates.cache.ts` | The L1+L2 template cache, and its invalidator   |
| `src/middlewares/tenantContext.ts`                      | Reads the cache; the membership read stays live |
| `src/modules/seed-data/seed-data.controller.ts`         | L1 + ETag, the biggest single win               |
| `.../app-modules/app-modules.controller.ts`             | L1 + ETag                                       |
| `.../custom-fields/customFields.engine.ts`              | L1 for definitions (§8)                         |

---

## 12. Why Catalyst Cache and not Redis?

Short version: **a cache only helps if it's closer than the thing it replaces.**

There is no Redis on Catalyst. Using Redis would mean renting one elsewhere and reaching it over the
public internet — so it would sit roughly as far away as our database already is, and we'd have
added a server to secure, patch, and pay for. Catalyst Cache is inside Zoho, where our app already
runs.

Redis is genuinely better software — real expiry precision, safe counters, pub/sub. We'd want it if
we ever moved the app onto our own server, where it could run on the same machine. On AppSail we
can't put it close, so its advantages don't reach us.

This decision is also recorded in `ARCHITECTURE_AND_TECH_STACK.md` §"Redis (as cache) → Catalyst
Cache".

---

## 13. Related reading

|                                  |                                                                     |
| -------------------------------- | ------------------------------------------------------------------- |
| `CLAUDE.md`                      | Tenant isolation rules — read before caching anything tenant-scoped |
| `ROLES_AND_PERMISSIONS.md`       | What the cached permission templates mean                           |
| `ARCHITECTURE_AND_TECH_STACK.md` | Why Catalyst services over their AWS equivalents                    |
| `PRISMA.md` §8                   | RLS, and why the cache sits outside it                              |
