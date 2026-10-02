# Stock Adjustment — quantity only, the Zoho Books flow

**Status: planned and BUILT 2026-10-02 (all seven steps of §7). Not committed, not deployed.**

Still owed before it can be called finished:

- 🔴 **No screen has been walked in a browser** — the Adjust Stock form, the list, the detail pane
  and the two report links. Keyboard order, 390px and 768px are unchecked.
- Migration `20261002051832_add_stock_adjustments` is applied to `jobwork_local` only.
- The sidebar link is an `app_modules` row from `prisma/seed.ts`: each environment needs
  `npm run seed` once, then a backend restart (the module tree is cached).
- Existing permission templates do not gain `stock_adjustment:*`; an owner ticks it on.

**Where the build differs from the text below:**

- **Oldest-first allocation was lifted, not copied** (§4): `stock-ledger/allocateOutward.ts`, now
  called by assemblies too.
- **Cancelling an increase has its own quantity guard** (§4), which the plan did not foresee.
- **The list endpoint takes `?count=true`** for the opt-in total, as assemblies do.
- **The list page is plain**: no New button, column customisation, filters or bulk cancel.
- **The item's Transactions tab lists adjustments** (§5a) — added after the plan, on request.
- §9's four defaults were all built as written.

The missing half of "Opening Stock & Stock Adjustment" from `JOBWORK_DOMAIN_AND_MODULE_MAP.md`
(Phase 1). Opening stock already existed; this is how stock that was lost, damaged or found at a
godown after the books began gets recorded.

The model is Zoho Books' **Adjust Stock → Quantity Adjustment** screen, including its two batch
dialogs. The ledger and FIFO engine need **no change** — this is one new document module on top of
`postMovement`.

---

## 0. Decisions already taken (2026-10-02)

| Question                     | Decision                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Quantity vs Value            | **Quantity only.** No Value Adjustment tab (§8).                                                                                               |
| Zoho's "Account" field       | **Left out.** There is no chart of accounts; Reason carries the meaning.                                                                       |
| Entry point                  | An **Adjust Stock** button beside **Edit** on the item overview page (one item per adjustment); viewed in an **Inventory → Adjustments** list. |
| Reasons                      | A **fixed list**, not per-organisation.                                                                                                        |
| Items without batch tracking | No batch dialog; the server picks or creates the hidden batch.                                                                                 |
| Batch-tracked items          | Increase opens **Add Batches**; decrease opens **Select Batches** — as Zoho does.                                                              |

## 1. What it is, in one paragraph

A stock adjustment is a posted document: **one item, one location, one direction**. The user types either
"New quantity on hand" or "Quantity adjusted" and the other is computed from "Quantity available". An
increase posts inward `adjustment` rows at the cost price the user states, which creates FIFO layers.
A decrease posts outward `adjustment` rows and FIFO decides what they cost. It is never edited after
posting; cancelling it reverses its rows.

## 2. The rules

- **A1 — One item, one location, one direction.** Quantity adjusted is non-zero. Positive is an
  increase, negative a decrease.
- **A2 — The difference is the truth, not the new total.** The client sends the signed quantity
  adjusted. The server re-reads the live balance and never trusts "quantity available" or "new
  quantity on hand" from the form, because stock can move between opening the form and saving it.
- **A3 — Own godowns only.** A location of type `processor` is refused on the server, not just
  hidden in the dropdown. Shrinkage at a job worker belongs to challan closure, where it enters the
  cost of the goods received (`JOBWORK_CHALLAN_CLOSURE_PLAN.md`). `in_transit` and `customer_site`
  are refused too (§9, point 2).
- **A4 — Own stock only.** Pickers and the balance read filter `ownership = 'own'`. Customer-owned
  stock is deferred across the product.
- **A5 — The date obeys the books-begin date.** `assertOnOrAfterMigration`, the same helper every
  other document uses. The date becomes `postedAt` on every row.
- **A6 — Increase: the user states the cost.** Cost price is required and ≥ 0, pre-filled from the
  item. `valueIn = quantity × cost price`. `postMovement` creates the layer.
- **A7 — Decrease: the user states no cost.** The cost field is not shown as editable.
  `postMovement` costs the row with the default `fifo` scope. A caller passing `valueOut` is refused
  by the engine already.
- **A8 — Decrease cannot exceed what is there.** Refused by name: per batch, per package, and for
  the untagged remainder of a batch that has packages (`assertUnitsFitBatch` already enforces the
  last one).
- **A9 — Batch-tracked items must say which batches.** The batch rows must add up to the quantity
  adjusted, or the dialog's "overwrite the line with N" option rewrites the quantity to the rows'
  total, as on a bill.
  - Increase: each row is a **new batch** (reference required — `createBatch` enforces it) or an
    **existing batch** (including one that has run out, via `includeExhausted`).
  - Decrease: each row is an existing batch with stock at this location.
- **A10 — Untracked items never see a batch.** Increase: the server creates one batch, as a bill
  does. Decrease: the server takes from the oldest batches first.
- **A11 — Packages (takas) are optional**, exactly as on a bill (in) and an issue (out).
- **A12 — Unallocated and draft batches are never offered.** `postMovement` refuses both anyway.
- **A13 — No edit.** A posted adjustment is corrected by cancelling it and entering a new one.
- **A14 — Cancel reverses every row** with `reverseMovement`. Cancelling an increase is refused once
  anything has consumed that stock — the engine already refuses and names the consuming document.
- **A15 — Reason is required**, from the fixed list: `damaged`, `lost`, `found`, `count_correction`,
  `other`. Description is free text and optional.

## 3. Schema

Two tenant tables, in a new `prisma/schema/adjustments.prisma`. Conventions per CLAUDE.md: uuid
primary keys via `gen_random_uuid()`, `Timestamptz(6)`, varchar "enums", the five audit columns and
`custom_fields`.

**`stock_adjustments`**

| Column              | Type           | Notes                                                         |
| ------------------- | -------------- | ------------------------------------------------------------- |
| `organization_id`   | uuid           | `@db.Uuid` on the foreign key                                 |
| `adjustment_number` | varchar(50)    | `ADJ-00001`, allocated on save; unique per organisation       |
| `adjustment_date`   | timestamptz    | becomes `postedAt`                                            |
| `item_id`           | uuid           |                                                               |
| `location_id`       | uuid           |                                                               |
| `quantity_adjusted` | decimal(18,4)  | signed on the document; the ledger rows stay unsigned         |
| `quantity_before`   | decimal(18,4)  | snapshot of the balance the server read at post time          |
| `cost_price`        | decimal(18,4)? | increase only; null on a decrease                             |
| `value`             | decimal(18,4)  | snapshot of what the ledger rows carried, read back from them |
| `reason`            | varchar(40)    | `// damaged \| lost \| found \| count_correction \| other`    |
| `reference_number`  | varchar(100)?  |                                                               |
| `description`       | text?          |                                                               |
| `status`            | varchar(20)    | `// adjusted \| cancelled`                                    |

**`stock_adjustment_batches`** — one row per batch (and package) the document touched.

| Column            | Type          | Notes                                                        |
| ----------------- | ------------- | ------------------------------------------------------------ |
| `organization_id` | uuid          | denormalised, so the table carries its own direct RLS policy |
| `adjustment_id`   | uuid          |                                                              |
| `batch_id`        | uuid          |                                                              |
| `batch_unit_id`   | uuid?         | null = no package named                                      |
| `quantity`        | decimal(18,4) | always positive; direction comes from the header             |

Ledger rows carry `sourceDocType = 'inventory_adjustment'`, `sourceDocId` = the adjustment,
`sourceDocLineId` = the batch row, `movementType = 'adjustment'`. The FIFO cost-lot report already
has a label for `inventory_adjustment`.

**Migration checklist** (each of these has been missed before):

- Draft with `db:draft`, then write the RLS statements **by hand** — `migrate diff` never generates
  them. Direct policy form on both tables, created guarded on `pg_policies`.
- Add both tables to `TENANT_TABLES` in `src/db/rls.test.ts`.
- Add `stock_adjustment` to `NUMBER_SEQUENCE_DEFAULTS` (`lib/numberSequence.ts`).
- Back-relations on `User` for the audit columns, with unique relation names.

## 4. Backend

New module `src/modules/inventory/adjustments/` — routes, controller, service, schemas, types.
`inventory/assemblies` is the closest sibling (a ledger-posting document with cancel).

Mounted at `/organizations/:orgId/inventory/adjustments`, behind `authenticate, tenantContext`:

| Route         | Permission                | Does                                          |
| ------------- | ------------------------- | --------------------------------------------- |
| `GET /`       | `stock_adjustment:read`   | list, with the shared search/pagination shape |
| `GET /:id`    | `stock_adjustment:read`   | header + batch rows                           |
| `POST /`      | `stock_adjustment:create` | create and post in one transaction            |
| `DELETE /:id` | `stock_adjustment:delete` | cancel (A14)                                  |

Permission resource `stock_adjustment` goes in `MODULE_GROUPS` under `inventory_management`, with
actions `read`, `create`, `delete` — no `update`, because nothing can be edited (A13). It is its own
resource on purpose: this is the one module that can create inventory from nothing.

**Create, inside one `runAsTenant`:**

1. Validate item, location (A3), date (A5).
2. Read the live balance for item × location, own stock (A2).
3. Increase: for each row, `createBatch` or resolve the existing batch; create packages if given;
   `postMovement` with `qtyIn` and `valueIn`.
4. Decrease: validate each row against availability in one grouped read (A8); `postMovement` with
   `qtyOut` and no value. For an untracked item, allocate oldest-first.
5. Allocate the number, write header and batch rows, snapshot `value` from the rows written.

Query shape: batches resolved once with `resolveBatchesForPosting`; availability by one
`getAvailableBatches` plus one `getAvailableBatchUnits`; no per-row reads.

**Oldest-first allocation is shared, not copied.** The allocator that lived privately in
`assemblies.service.ts` was lifted into `stock-ledger/allocateOutward.ts` (2026-10-02); assemblies
and adjustments both call it. `jobIssues.resolveLines` keeps its own and was not touched.

**Cancelling an increase has its own quantity guard.** `reverseMovement` refuses once the cost
layers were drawn on, but FIFO costs by item, not by batch: the adjusted batch can be physically
issued while older layers pay for it. So `cancelAdjustment` also checks each batch (and package)
still holds what the adjustment added.

## 5. Frontend

`web/src/features/inventory/adjustments/` — `adjustments.api.ts`, `adjustments.schemas.ts`,
components. Query keys include `orgId`.

**Adjust Stock form** — opened by the **Adjust Stock** button beside **Edit** on the item overview page.

| Field                | Behaviour                                                                              |
| -------------------- | -------------------------------------------------------------------------------------- |
| Date \*              | defaults to today                                                                      |
| Reference number     | optional                                                                               |
| Location \*          | own godowns only                                                                       |
| Quantity available   | read-only, for the chosen location                                                     |
| New quantity on hand | typing here sets Quantity adjusted = new − available                                   |
| Quantity adjusted \* | typing here sets New quantity = available + adjusted; accepts `+5` / `-15`             |
| Cost price           | shown and required on an increase; hidden on a decrease                                |
| Batch details \*     | batch-tracked items only: "Add Batches" on an increase, "Select Batches" on a decrease |
| Reason \*            | `Select a reason…`                                                                     |
| Description          | optional                                                                               |

Changing location, or flipping the sign of the quantity, clears the batch rows — they belong to the
other direction or another godown.

**Batch dialogs are reused, not rebuilt:**

- Increase → `purchases/bills/AddBillBatchesModal.tsx` (new batch, existing batch, packages).
- Decrease → `jobwork/issues/AddBatchesModal.tsx` (already shared by Issue, Assemblies and job
  order planning).

Before either is changed for this screen, read every importer end to end. The aim is to pass props,
not to fork behaviour.

**List and detail** — Inventory → Adjustments in the sidebar: number, date, item, location, quantity
adjusted, reason, status. Detail shows the batch rows and a Cancel action. Cancelled adjustments stay
in the list with their status (§9, point 1).

The sidebar entry is an `app_modules` row (`STOCK_ADJUSTMENTS`, under `INVENTORY_MANAGEMENT`), added
by `prisma/seed.ts` — so **every environment needs `npm run seed` once** for the link to appear, and
the module tree is cached (6h in the backend, 1h in the browser), so it shows after a backend
restart. The list has no "New" button, no column customisation, no filters and no bulk cancel; the
top-bar search matches the adjustment number and reference number.

## 5a. Where an adjustment is named elsewhere (step 6, built)

Every place that turns a ledger row's `sourceDocType` into words needed to learn
`inventory_adjustment`; before, it showed as the raw type or a bare uuid.

| Place                                              | What it shows now                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Item ledger (Inventory Valuation → an item)        | "Stock Adjustment", its number, a link, and a cancelled one as a cancellation |
| FIFO cost-lot report                               | the adjustment number on the lot and on what drew from it, with a link        |
| Stock movement report                              | the adjustment number                                                         |
| "Already used by …" refusals (`describeDocuments`) | "stock adjustment ADJ-00012"                                                  |

Guarded by `adjustments.reports.test.ts`.

**The item page's Transactions tab** has an "Adjustments" option beside Bills, Issues and Receives:
date, number (a link to the adjustment), location, reason, signed quantity and status. It reads the
same list endpoint with `?itemId=`, and is its own small table (`ItemAdjustmentsTable.tsx`) rather
than more branches in the shared one.

**After save or cancel**, invalidate the stock queries — figures are cached client-side for 30
seconds and a stale one reads as "the adjustment did nothing".

The usual bars apply: built from the shared controls, keyboard-walked, checked at 390px / 768px /
desktop, field errors as a red border plus a toast.

## 6. Tests

Own fixtures via `src/db/testTenant.ts`, hard-deleted afterwards. Each test gets **its own item or
location** — FIFO is per item per location, so a shared godown picks up other suites' layers.

1. Increase, untracked item: balance up, one layer at the stated cost.
2. Increase, batch-tracked: new batch and existing batch in one document; rows must total the quantity.
3. Increase without a batch reference on a tracked item: 400.
4. Decrease, untracked: oldest batch first; `valueOut` equals the FIFO draw.
5. Decrease, batch-tracked: named batches only; more than available refused by name.
6. Decrease on a batch with packages: named package, and untagged-remainder limit.
7. Processor location: refused. Date before the migration date: refused.
8. Unallocated holding batch: never offered, refused if sent.
9. Cancel a decrease: draws restored to the same layers.
10. Cancel an increase: reversed; refused once consumed.
11. `checkLayerInvariant` is clean after every case above.
12. Tenant isolation: another organisation's adjustment is a 404; both tables in `TENANT_TABLES`.
13. Permissions: each route refuses without its key.

## 7. Build order

1. Schema, migration, RLS, `TENANT_TABLES`, number sequence.
2. Service + tests 1–11 (including the allocation decision in §4).
3. Routes, permission resource, tests 12–13.
4. Adjust Stock form with both batch dialogs.
5. List, detail, cancel, sidebar entry.
6. Check the item's Transactions tab and the FIFO cost-lot report show the new rows correctly.
7. Update the docs that describe built behaviour (`JOBWORK_DOMAIN_AND_MODULE_MAP.md` module table,
   `ROLES_AND_PERMISSIONS.md` if it lists resources) and this file's status line.

## 8. Not in this plan

| Left out                        | Why                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Value Adjustment                | `postMovement` refuses value without quantity, and cost lives in layers; it needs a new revaluation path in the costing engine. |
| Account field                   | No chart of accounts exists.                                                                                                    |
| Approval step                   | The domain doc asks for an approver. The permission gate is the control for now.                                                |
| Save as Draft                   | Zoho has it; nothing here needs it yet.                                                                                         |
| Several items on one adjustment | The item sits on the header. Adding it later means a lines table and a migration.                                               |
| Physical count sheet            | The more controlled practice for periodic counts; can post through the same service later.                                      |
| Per-organisation reasons        | Fixed list decided.                                                                                                             |
| Stock at processors             | Belongs to challan closure.                                                                                                     |
| Custom fields UI                | The `custom_fields` column is added now (cheap on an empty table); no entity type is registered.                                |

## 9. Small points decided by default — say if any is wrong

1. **A cancelled adjustment stays visible** in the list with status `cancelled`. Assemblies
   soft-delete on cancel; here the record of who conjured or removed stock is the point.
2. **`in_transit` and `customer_site` locations are refused**, like `processor`.
3. **Cost price 0 is allowed** on an increase. It lowers the item's average value, but found stock
   with no known cost is a real case.
4. **Back-dated decreases are allowed.** The engine checks today's balance, not the balance on the
   date — the same as every other document here.

## 10. Not verified yet — check at build time

- ~~Whether `AddBillBatchesModal` and `AddBatchesModal` can be used as they are~~ — both are used
  unchanged.
- ~~Which item field pre-fills cost price~~ — `item.costPrice`.
- The form reads `configuration/locations` (needs `location:read`) and filters with
  `isOwnLocation`, the same as the item page it opens from. A user without `location:read` gets an
  empty location list.
- "Quantity available" is the item page's stock-on-hand figure for the location. The server
  re-reads the balance, so this is display only.
- The Adjust Stock button is not hidden by permission — no screen here hides buttons that way; the
  server answers 403.
- Whether child tables such as `bill_item_batches` carry the audit columns, to match
  `stock_adjustment_batches` to them.
