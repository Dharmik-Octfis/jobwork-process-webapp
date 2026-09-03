# Batch Units ("Taka") — Implementation Plan

**One optional level below the batch.** A batch `B-1` may hold `T-1`, `T-2`, `T-3` — each with its
own label and its own measured quantity — so a roll, bale, coil or plate can be identified,
issued and traced individually. The level is switched on **once per organization** in Settings, and
the word "Taka" is a per-org label like "Batch" already is.

**Status (2026-09-02):** Phases 0–4 are built and on the dev database, **except Assemblies and the
ageing report, both blocked on things that are not this feature** (see below). **The loop closes**: material can be received into
packages, planned by package, sent out by package, consumed out of the package it went in, and
returned as new packages. §11's two open decisions are still open.

| Phase                   | State                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| 0 — clear the ground    | ✅ both §10 defects fixed, both `source_doc` indexes added                                   |
| 1 — foundation          | ✅ `batch_units` + RLS + `stock_ledger.batch_unit_id` + §2.5 invariant + balance helpers     |
| 2 — prove it on Bills   | ✅ setting → `AddBillBatchesModal` → service → ledger → read-back                            |
| 3a — Opening Stock      | ✅ positions keyed on the unit, delta-settled, ordered packages-first; modal AND page        |
| 3b — Job Receipt        | ✅ packages at the gate, top-ups continue `seq`, cancel reverses them and frees the labels   |
| 3c — Job Issue          | ✅ `job_issue_lines.batch_unit_id`, atomic tick-to-send, untagged ceiling, cancel reverses   |
| 3d — Job Order planning | ✅ `job_order_step_input_batches.batch_unit_id`, `NULLS NOT DISTINCT` key, still only a note |
| 3d — Assemblies         | ✅ ledger posting + `item_assembly_lines.batch_unit_id`, package-aware FIFO, boxed output    |
| 4 — challan print       | ✅ package column, printed only when a challan names one; footer `colspan` bug fixed         |
| 4 — reporting           | ◑ §8 q1 shipped on the Item page; q2 already covered per document; **q3 has no home**        |

**ASSEMBLIES NOW POST TO THE LEDGER (2026-09-02)** — the prerequisite this phase was blocked on.

Until then the module wrote `item_assemblies` and nothing else: components were not consumed, the
composite was not produced, and assembling a shirt out of fabric and buttons left every balance in
the system untouched. It minted a `DEFAULT-<itemId>` batch per component with a raw `tx.batch.create`
purely to satisfy a NOT NULL column, and `deleteAssembly` said in its own comment that it reversed
nothing. The schema had been designed for the real thing all along — `compositeBatchId`,
`componentValue`, `additionalCost`, `ownership`, and a line table whose comment reads "one
(component × batch) ALLOCATION" — so this was finishing what the schema described, not inventing it.

One assemble now posts **one `consume` per (component, batch)** and **one `produce`** into a new
composite batch whose parents are every component batch consumed. Value flows with it: each consume
takes its batch's cost per unit at that location, and the produce carries the sum plus
`additionalCost`. Cancelling reverses every row, refusing if the composite has already been used.

Two decisions were the user's, taken 2026-09-02:

- **The form's flexibility wins over the schema's "quantities are locked to the recipe".** Overrides,
  ad-hoc extra items and services all survive. A service or untracked line posts no movement — there
  is no stock to move — and its money reaches the composite through `additionalCost`, which is what
  that column is for. The schema comment about locked quantities describes a stricter document than
  the one that exists.
- **Batch-tracked components get a picker**; untracked ones are allocated FIFO by the server, the
  same fallback job issues use. Picking stays optional even where the picker exists: leave it and
  FIFO applies.

Two pre-existing defects in that module went with it: the raw `tx.batch.create` (forbidden —
`createBatch` is the only place a batch is born) and a batch lookup with no `isDeleted: false`
filter, both replaced by real allocation against available stock.

🔴 **And one found while building it, which bites anything doing FIFO:**
`getAvailableBatches` does **not** return rows in age order. Its rows are driven by the balance
`groupBy`, whose order is arbitrary; the `orderBy: createdAt` only decides which rows survive
`limit`. Assuming otherwise consumed the NEWEST stock first and passed every test that did not check
which batch moved. Both FIFO callers now sort for themselves, on the earliest INWARD ledger entry
rather than `createdAt` — a batch created Friday for goods that arrived Monday must queue by Monday.
The function's own comment now says so.

**And the package level landed on top of it the same day.** `item_assembly_lines.batch_unit_id`,
plus the two things assemblies need that no other surface does:

- **Package-aware FIFO.** A batch whose rolls hold all of it has nothing untagged, so drawing on the
  batch generally would be refused by the invariant. The allocator drains each batch untagged-first
  — that material belongs to no roll, so taking it leaves every roll intact — then roll by roll in
  `seq` order.
- **The composite comes out in packages too.** Ten shirts boxed into two cartons, with the value
  split across them by quantity so the batch is worth exactly what it would have been unboxed.

There is deliberately **no UI for boxing the output**: the server accepts `compositeUnits` when a
client sends them, but nothing on the assembly form asks for them, because no business rule requires
it yet. Add the control when somebody needs it.

🔴 **§2.3 IS SUPERSEDED, AND §11's FIRST OPEN DECISION IS TAKEN (2026-09-02, the user's call).**

The plan says a package is ATOMIC at issue — pick it and the whole roll goes — reasoning that the
roll physically travels to the processor. **It is not.** That holds for a full roll and is wrong for
every part-used one, which is exactly the roll an operator sends the remainder of. So on **every**
surface a package is taken by a TYPED QUANTITY, checked against what that package still holds:

- one control everywhere — a quantity box, never a checkbox, and no per-screen mode to pick;
- the allocator needed nothing extra: it already summed per (batch, location, package), so only the
  comparison changed from `=` to `≤`;
- the overdraw guard now matters more, because two lines may legitimately draw on one roll — each
  fits alone while the two together overdraw it, which is why it sums across lines.

**What 3c closed.** §2.5's invariant refuses an untagged outward row that would leave the packages
claiming more than the batch holds, so a batch whose packages covered _all_ of its quantity could not
be issued at all — correct behaviour with no way out of it. The picker can now name a package.

**The consume side had to follow.** A challan that sends a roll leaves the batch tagged _at the
processor_, so an untagged consume against it is refused. `ConsumeAllocation` carries `batchUnitId`
off the challan line. Taking part of a package lowers both sides of the inequality equally, so a
partial consume was always legal and stays so.

**Job Order planning names a package, and it is STILL ONLY A NOTE.** Nothing is held back: the same
roll can be planned by two orders and issued by one, exactly as a batch can. The issue picker warns;
it never subtracts.

🔴 **The unique key was the trap here, and §3.4 called it correctly.** Adding a nullable column to
`(input, batch, location)` makes Postgres treat two untagged rows as distinct — `NULL <> NULL` — so
the constraint would silently stop constraining the row shape it exists for, which is every row an
org that never turns the level on will write. The plan suggested a `COALESCE` expression index; the
migration uses **`NULLS NOT DISTINCT`** (Postgres 15+, and this runs on 18) instead, which states the
same guarantee directly and — unlike an expression index — keeps the column list Prisma declares, so
`db:check-drift` reports nothing. Verified in the database, and pinned by a test.

**Phase 4, and what §8 actually needed.** Its three queries turned out to need three different
amounts of work, and only one of them needs a report:

1. _"What packages are in B-1, how much in each, where"_ — **shipped**, on the Item page's batch
   grid, which is already one row per (batch, location) and is where the question is asked. A roll at
   the dyer's appears under the dyer's row, so "where is T-1" is answerable at a glance. One grouped
   query for the whole page; the loose remainder is printed rather than left to be inferred.
2. _"Every package a document brought in"_ — **already covered**. Bills rebuild their batch list from
   the ledger and now read packages back with it; the receipt detail reads its own via
   `batch_units.source_doc_id`. No new surface needed.
3. _"Package ageing at processors (GST 180/365 days)"_ — ⛔ **there is no ageing report in this
   codebase at all**, at any level. Nothing to add a package dimension to. Building one is a new
   feature — endpoint, page, permission resource, and the 180-vs-365 rule — not an extension of this
   work, and it is worth having at BATCH level first. The data is there: `stock_ledger.posted_at`
   with `batch_unit_id`, over the index added in Phase 1.

**Deliberate departures from what is written below**, all recorded where the code lives:

1. **§5.1's "`createBatch` accepts a list of units" became a sibling, `createBatchUnits`.** A second
   delivery adds units to a batch an earlier document created, so the two events are genuinely
   separate and the top-up path needs to reach the second without the first. `createBatch`'s return
   type also stays a batch, which every existing caller depends on.
2. **§5.3's "units must add up to the batch quantity" is enforced as `≤`, not `=`.** An equality
   would forbid the case §2.5's own corollary calls physically real and requires to be visible: a
   delivery where only some rolls carried a tag. More than the batch is refused by name; less posts
   the remainder as one untagged row, and every screen prints it as _unallocated_. This is also how
   handling units behave in SAP and how Zoho treats a partly-tagged receipt — a hard block here
   would be stricter than the practice it is modelled on.
3. **The dead `withPackages` availability flag became `withUnits`.** It was left behind by the
   package tracking removed 2026-08-12 — accepted end to end and did nothing. It now means what its
   name says, and was renamed so nothing reads as the old feature come back.
4. **§3.4's `batch_unit_id` on `job_receipt_output_batches` was NOT added.** Nothing reads it:
   cancellation replays the ledger, and "which packages did this receipt create" is one indexed query
   on `batch_units.source_doc_id`, which `createBatchUnits` already stamps. A row per (batch, unit)
   there would carry a `qty` — a second stored per-package quantity, which is the thing §2.1 exists
   to prevent. Add it only when a query actually needs it.

**Pre-existing defects found while building this and fixed alongside it.** None is caused by the
package level; all three are made worse by it, which is why they are fixed rather than filed.

1. `bills.service` double-posted on an Open → Draft → Open cycle (§10.1). Guarded on the ledger.
2. `bills.service` paired payload lines to DB rows by array index against `orderBy: createdAt` —
   and Postgres's `now()` is the _transaction's_ start, so every line of one bill shares a
   timestamp and the sort had nothing to order by. Lines now keep the rows their own writes returned.
3. `closedQtyByIssueLine` counted CANCELLED receipts, so cancelling a receipt reversed its stock and
   reopened its challans, then left them permanently un-receivable — `partially_received` with zero
   outstanding. A cancellation now closes nothing.

Also `getBalances()` (§10.2) had three camelCase column names in raw SQL and would have thrown the
first time anything called it; fixed rather than deleted, since §8's reporting is what would adopt it.

**Companion documents**

|                                    |                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `JOBWORK_DOMAIN_AND_MODULE_MAP.md` | §5.2 batch/batch-unit reasoning, §5.4 location model, §8.3 the issue picker |
| `JOBWORK_CORE_WALKTHROUGH.md`      | The worked example every quantity in this plan has to keep answering        |
| `PRISMA.md` §8                     | Migration runbook and the RLS checklist §3.5 refers to                      |
| This document                      | What to build, in what order, and which file each change lands in           |

---

## 1. Scope

### 1.1 In

| Surface                    | What gains a taka                                 |
| -------------------------- | ------------------------------------------------- |
| Item → Opening Stock       | declaring takas inside a declared batch           |
| Bill (Draft → Open)        | receiving takas against a bill line's batch       |
| Job Order → step planning  | planning which takas a step will use              |
| Job Issue → Add Batches    | picking takas to send on a challan                |
| Job Receipt → Batch Alloc. | naming the takas that came back                   |
| Item Assembly              | consuming named takas                             |
| Reporting                  | taka balances by location, by document, by ageing |

### 1.2 Out — deliberately

- **Purchase Order.** It has no batch surface at all today — no batch column anywhere in
  `purchases.prisma`, no batch UI in the PO feature. A PO is a commitment; nothing moves stock.
  Batch identity arrives with the goods, on the Bill. Adding batch capture at order time is a **new
  capability on PO**, not an extension of this work, and it is not in this plan.
- **Splitting a taka.** See §2.3 — a taka is atomic at issue in v1.
- **Per-item control.** There is deliberately no `Item` column for this (§2.4).
- **Auto-numbering across the org.** `seq` numbers within the parent batch only, so an auto-named
  taka is `#3` of _that_ batch and two batches both have a `#3`. An org-wide taka sequence would be
  a different thing and is not in this plan. (Auto-naming _within_ the batch shipped 2026-09-03 —
  see §2.6.)

---

## 2. The five rules the whole design rests on

Everything in §3–§6 is a consequence of these. Change one and the plan changes.

### 2.1 🔴 A taka is a LEDGER DIMENSION, not a record with a quantity on it

`batch_units` carries **no `qty` column**. The quantity lives on `stock_ledger`, on the row that
represents the event of it arriving:

| batch_id | batch_unit_id | qty_in | location |
| -------- | ------------- | ------ | -------- |
| B-1      | T-1           | 1700   | Godown A |
| B-1      | T-2           | 400    | Godown A |
| B-1      | T-3           | 2900   | Godown A |

- **T-1's quantity** = `SUM(qty_in − qty_out) WHERE batch_unit_id = T-1` → 1700
- **B-1's quantity** = `SUM(qty_in − qty_out) WHERE batch_id = B-1` → 5000

The batch total is not a second number the takas must be reconciled against — it **is** those rows,
summed one level up. They cannot drift, because they are the same rows read two ways.

**Why not store it.** A stored `batch_units.qty` has to be updated by every code path that moves
stock — issue, receipt, three cancellation paths, assembly consume, `settleOpening`, scrap,
adjustment, and every path not yet written. Miss one and the taka is wrong while the batch total
stays perfectly correct, which is the hardest failure here to notice. It is the same trap as
`item_location_stocks`, deleted 2026-08-13: _"correct until the first job issue and silently wrong
forever after."_

**And it would not serve a single report.** `batch_units` has no location, no document and no date,
so it can only ever answer "total, everywhere, ever" — a number no screen displays. Every real
query (§8) hits the ledger regardless. Storing buys no query and costs a second source of truth.

The user still types a quantity per taka — it becomes that taka's `qty_in`. Nothing is lost.

### 2.2 🔴 Takas carry NO value

Every taka in a batch shares that batch's weighted-average unit cost. Per-taka amount is derived:

```
taka amount = taka qty × (batch value at location ÷ batch qty at location)
```

This is what keeps the change out of valuation entirely — `splitValue`, `splitByQty`, the process
charge, the assembly cost logic and `jobIssues.service.ts`'s `unitValue` calculation are all
untouched. Put value on the taka and it reaches all of them.

### 2.3 🔴 A taka is ATOMIC at issue in v1

Picking a taka takes all of it. It is a checkbox, not a second quantity to reconcile.

This is what keeps the allocator tractable: `resolveLines` already maintains a per-(batch, location)
running-total map, and an atomic taka needs no second one layered on top. It also matches how a roll
physically moves. Splitting a roll becomes an explicit action later if the business needs it — see
§11.

### 2.4 🔴 Visibility is inherited, not configured per item

There is **no new column on `items`** and no `batch_and_unit` tracking value.

An item at `inventoryTracking = 'none'` never shows a batch field at all — `createBatch` mints one
silently behind the scenes and the user never sees it. So the taka level becomes visible **exactly
where a batch is visible**, i.e. `inventoryTracking = 'batch'`. Thread, buttons, dye chemicals and
packing tape never grow a taka grid because they never grow a batch grid.

Two gates, both already existing or trivial:

1. **Org** — `settings.batchUnit.enabled` decides whether the level exists in the UI at all
2. **Item** — inherited from `inventoryTracking = 'batch'`, no new column
3. **Entry** — nullable ledger column means even a taka-capable batch may hold an untagged remainder

### 2.5 🔴 The invariant that makes "optional" safe

Because takas are optional, someone can issue from a batch **without naming takas**. If B-1 holds
5000 across T-1/T-2/T-3 and an untagged issue takes 4000, the takas would claim 5000 while the batch
holds 1000.

The rule, enforced in `postMovement` on every outward row:

> For one batch at one location:
> `SUM(taka in − taka out)` **≤** `SUM(batch in − batch out)`

An untagged movement that would break it is refused by name, in the same shape as the existing
_"Batch X has N available, but M is being issued."_ Never silently allowed.

**Corollary — the loose remainder is legal and must be visible.** `SUM(takas) ≤ batch` is an
inequality, never an equality. A batch of 5000 with takas totalling 3000 has 2000 untagged, which is
physically real. Every picker renders it as an explicit _unallocated_ row so nobody thinks the
system lost it.

### 2.6 🔴 A taka's NAME is optional; its QUANTITY is not (added 2026-09-03)

`batch_units.label` was mandatory and is now auto-filled. Leave the box blank and the taka is stored
as **`#seq`** — its position inside the batch.

**Nothing about tracking ever depended on the label.** A taka's identity is its `batch_units.id`
(uuid); its quantity is `SUM(qty_in − qty_out) WHERE batch_unit_id = …` and its amount is
`SUM(value_in − value_out)` over the same rows (§2.1, §2.2). No balance query, no picker, no
cancellation and no valuation path reads `label` — the only write-path use of it is the
duplicate check, which now skips blanks because two unnamed takas are two takas, not a collision.

What the label buys is the match to a **physical tag**. An org that prints numbers on its rolls
should still type them; an org whose rolls carry no tag no longer has to invent one.

**Why `#seq` and not "Taka 3".** The level is renameable per org and a stored label does not follow a
rename, so a company that switched from "Taka" to "Roll" would be left with rolls called "Taka 3"
forever. `#3` is a position and stays true whatever the level is called. It is also unique for free:
`seq` is unique inside the batch and never reused, even by a soft-deleted row.

**Why the column stays `NOT NULL`.** Every picker, challan and error message reads it, and a package
nobody can name is one nobody can pick out of a list. Making it nullable would have meant null
handling in ~10 read surfaces and bought nothing.

**The one collision.** A hand-typed `#3` can occupy the name an auto-named taka would take. That is
refused with a 409 naming the problem, never silently merged into one roll.

Implemented in `createBatchUnits` (`stockLedger.service.ts`) — the single place a `batch_units` row
is born, so `seq` is now allocated **before** the labels are checked. Pinned by
`batchUnits.service.test.ts` → _"auto-names an unlabelled unit after its position"_ and _"refuses an
auto-name that a hand-typed label already occupies"_.

### 2.7 The taka grid is a DIALOG, not an expanding panel (2026-09-03)

A batch is entered by pressing **"Add {batches}"** and filling a dialog; its takas are entered the
same way — **"Add {takas}"** on the batch row opens `BatchUnitsModal`, which holds the same grid with
the same **New {taka}** / **Existing {taka}** links. One rule for both levels, and a delivery of ten
batches no longer sprawls ten inline grids down a screen nobody can scroll.

`Modal` already keeps a stack, so Escape closes the inner dialog and leaves the batch dialog open,
and the body scroll-lock survives until the last one closes. The editing model did not change: the
grid writes through to the caller's state exactly as it did expanded, so the only action is **Done**
— there is no Cancel pretending to revert a draft.

---

## 3. Schema changes

All additive. No backfill (`NULL` is already what every historical row means), no destructive
statement — `npm run db:promote` accepts it without a `@destructive-ok` line.

### 3.1 `organizations.settings` — no migration

Already a JSONB column carrying `itemTrackingLabel`. Add a sibling key:

```jsonc
settings: {
  itemTrackingLabel: { singular: "Batch", plural: "Batches" },
  batchUnit: { enabled: true, singular: "Taka", plural: "Takas" }   // new — zero DDL
}
```

That is the master setting and the configurable name in one place.

### 3.2 New model `BatchUnit`

Add to `prisma/schema/inventory.prisma`, below `Batch`.

```prisma
/// One physical package inside a batch — a taka, roll, bale, coil, plate, bundle.
///
/// 🔴 NO `qty` COLUMN, and that is the whole design. Quantity is
/// `SUM(qty_in − qty_out)` off `stock_ledger` filtered by `batch_unit_id`, exactly
/// as a batch's is. A stored copy would have to be updated by every path that
/// moves stock and would be silently wrong the first time one forgot.
///
/// 🔴 No `location_id` either — a taka has no location of its own, for the same
/// reason a batch has none. Location lives on the movement, which is what lets a
/// taka be sitting at the dyer's.
///
/// 🔴 No `state` column. "Is any of it left" is a balance, not a flag.
model BatchUnit {
  id             String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  /// Denormalised from the parent batch so this table carries its OWN RLS policy,
  /// exactly like `job_issue_lines`.
  organizationId String @map("organization_id") @db.Uuid
  batchId        String @map("batch_id") @db.Uuid

  /// Position inside the parent batch, 1-based. Restarts at 1 in every batch —
  /// correct here and nowhere else, because a taka has exactly one parent batch,
  /// can never merge across batches, and cannot exist without one.
  /// Since 2026-09-03 it is also what an UNNAMED taka is called (§2.6).
  seq Int

  /// What is printed on the physical tag and what the user types. Free text —
  /// "T-1", or the supplier's own taka number. OPTIONAL to type since 2026-09-03:
  /// blank is auto-filled with `#seq`, so the column stays NOT NULL (§2.6).
  label String @db.VarChar(60)

  /// Snapshot of the batch's uom, same reasoning as `Batch.uomId`.
  uomId String? @map("uom_id") @db.Uuid

  /// Unit genealogy — set only when the operation preserves packaging (dyeing:
  /// the same roll returns; cutting: rolls are destroyed, so this stays null).
  parentBatchUnitId String? @map("parent_batch_unit_id") @db.Uuid

  sourceDocType String? @map("source_doc_type") @db.VarChar(40)
  sourceDocId   String? @map("source_doc_id") @db.Uuid

  customFields Json     @default("{}") @map("custom_fields")
  isDeleted    Boolean  @default(false) @map("is_deleted")
  createdBy    String?  @map("created_by") @db.Uuid
  updatedBy    String?  @map("updated_by") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization    Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  batch           Batch              @relation(fields: [batchId], references: [id])
  uom             UnitOfMeasurement? @relation("BatchUnitUom", fields: [uomId], references: [id])
  parentBatchUnit BatchUnit?         @relation("BatchUnitGenealogy", fields: [parentBatchUnitId], references: [id])
  childBatchUnits BatchUnit[]        @relation("BatchUnitGenealogy")
  createdByUser   User?              @relation("BatchUnitCreatedBy", fields: [createdBy], references: [id], onDelete: SetNull)
  updatedByUser   User?              @relation("BatchUnitUpdatedBy", fields: [updatedBy], references: [id], onDelete: SetNull)

  ledgerEntries StockLedgerEntry[]

  @@unique([batchId, seq])
  @@index([organizationId, batchId])
  @@map("batch_units")
}
```

Plus the back-relations: `batchUnits BatchUnit[]` on `Batch`, `Organization` and
`UnitOfMeasurement`, and `createdBatchUnits` / `updatedBatchUnits` on `User`.

### 3.3 `stock_ledger.batch_unit_id`

```prisma
  /// WHICH PACKAGE inside the batch this movement is. Nullable, and the null is
  /// load-bearing: an item with no taka level, and the untagged remainder of a
  /// batch that has one, both post null here.
  batchUnitId String? @map("batch_unit_id") @db.Uuid
  batchUnit   BatchUnit? @relation(fields: [batchUnitId], references: [id])
```

### 3.4 Nullable `batch_unit_id` on four line tables

| Table                          | Why                                                                    |
| ------------------------------ | ---------------------------------------------------------------------- |
| `job_issue_lines`              | three takas of one batch = three lines, as three batches = three today |
| `job_receipt_output_batches`   | already `(output, batch, kind, qty)`; becomes `(output, batch, taka)`  |
| `job_order_step_input_batches` | which takas the planner meant to use                                   |
| `item_assembly_lines`          | which takas an assembly consumed                                       |

**Bills need no column.** `bills.service.ts:85-99` rebuilds each line's batch list from its ledger
movements rather than storing it, so the bill gets taka read-back from the ledger column alone.

⚠️ **`job_order_step_input_batches` has `@@unique([jobOrderStepInputId, batchId, locationId])`.**
Adding a nullable column to that key breaks it — Postgres treats `NULL ≠ NULL`, so an untagged row
inserts twice and the constraint quietly stops constraining. Write a `COALESCE`-based expression
index by hand; `migrate diff` will not know.

### 3.5 Required by CLAUDE.md — not optional

- **RLS policy on `batch_units`** — copy the two statements from the bottom of `*_enable_rls`,
  **and** add `'batch_units'` to `TENANT_TABLES` in `src/db/rls.test.ts`. A tenant table with no
  policy is unprotected and nothing will tell you.
- **No new permission resource.** `permissions.catalog.ts:132` has `{ resource: 'batch', actions:
['read'] }` because batches are a consequence of a document, never a form. A taka is the same
  thing one level down and rides on `batch:read`. Do **not** add `batch_unit:*`.
- `custom_fields` is on the table per the default block. Add `'batch_unit'` to `ENTITY_TYPES`
  (`customFields.constants.ts`) only if per-org taka attributes are actually wanted — note that
  adding a name there fails the build until the module also has a list-column catalog and a filter
  set.

---

## 4. Indexes

```sql
-- Taka balances: "what is in B-1", "where is T-1", the taka picker.
-- Index-only — no heap fetch.
CREATE INDEX stock_ledger_batch_unit_idx
  ON stock_ledger (organization_id, batch_id, batch_unit_id, location_id)
  INCLUDE (qty_in, qty_out);

-- 🔴 MISSING TODAY, AND NEEDED REGARDLESS OF THIS FEATURE.
-- `stock_ledger` has only two indexes:
--   (organization_id, item_id, batch_id, location_id)
--   (organization_id, location_id, posted_at)
-- so every document read-back and every CANCELLATION is a sequential scan.
-- `cancelJobReceipt` filters on source_doc_type + source_doc_id;
-- `cancelJobIssue` filters on source_doc_line_id. Invisible at today's volume;
-- at 50x the rows (§9) it is 50 sequential scans inside one transaction holding
-- one pooled connection.
CREATE INDEX stock_ledger_source_doc_idx
  ON stock_ledger (organization_id, source_doc_type, source_doc_id);

CREATE INDEX stock_ledger_source_doc_line_idx
  ON stock_ledger (organization_id, source_doc_line_id);
```

**Keep them FULL, not partial.** Prisma cannot express a partial index, so a hand-written
`WHERE batch_unit_id IS NOT NULL` would make `npm run db:check-drift` report drift forever on a
database that is correct.

---

## 5. Backend service changes

### 5.1 `stockLedger.service.ts` — the choke point

Everything else in this plan is downstream of these. **Nothing else in the codebase writes
`stock_ledger` or creates a batch**, which is what makes this feature tractable at all.

| Function                         | Change                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `postMovement`                   | accept optional `batchUnitId`; **verify it belongs to the batch** (same reasoning as re-reading the batch for item/uom/ownership); enforce §2.5 |
| `createBatch`                    | accept an optional list of `{ label, qty }` and create the `batch_units` rows; the caller then posts one movement per taka                      |
| `getAvailableBatches`            | unchanged                                                                                                                                       |
| **new** `getAvailableBatchUnits` | sibling, not a parameter — one `groupBy (batchId, batchUnitId, locationId)`, positive-balance filter in JS, same shape as the existing one      |
| **new** `getBalancesByBatchUnit` | sibling of `getBalancesByBatchAndLocation` — one grouped query for many batches, indexed into a `Map`. 🔴 The N+1 guard; never loop             |

🔴 **`postMovement` already re-reads the batch per row.** Adding a taka read and the §2.5 aggregate
makes it three round trips per row. `Promise.all` buys nothing inside `runAsTenant` — one
connection, queued. The fix is the per-transaction cache `postMovement`'s own comment already
prescribes, **not** bypassing the validation.

### 5.2 The six document services

| File                     | Change                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `items.service.ts`       | `saveOpeningStock` — takas under each declared batch; `settleOpening` reversals must carry `batchUnitId`; `openingPositions` / `readOpeningStock` key on `(batch, unit, location)`  |
| `bills.service.ts`       | `createBill` (~~:217) and `updateBill` (~~:409) — accept `batches[].units[]`, post one movement per taka                                                                            |
| `jobIssues.service.ts`   | `resolveLines` — a picked taka is atomic (§2.3); `ResolvedIssueLine` gains `batchUnitId`; **`cancelJobIssue` must add `batchUnitId` to its ledger `select` AND its `postMovement`** |
| `jobReceipts.service.ts` | `OutputBatchPlan` gains a units list; `assertAllocationsBalance` gains the taka sum check; `postSide` creates takas and posts per taka; **`cancelJobReceipt` same reversal fix**    |
| `jobOrders.service.ts`   | planned taka rows on `job_order_step_input_batches`                                                                                                                                 |
| `assemblies.service.ts`  | consume named takas; the cancel path (~:378) needs the same reversal fix                                                                                                            |

🔴 **The reversal fix is the single easiest thing to miss and the worst to discover.** All three
cancel paths replay posted rows and copy `batchId` / `locationId` off them. Miss `batchUnitId` and
batch balances return perfectly correct while taka balances rot invisibly.

### 5.3 Validation, and where it lives

The "takas must add up to the batch quantity" check goes **in the service, beside the write** — not
only in the Zod schema, which runs on the HTTP route alone and would let a script, an import or a
test post an unbalanced document.

The precedent to copy is `assertAllocationsBalance` in `jobReceipts.service.ts`, which already
enforces exactly this shape one level up (an output row's `acceptedQty` must equal the sum of its
batch allocations, at `0.00005` tolerance). Takas are the identical check one level down. **Use the
same four-decimal tolerance** — an exact comparison rejects `3 × 33.3333` for being a billionth off.

---

## 6. Frontend changes

| File                                             | Change                                                          |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `hooks/useTrackingLabel.ts`                      | sibling `useBatchUnitLabel()` — `{ enabled, singular, plural }` |
| `features/organizations/PreferencesPage.tsx`     | the enable toggle + the two label fields                        |
| `organizations.schemas.ts` (web **and** backend) | the new `settings.batchUnit` key in both zod schemas            |
| `items/components/AddOpeningStockModal.tsx`      | a taka sub-grid under each batch row                            |
| `items/OpeningStockPage.tsx`                     | same                                                            |
| `purchases/bills/AddBillBatchesModal.tsx`        | same                                                            |
| `jobwork/issues/AddBatchesModal.tsx`             | expand a batch → tick takas (atomic, §2.3)                      |
| `jobwork/receipts/BatchAllocationModal.tsx`      | name the takas that came back                                   |
| `jobwork/issues/printChallan.ts`                 | taka labels and quantities on the challan                       |

**Every one of these inherits the shared-control rules** in CLAUDE.md → Frontend: Tab reaches every
control, `<button type="button">` never a styled `div`, dropdowns inside a `Modal` portalled to
`document.body` and positioned `fixed`, placeholders say "Select". Keyboard-walk each screen once
before calling it done — a page is not finished until Tab walks it the way it walks Vendors.

**The unallocated row is not optional** (§2.5 corollary). A batch of 5000 with 3000 in takas shows
`2000 unallocated` explicitly.

---

## 7. What each surface needs, in one table

| Surface        | Creates takas? | Picks takas? | Ledger written                 | Cancel path to fix |
| -------------- | -------------- | ------------ | ------------------------------ | ------------------ |
| Opening Stock  | ✅             | —            | `opening`                      | `settleOpening`    |
| Bill (→ Open)  | ✅             | —            | `receipt`                      | — (see §10)        |
| Job Order plan | —              | ✅ (a note)  | none                           | —                  |
| Job Issue      | —              | ✅           | `transfer_out` + `transfer_in` | `cancelJobIssue`   |
| Job Receipt    | ✅ + top-up    | —            | `consume` + `produce`          | `cancelJobReceipt` |
| Item Assembly  | ✅ (composite) | ✅ (inputs)  | `consume` + `produce`          | assemblies cancel  |

---

## 8. Reporting

Every taka question is answered from `stock_ledger`, which already carries location, document type,
document id, line id, ownership and `posted_at` on the same row.

```sql
-- What takas are in B-1, and how much in each, where
SELECT batch_unit_id, location_id, SUM(qty_in - qty_out) AS qty
FROM stock_ledger
WHERE organization_id = $1 AND batch_id = $2
GROUP BY batch_unit_id, location_id;

-- Every taka a document brought in — works unchanged for 'bill', 'job_receipt',
-- 'item_opening_stock', 'job_issue', and any document type added later
SELECT batch_unit_id, SUM(qty_in - qty_out)
FROM stock_ledger
WHERE organization_id = $1 AND source_doc_type = $2 AND source_doc_id = $3
GROUP BY batch_unit_id;

-- Taka ageing at processors (GST 180/365-day) — postedAt, never created_at
SELECT batch_unit_id, location_id, MIN(posted_at)
FROM stock_ledger
WHERE organization_id = $1 AND batch_unit_id IS NOT NULL
GROUP BY batch_unit_id, location_id;
```

🔴 **One grouped query, never one per row.** A taka picker showing a dozen batches each holding
several takas is fifty round trips if asked row by row — invisible at three, and the whole response
time at three hundred. `getBalancesByBatchAndLocation` is the template.

**If it ever gets slow**, the sanctioned answer is a rollup maintained **inside `postMovement`**, in
the same transaction as the ledger row — never a column maintained by callers. That is the exact
distinction `items.prisma` draws about the deleted `item_location_stocks` cache: a rollup has one
writer, a column has every caller. Do it only when a measured query proves it necessary.

---

## 9. Volume

One 50-taka batch through a 4-step route is roughly **850 ledger rows** (receipt 50, then
out/in/consume/produce = 200 per step × 4) against ~17 at batch level — about **50×**. At 100
batches/month that is ~1M rows/year, which Postgres handles comfortably **given the indexes in §4**.

`DOCUMENT_TX` (`jobwork.types.ts`) is already `{ maxWait: 15_000, timeout: 120_000 }` and its
comment cites a fifty-taka consignment as the worked example — the budget was sized for this. Do
**not** raise it further; if a document is slow, fix the query shape (§5.1's cache), because a
bigger timeout holds a pooled connection longer and the requests queued behind it fail on pool
acquisition while the offender survives.

---

## 10. Pre-existing issues found while planning this

Neither is caused by takas. Both get worse under them.

1. **`bills.service.ts` double-posts on an Open → Draft → Open cycle.** `createBill` posts `receipt`
   rows when status is Open; `updateBill` posts them again when `existing.status === 'draft' &&
new status === 'open'`. `updateBillSchema` is `.partial()`, so status can be set back to Draft
   and forward again — nothing checks whether rows already exist for that `sourceDocId`. It also
   pairs payload lines to DB rows **by array index** (the code says _"assuming same order since
   Prisma returns in create order mostly"_). A duplicated posting would duplicate taka quantities
   and then trip §2.5's invariant for users who did nothing wrong. **Fix before layering takas on.**

2. **`getBalances()` (`stockLedger.service.ts:357`) is dead and broken.** Nothing calls it, and its
   raw SQL uses `organizationId`, `itemId`, `locationId` as column names — the columns are
   `organization_id`, `item_id`, `location_id`. It would throw `column does not exist` the first
   time a report reached for it. Fix or delete before someone adopts it as the reporting entry point.

---

## 11. Open decisions

Neither blocks the first migration.

1. **Partial issue of a taka.** v1 says atomic (§2.3). If the business genuinely cuts rolls, the
   change is a quantity per picked taka plus a second running-total map in `resolveLines` — do it as
   a follow-up with a real case behind it, not speculatively.
2. **Unit genealogy (`parentBatchUnitId`).** The column is in §3.2 from the first migration because
   genealogy cannot be reconstructed from history that was never recorded. What _writes_ it — the
   taka-wise receipt that maps a returned roll back to the issued one — is not in this plan's scope.
   The column costs nothing empty; retrofitting it costs everything.

---

## 12. Order of work

**Phase 0 — clear the ground (do first).** §10's two fixes, and the two missing `source_doc` indexes
from §4. All three are worth doing whether or not takas ship.

**Phase 1 — foundation.** Migration: `batch_units` + RLS policy + `stock_ledger.batch_unit_id` + the
three indexes. `TENANT_TABLES`. `postMovement` / `createBatch` changes plus the §2.5 invariant. The
two new balance helpers. **Nothing user-visible; the column is inert until something writes it.**

**Phase 2 — prove it on one path.** Wire **Bills only**, end to end: org setting → `AddBillBatchesModal`
→ service → ledger. Then verify that batch balances, the Item page, the issue picker and
`getAvailableBatches` all still read correctly **with takas underneath**. Bills is the right probe
because it already reads its batch list back off the ledger, so the read side needs no work — if
this phase is clean, the premise holds.

**Phase 3 — the remaining five surfaces**, in this order: Opening Stock → Job Receipt → Job Issue →
Job Order planning → Assemblies. Receipt before Issue: takas must be _creatable_ before there is
anything to pick.

**Phase 4 — reporting and print.** §8's queries, the challan.

🔴 **Every phase carries its own cancel-path fix** (§5.2). Do not defer them — a cancellation that
forgets `batchUnitId` corrupts taka balances silently while batch balances stay right.

---

## 13. Test plan

Suites run against the dev database **in parallel** — create your own fixtures and hard-delete them
(see `middlewares/authenticate.test.ts`). Never mutate a row you merely found.

| Test                                                                             | Guards         |
| -------------------------------------------------------------------------------- | -------------- |
| takas sum to the batch; the derived total matches what was typed                 | §2.1           |
| an untagged issue that would break `SUM(takas) ≤ batch` is refused               | §2.5           |
| a batch with a partial taka allocation reports the correct unallocated remainder | §2.5 corollary |
| cancel an issue → taka balance returns to its pre-issue value                    | §5.2 🔴        |
| cancel a receipt → the created takas are fully reversed                          | §5.2 🔴        |
| per-taka amount = qty × batch unit cost; batch value is unchanged by takas       | §2.2           |
| a taka from another organization cannot be posted against this org's batch       | RLS + §5.1     |
| `batch_units` appears in `TENANT_TABLES` and its policy is enforced              | §3.5           |
| existing batch-level balances are byte-identical before and after the migration  | Phase 2        |
