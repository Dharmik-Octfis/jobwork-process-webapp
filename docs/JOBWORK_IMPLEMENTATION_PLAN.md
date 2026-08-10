# Jobwork — Implementation Plan (Sprints 1–5)

**Scope of this plan:** the **Jobwork** main module only. Purchases, Sales and Inventory as
user-facing modules are out.

**Companion documents**

|                                    |                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `JOBWORK_DOMAIN_AND_MODULE_MAP.md` | Why the modules are shaped this way. Read §5, §6, §9 before writing schema |
| `JOBWORK_UI_FIELD_SOURCES.md`      | Where every field on every screen gets its data                            |
| This document                      | What to build, in what order, and where the files go                       |

**Status:** ready to start once §3's three decisions are made. Those block the first migration.

---

## 1. Scope

### 1.1 In

| Module                                                            | Sprint      |
| ----------------------------------------------------------------- | ----------- |
| **Processes** — master                                            | 1           |
| **Process Routes** — reusable templates                           | 2           |
| **Job Orders** — incl. Material In and the Overview page          | 2           |
| **Issues** — challan out, lot/taka picker                         | 3           |
| **Receipts** — incl. dispositions and rework                      | 4           |
| **Multi-item steps** — a set of items in, a set out (domain §5.7) | 5 — see §12 |

### 1.2 Out — deliberately

Purchase Received · Purchase Bill · Purchase Return · Opening Stock screen · Stock Transfer ·
Stock Adjustment ·
Stock on Hand report · Sales Order · Delivery Challan · Sales Invoice · Jobwork Bill · E-way bill ·
costing reports.

`job_orders.sourceSalesOrderId` is **omitted entirely**, not stubbed. A nullable uuid column is cheap
to add the day Sales Orders ship.

### 1.3 The problem descoping creates, and the fix

> ⚠️ **SUPERSEDED 2026-08-07. Material In no longer exists.** It was removed from the job order
> before Purchase Received was built — earlier than `PURCHASE_RECEIVED_AND_ITEMS_SPEC.md` §6 ordered
> it — and nothing replaced it as an inward document. A job order is now a PLAN, and the stock it
> draws on arrives from somewhere else. Until Purchase Received and Opening Stock ship, that
> "somewhere else" is the scaffold in §12.6. The section below is kept because it explains why
> Material In existed at all and why its lots are still valid.

Without Purchase Received or Opening Stock, **a job order has no material to issue** — the Issue
dialog's lot picker
would query an empty ledger forever.

🔴 **Fix: the Job Order carries its own "Material In" section.** On the create screen you enter the
incoming material — item, quantity, supplier lot reference, and the takas with their measured
quantities. Saving creates the lot, its packages, and the first stock ledger rows.

This is not a workaround. It is the natural shape for a jobworker — _"party sent 5,000 m, lot ABC,
50 takas, for this job"_ — and it serves inward jobwork (shape D) directly, which is the most common
case for a jobworking business. When Purchase Received ships later, Material In becomes **optional**
rather than
being discarded: a job order will either draw from existing stock or declare its own.

### 1.4 Stock tables — exactly three, and they have no UI

The question was _"what is mandatory in the database for stock data?"_ Three tables, and nothing else:

| Table          | Why it cannot be skipped                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lots`         | Carries ownership, genealogy and origin. Every issue and receipt line references one                                                                               |
| `lot_packages` | The takas. Individually measured, variable quantities — the core requirement                                                                                       |
| `stock_ledger` | Movements. Without it, "what is available at step 2" gets computed from `job_issue_lines`, and **every one of those queries is rewritten** when the ledger arrives |

**These are plumbing, not modules.** One service, no list pages, no CRUD screens, no sidebar entry,
no permission resource of their own beyond a read for the picker. That is the whole footprint.

🔴 **Two columns must exist from the first migration even though nothing reads them yet** —
`lots.ownership` (+ `ownerPartyId`) and `lots.parentLotIds`. Retrofitting ownership means revisiting
every valuation query ever written; genealogy cannot be reconstructed from history that was never
recorded. See the domain doc §11.3.

---

## 2. Tables created, by sprint

Key columns only — **this is not the schema**, it is a planning inventory.

| Sprint | Table                                                               | Purpose                                              | Notable columns                                                                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | `lots`                                                              | Traceable quantity                                   | `lotNumber`, `supplierLotRef`, `itemId`, `ownership`, `ownerPartyId`, `parentLotIds`, `sourceDocType/Id`, `state`                                                                                                                                                                                       |
| 1      | `lot_packages`                                                      | Physical packages (takas)                            | `packageNumber` (restarts at 1 per lot), `qty`, `parentPackageId`, `state`                                                                                                                                                                                                                              |
| 1      | `stock_ledger`                                                      | 🔴 Every movement                                    | `itemId`, `lotId`, `lotPackageId`, `locationId`, `ownership`, `qtyIn/qtyOut`, `valueIn/valueOut`, `sourceDocType/Id/LineId`, `movementType`, `postedAt`                                                                                                                                                 |
| 1      | `processes`                                                         | Operation master                                     | `name`, `itemChanges`, `rateBasis`, `preservesPackaging`, `requiresSingleLot`, `defaultTolerancePct`                                                                                                                                                                                                    |
| 2      | `routes` · `route_steps`                                            | Reusable template                                    | step: `seq`, `processId`, defaults for processor / rate / yield / tolerance                                                                                                                                                                                                                             |
| 2      | `route_step_inputs` · `route_step_outputs`                          | The template's bill of materials                     | `seq`, `itemId`, `uomId`, `plannedQty` / `expectedQty`, `isPrimary` on outputs                                                                                                                                                                                                                          |
| 2      | `job_orders`                                                        | One run                                              | `jobOrderNumber`, `inputItemId`, `inputQty`, `routeId` + `routeNameSnapshot`, `ownership`, `status`                                                                                                                                                                                                     |
| 2      | `job_order_steps`                                                   | 🔴 Snapshot of route steps                           | `seq`, `processId`, `processorType`, `processorId`, `rate`, `rateBasis`, `expectedYield`, `tolerancePct`, `status`                                                                                                                                                                                      |
| 2      | `job_order_step_inputs` · `job_order_step_outputs`                  | 🔴 What the step consumes and produces (domain §5.7) | input: `itemId`, `uomId`, `plannedQty`, `fromStock`. output: `itemId`, `uomId`, `expectedQty`, `isPrimary`                                                                                                                                                                                              |
| 3      | `job_issues` · `job_issue_lines`                                    | Challan out                                          | header: `challanNumber`, `stepId`, `processorId`, source + destination location, `isRework`, `attemptNo`. line: **`itemId`**, `uomId`, `lotId`, `lotPackageId`, `qty`. 🔴 **No `itemId` or `totalQty` on the header** — a challan carries several items, and their quantities do not add up to anything |
| 4      | `job_receipts` · `job_receipt_consumptions` · `job_receipt_outputs` | Goods back — 🔴 **two** child tables                 | consumption: `issueLineId`, `lotId`, `lotPackageId`, `consumedQty`. output: `itemId`, `uomId`, `receivedQty`, the four disposition quantities, `reasonId`, `responsibility`, `parentPackageId`, `isPrimary`, `valueShare`, `outputLotId`, `reworkLotId`                                                 |
| 4      | `rejection_reasons`                                                 | Small per-org master                                 | Free text cannot be grouped, and wastage analysis needs grouping                                                                                                                                                                                                                                        |

**Extensions to existing tables (Sprint 1)**

| Table       | Add                                                                   |
| ----------- | --------------------------------------------------------------------- |
| `items`     | `stockingUomId` (FK), `lotTracking`, `nature`, `defaultRouteId`       |
| `locations` | `type` values `processor` / `work_centre` / `godown`, plus `vendorId` |
| `vendors`   | `vendorTypes`                                                         |

Every new domain table carries the five audit columns **and** `custom_fields`, per CLAUDE.md.
`stock_ledger` is the one judgement call — it is an append-only movement log, closer to
`refresh_tokens` than to a domain entity, so it takes `createdBy`/`createdAt` but **not** `isDeleted`
or `updatedBy` (a ledger row is never edited or soft-deleted; corrections are reversing entries).

---

## 3. 🔴 Blocking decisions

The first migration cannot be written until these three are settled.

| #   | Decision                                                                                                          | Recommendation                                                                                                                                                          | Cost of changing later            |
| --- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | **Is lot value stored on the lot, or derived from the ledger?** The domain doc currently says both (§5.6 vs §7.2) | **Derived.** `stock_ledger` already carries `valueIn`/`valueOut`, so value is the same `SUM` shape as quantity, and `lots` holds only what never changes                | High — every costing query        |
| 2   | **`lot_units` or `lot_packages`?**                                                                                | **`lot_packages`.** "Unit" already means unit-of-measurement in this codebase (`Item.unit`, `units_of_measurement`); `lot_units.uom_id` reads as "the unit of the unit" | High — table rename with live FKs |
| 3   | **Valuation method**                                                                                              | **Specific-lot.** Implied by mandatory lot tracking, and what the domain doc §9 assumes throughout                                                                      | High — the whole cost model       |

---

## 4. Sprint 1 — Foundation · size M

No visible Jobwork UI except Processes. The point is to lay the plumbing and prove the full stack
with the smallest possible module.

### 4.1 Migrations

- [ ] `Item.stockingUomId` as a real FK to `units_of_measurement`
      ⚠️ **The fiddly one.** `items.prisma:9` is `unit String` today with no relation — needs a data
      backfill matching existing strings to `units_of_measurement.unitName`, and a plan for rows that
      do not match
- [ ] `Item.lotTracking` (`none` / `lot` / `lot_and_package`), `Item.nature`, `Item.defaultRouteId`
- [ ] `Location.type` — add `processor`, `work_centre`, `godown` to the existing column
- [ ] `Location.vendorId` — nullable FK, for auto-provisioned processor locations
- [ ] `Vendor.vendorTypes`
- [ ] `lots`, `lot_packages`, `stock_ledger`
- [ ] `processes`
- [ ] **RLS policy on all four new tables** — copy the two statements from `migrations/*_enable_rls`
- [ ] **Add all four to `TENANT_TABLES` in `src/db/rls.test.ts`** — a tenant table with no policy is
      unprotected and nothing will tell you

Workflow is `npm run db:draft -- <name>` → edit the SQL → `npm run db:promote` → `npm run db:apply`.
Never `db push`, never `migrate dev`.

### 4.2 Stock Ledger service

`backend/src/modules/inventory/stock-ledger/stockLedger.service.ts` — no controller, no routes.

- [ ] `postMovement(tx, {...})` — the **only** function that inserts into `stock_ledger`
- [ ] `getAvailableLots(tx, { itemId, locationId, ownership })` — the picker query
- [ ] `getBalance(tx, {...})` — derived, `SUM(qtyIn − qtyOut)`, never a stored column
- [ ] `createLot(tx, {...})` + `createPackages(tx, {...})`
- [ ] Unit tests: post → balance · reversal → zero · ownership isolation · derived value

🔴 **Nothing else may write to `stock_ledger`.** Not a seed, not a script, not a "quick fix". A wrong
number can be recomputed; a wrong history cannot. Treat this like "`authenticate` never touches the
database" — cheap to hold from day one, unrecoverable once broken.

### 4.3 Processes module

Full CRUD. The simplest module in the plan, chosen deliberately as the first — it validates routes →
controller → service → schemas → permissions → list view end to end before anything complicated
depends on that path working.

- [ ] `backend/src/modules/jobwork/processes/` — copy `src/modules/purchases/vendors/` for shape
- [ ] `web/src/features/jobwork/processes/` — list, create, edit, detail
- [ ] Inline creation from a dropdown (`+ Create "Calendaring"`) so the master never becomes a gate

The module shipped with **default issue / receive units** and a **custom-fields section**, and both
were removed on 2026-08-10. The units because a step transacts in its _items'_ stocking units
(domain §5.1) — an org-wide default on the operation master was a guess about one item, and it let a
challan and the ledger describe one movement in two units. The custom fields because the operation
master is a short list of names an org types once, so the section went unfilled; `process` moved from
`ENTITY_TYPES` to `LIST_ONLY_ENTITY_TYPES`, keeping Customize Columns without offering custom fields.
The `custom_fields` column stays on the table and is simply never written.

### 4.4 Registration

- [ ] `permissions.catalog.ts` — new `jobwork` group; add `process`
- [ ] `app_modules` seed — Jobwork parent + children
- [ ] `ENTITY_TYPES` (`customFields.constants.ts`) + `CUSTOM_FIELD_MODULES` (frontend) — **not
      `process`**, which is list-only (§4.3); a module belongs here only if it will really be used
- [ ] `listViews.catalog.ts` + `listFilters.catalog.ts` — TypeScript will not compile without both
- [ ] `NumberSequence` entity types: `lot`, `job_order`, `job_issue`, `job_receipt`

### 4.5 Done means

> A process can be created, listed, edited and soft-deleted with permissions enforced; the ledger
> service can post a movement and return a correct derived balance; `npm run db:check-drift` exits 0;
> `rls.test.ts` covers all four new tables.

---

## 5. Sprint 2 — Routes + Job Order · size L

### 5.1 Process Routes

- [ ] `routes` + `route_steps` tables
- [ ] CRUD with a drag-orderable step grid
- [ ] Per-step defaults: processor, rate, rate basis, in/out item + uom, expected yield, tolerance

### 5.2 Job Order

- [ ] `job_orders` + `job_order_steps`
- [ ] Create form — header per field-sources doc §4.1
- [ ] 🔴 **Steps are a full snapshot of the route, never a live link.** Editing a route must never
      rewrite a running job order
- [ ] A job order with **no route** must work — steps added by hand. This is what "fully flexible" means
- [ ] **Classification, not validation** (domain §6.4): for each of a step's inputs, is it produced by
      an earlier step, or drawn from stock? Label it `fromStock` and save either way — thread and
      buttons legitimately come from the godown. Only an input produced by a **later** step is
      refused, because that is an ordering mistake with no valid reading
- [ ] **Material In section** (§1.3) — creates lot + packages + ledger rows on save
- [ ] Job Orders list page
- [ ] **Overview page** — the stepper (domain doc §8.2). `[+ Issue]` / `[+ Receive]` rendered but
      disabled until Sprints 3 and 4

### 5.3 Done means

> A job order can be created from a route or by hand, its material entered as lots and takas, and the
> Overview page shows the stepper with correct per-step planned quantities and a live stock balance.

---

## 6. Sprint 3 — Issue · size L

- [ ] `job_issues` + `job_issue_lines`
- [ ] **Lot picker** — the availability query from field-sources §5.2.
      🔴 Reads the **ledger**, not the `lots` table, and filters on `ownership`
- [ ] **Taka expansion** — shown only when `lotTracking = 'lot_and_package'`. Ticking a package takes
      its full measured quantity
- [ ] Running totals: selected packages, selected qty, already issued, remaining
- [ ] **Tolerance guard** — ceiling is `plannedQty × (1 + tolerancePct/100)`; over it, block or require
      an override reason
- [ ] **Single-lot guard** — `Process.requiresSingleLot` blocks a second lot with the reason shown
- [ ] Ledger posting — `−qty` at source, `+qty` at the processor's location, auto-creating that
      location on first use
- [ ] **Printable challan (PDF)** — goods cannot legally move without it. Not deferrable
- [ ] Issues list + detail
- [ ] Enable `[+ Issue]` on the Overview page

### 6.1 Done means

> Material can be issued to a processor by lot or by taka, stock moves out of the godown and appears
> at the processor's location, the challan prints, and the step status advances.

---

## 7. Sprint 4 — Receipt · size L

- [ ] `job_receipts` + `job_receipt_lines` + `rejection_reasons`
- [ ] Issue reference multi-select — one receipt can close several issues
- [ ] 🔴 **Mode is decided by `Process.preservesPackaging`, not by the user.** Dyeing returns the same
      roll → unit-wise; cutting destroys rolls → bulk only
- [ ] Unit-wise grid rows generated from what was issued; `parentPackageId` persisted per row
- [ ] Yield strip — actual vs expected, with both units. **Never used as a conversion factor**
- [ ] **Disposition split** — accepted / rework / scrap / return-to-processor, with a sum check that
      blocks save. This is what makes a separate "Rejection Note" unnecessary
- [ ] Reason (master) + responsibility (`ours` / `theirs`)
- [ ] Output lot creation with `parentLotIds`
- [ ] **Rework child lot** — separate lot so reworked pieces are counted separately
- [ ] Rework re-issue — same step, `isRework = true`, `attemptNo = n+1`
- [ ] Preview-before-post
- [ ] Step and job order status roll-up, incl. `short_closed`
- [ ] Receipts list + detail
- [ ] Enable `[+ Receive]` on the Overview page

### 7.1 Done means

> The full loop runs: issue 5,000 m → receive 4,850 m of a **different item in a different unit** →
> reject 120 m → re-issue as rework → receive it → the job order completes, and the traceability chain
> from output lot back to the input lot is intact.

---

## 8. File layout

### 8.1 Backend

```
backend/prisma/schema/
  jobwork.prisma        processes · routes · route_steps · job_orders · job_order_steps
                        job_issues · job_issue_lines · job_receipts · job_receipt_lines
                        rejection_reasons
  inventory.prisma      lots · lot_packages · stock_ledger

backend/src/modules/jobwork/
  processes/            processes.{routes,controller,service,schemas,types}.ts
  process-routes/       processRoutes.*.ts     ← named to avoid colliding with src/routes/
  job-orders/           jobOrders.*.ts
  issues/               jobIssues.*.ts
  receipts/             jobReceipts.*.ts

backend/src/modules/inventory/
  stock-ledger/         stockLedger.service.ts  ← service only. No routes, no controller
  lots/                 lots.{routes,controller,service}.ts  ← read-only, feeds the picker
```

**Copy `src/modules/purchases/vendors/`** for module shape — `validateBody` middleware, `ApiError`,
a real service layer. **Do not copy `src/modules/organizations/`**, which predates the convention.

Mount in `src/routes/index.ts`, specific paths **before** `/organizations`:

```ts
apiRouter.use('/organizations/:orgId/jobwork/processes', processesRouter);
apiRouter.use('/organizations/:orgId/jobwork/routes', processRoutesRouter);
apiRouter.use('/organizations/:orgId/jobwork/job-orders', jobOrdersRouter);
apiRouter.use('/organizations/:orgId/jobwork/issues', jobIssuesRouter);
apiRouter.use('/organizations/:orgId/jobwork/receipts', jobReceiptsRouter);
apiRouter.use('/organizations/:orgId/inventory/lots', lotsRouter);
```

Each router: `Router({ mergeParams: true })`, then `authenticate, tenantContext`, then
`requirePermission` per route. Controllers read `req.tenantId`, never `req.params.orgId`.

### 8.2 Frontend

```
web/src/features/jobwork/
  JobworkPage.tsx                 ← copy features/purchases/PurchasesPage.tsx
  processes/                      processes.api.ts · processes.schemas.ts
                                  ProcessesList · CreateProcess · ProcessDetail
  process-routes/                 RoutesList · CreateRoute · RouteStepsGrid
  job-orders/                     JobOrdersList · CreateJobOrder · JobOrderOverview
                                  JobOrderStepper · MaterialInSection
  issues/                         IssuesList · IssueDialog · LotPicker · IssueDetail
  receipts/                       ReceiptsList · ReceiveDialog · DispositionSplit
```

---

## 9. Theme — reuse, do not rebuild

Everything below exists and is already keyboard-correct. Building new versions is how the app starts
looking like two apps.

| Need                 | Use                                                                               |
| -------------------- | --------------------------------------------------------------------------------- |
| Dropdowns            | `components/ui/Select.tsx` · `SearchableSelect.tsx` · `ComboBox.tsx`              |
| List page            | Copy `features/purchases/vendors/VendorsList.tsx` — search + pagination + columns |
| Pagination           | `components/ui/Pagination.tsx`                                                    |
| Column customisation | `components/ui/CustomizeColumnsModal.tsx`                                         |
| List filters         | `components/ui/ListFilterDropdown.tsx`                                            |
| Detail page          | Copy `VendorDetail.tsx` — activity timeline + comments tabs                       |
| Forms                | Copy `VendorForm.tsx` · `Input.tsx` · `Button.tsx`                                |
| Confirmations        | `ConfirmDialog.tsx`                                                               |
| Loading              | `Spinner.tsx`                                                                     |
| Number config modal  | Copy `VendorNumberConfigModal.tsx`                                                |

**Only two screens are genuinely new UI:** the Issue dialog and the Receive dialog. Everything else is
an existing pattern with different fields.

⚠️ Both new dialogs are modals containing grids. Per CLAUDE.md that means: focus taken on open,
**trapped** while open, Esc closes, focus returns to the trigger. Lot picker rows are
`<button type="button">`, never `<div onClick>` — Tab skips a div and neither `tsc -b` nor a
screenshot will say a word. `Select.tsx` is the template. Never a positive `tabIndex`.

---

## 10. Per-module registration checklist

Four steps, every module, no exceptions:

1. [ ] **`permissions.catalog.ts`** — add the resource to the `jobwork` group.
       Forgetting this fails **closed** (nobody can act — loud)
2. [ ] **`requirePermission('<resource>:<action>')` on every route.**
       Forgetting this fails **open and silently** — same shape as a tenant table with no RLS policy
3. [ ] **`ENTITY_TYPES`** (backend) + **`CUSTOM_FIELD_MODULES`** (frontend)
4. [ ] **`listViews.catalog.ts`** + **`listFilters.catalog.ts`** — the build fails without both

Resources to register: `process` · `process_route` · `job_order` · `job_issue` · `job_receipt` ·
`lot` (read only).

---

## 11. Deferred, and what carries the gap

| Deferred                   | What carries Sprints 1–4                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| Purchase Received          | Material In on the Job Order (§1.3)                                                                 |
| Opening Stock screen       | Same                                                                                                |
| Stock on Hand report       | The stock summary on the Job Order Overview                                                         |
| Purchase Bill              | Material value entered on Material In                                                               |
| Jobwork Bill               | Estimated cost from `step.rate`                                                                     |
| Sales Order                | Nothing — the field is omitted, not stubbed                                                         |
| Delivery Challan / Invoice | Nothing — output stays in stock                                                                     |
| E-way bill integration     | **Record the fields from Sprint 3**; generate later                                                 |
| Costing & P&L reports      | Value accumulates correctly in the ledger from Sprint 1, so the reports are additive when they come |

The three things that would be **expensive** to defer are already in Sprint 1 and must not slip:
`lots.ownership`, `lots.parentLotIds`, and `custom_fields` on every new table.

---

## 12. Sprint 5 — Multi-item steps · size L

_(Added 2026-08-06. Placed last so nothing above it renumbers — code comments and the other two docs
cite these section numbers.)_

Sprints 1–4 shipped with one input item and one output item per step. Domain doc §5.7 replaced that
with a set on each side. This is what it takes.

### 12.1 Order of work

Each step leaves the app running. Nothing here is a big-bang cutover.

| #   | Step                                                                                                | Notes                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| #   | Step                                                                                                | Notes                                                                                                                                           | State                                |
| --- | ---                                                                                                 | ---                                                                                                                                             | ---                                  |
| 1   | Extend `jobwork.flow.test.ts` with a multi-item order                                               | It is the regression net for every step below                                                                                                   | ✅ done — 23 tests                   |
| 2   | **Migration A** — create the six tables, backfill from the scalar columns, **keep the old columns** | Reversible. Nothing reads the new tables yet, so this can ship on its own                                                                       | ✅ `20260806112805_multi_item_steps` |
| 3   | Steps: inputs/outputs, `classifyStepInputs`, planned quantities                                     | `jobOrders.service.ts`                                                                                                                          | ✅                                   |
| 4   | Issue: item on the line, per-item totals, `totalQty` dropped                                        | `jobIssues.service.ts` + `jobOrders.status.ts`                                                                                                  | ✅                                   |
| 5   | Receipt: consumptions + outputs + the value split                                                   | `jobReceipts.service.ts`                                                                                                                        | ✅                                   |
| 6   | UI: route + job order step grids                                                                    | `StepsGrid.tsx` grows two nested lists                                                                                                          | ✅                                   |
| 7   | UI: Issue dialog — one lot picker section per input                                                 |                                                                                                                                                 | ✅                                   |
| 8   | UI: Receive dialog — consumed grid + returned grid                                                  |                                                                                                                                                 | ✅                                   |
| 9   | **Migration B** — drop the old scalar columns                                                       | 🔴 **Only after 3–8 have shipped.** Dropping them in the same migration means any instance still running the old build 500s on every list query | ⬜ remaining                         |

Migration B needs `-- @destructive-ok: <reason>` before `db:promote` will take it. Migration A did
not: it only added.

Two further migrations landed with this sprint and are **not** in the list above, because they came
out of building it rather than from the plan:

|                                                  |                                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260807050131_per_item_tolerance`              | `job_order_step_inputs.tolerance_pct` — fabric at 3% beside thread at 25%. One percentage across three items is either too tight for one or meaningless for another |
| `20260807074201_job_order_header_items_optional` | `job_orders.input_item_id` / `input_qty` became nullable — see §12.5                                                                                                |

### 12.5 What Sprint 5 changed that this plan did not predict

Building it moved four things. Each is recorded because the code now disagrees with what is written
above, and a plan that quietly stops matching the code is worse than no plan.

**1. 🔴 The job order header lost its item and quantity (2026-08-07).**
A step consumes a SET of items, so one item and one quantity on the document that owns all of them
could only ever describe one — and it would be the field everybody then trusted. Both columns are now
**CALC+**: derived from step 1's first consumed row, stored for the list page, never sent by a client.
They are nullable because a step that lists nothing yet has nothing to derive from.

**2. 🔴 Material In was retired early — before Purchase Received exists.** See §1.3, which this
supersedes, and `PURCHASE_RECEIVED_AND_ITEMS_SPEC.md` §7. What replaced it is a deliberate,
clearly-marked scaffold rather than another inward document: see §12.6.

**3. Taka-level movement is switched off on both sides.** Issue and receive are LOT level. The
unit-wise code paths are intact and unreachable, behind two named switches — `mode = 'bulk'` in
`jobReceipts.service.ts` and `PACKAGE_LEVEL` in the web `LotPicker`. Domain §5.2.3 and §6.1 still
describe the model; nothing about it was decided against, it is simply more than the shop floor
needs today. The cost is real and worth restating: while it is off, **no 1:1 mapping from the roll
that went out to the roll that came back is recorded, and it cannot be reconstructed afterwards.**

**4. A step cannot issue until the step before it has returned something.** New rule, in
`jobOrders.status.ts` → `chainNotReady`, enforced by both the Overview button and
`createNewJobIssue`. It is measured **by position**, not by matching items — see domain §6.4, which
this extends.

Two UI fields were dropped for the same reason and are worth naming so they are not "restored" by
someone reading the older sections: **`expectedYield`** (one ratio cannot relate three inputs to two
outputs, and every output already carries its own expected quantity) and the **by-product value box**
(every by-product is recorded at ₹0 and the primary absorbs the pot, which is §9.2.1's own default).
`Process.preservesPackaging` and `requiresSingleLot` came off the Process form with them.

### 12.6 ⚠️ The no-stock scaffold — temporary, and how to remove it

Material In went before Purchase Received arrived, so for now **there is no way to put stock on the
books**. Rather than leave the whole loop untestable, four places relax:

| Where                                   | What it does                                                                       | Restore to                    |
| --------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------- |
| `jobOrders.service.ts` → `canIssue`     | Enabled by the step having inputs, not by a balance                                | `availableQty.greaterThan(0)` |
| `jobIssues.schemas.ts` → `lotId`        | Optional                                                                           | required                      |
| `jobIssues.service.ts` → `resolveLines` | A line with no lot creates one, posting an `opening` movement at **zero value**    | delete the branch             |
| `IssueDialog.tsx`                       | A quantity box when an item has no lots, and a godown fallback for the source list | delete both                   |

All four carry ⚠️ comments pointing at each other; `grep -rn "TEMPORARY" src/modules/jobwork
src/features/jobwork` finds them.

🔴 **Zero value is the load-bearing part.** Quantities behave normally through issue, receipt, rework
and every status, while costing reports nothing rather than reporting a number nobody entered. Stock
that appears because somebody issued it is stock nobody received — this comes out the day Purchase
Received lands.

### 12.2 What does NOT change

Worth stating, because the instinct is to touch all of it:

- **The stock ledger.** `postMovement` takes the item from the **lot**, so multi-item documents post
  exactly the same rows. No migration, no reversal, no history rewritten
- **Lots and packages.** `parentLotIds` is already a uuid array because a lot has _"zero, one, or
  many"_ parents — many-to-many genealogy needs no schema change
- **Material In**, which posts against the job order's own `inputItemId`
- **The job order header** — `inputItemId` / `inputQty` stay, and still seed step 1's first input
- **§5.1's rule.** One item still has exactly one stocking unit. What changed is how many items a step
  names, never how many units an item has

### 12.3 The data migration, in outline

Every existing job order must keep working, so the backfill is one row per old scalar column:

```sql
-- one input row per step, from the old scalar columns
INSERT INTO job_order_step_inputs (id, organization_id, job_order_step_id, seq, item_id, uom_id, planned_qty)
SELECT gen_random_uuid(), organization_id, id, 1, issue_item_id, issue_uom_id, planned_input_qty
FROM   job_order_steps WHERE issue_item_id IS NOT NULL;

-- one output row per step, flagged primary
INSERT INTO job_order_step_outputs (id, organization_id, job_order_step_id, seq, item_id, uom_id, is_primary)
SELECT gen_random_uuid(), organization_id, id, 1, receive_item_id, receive_uom_id, true
FROM   job_order_steps WHERE receive_item_id IS NOT NULL;

-- issue lines inherit the header's item
UPDATE job_issue_lines l SET item_id = i.item_id, uom_id = i.uom_id
FROM   job_issues i WHERE l.job_issue_id = i.id;

-- one output row per receipt, from the header and its totals
INSERT INTO job_receipt_outputs (
  id, organization_id, job_receipt_id, seq, item_id, uom_id, is_primary,
  received_qty, accepted_qty, rework_qty, scrap_qty, returned_qty, output_lot_id, rework_lot_id)
SELECT gen_random_uuid(), organization_id, id, 1, output_item_id, output_uom_id, true,
       total_received_qty, total_accepted_qty, total_rework_qty, total_scrap_qty, total_returned_qty,
       output_lot_id, rework_lot_id
FROM   job_receipts;
```

🔴 **Six new tables means six RLS policies and six entries in `TENANT_TABLES` (`src/db/rls.test.ts`).**
A tenant table with no policy is unprotected and nothing will tell you.

### 12.4 Done means

> A step can be created with three inputs and two outputs; a challan can issue two of those three
> items and save; a second challan issues the third; one receipt consumes all three and produces two
> output lots with the value conserved to the paisa; the step reaches `completed` only when every
> input's consumed quantity has caught up with its issued quantity; genealogy from each output lot
> back to all three input lots is intact; `npm run db:check-drift` exits 0; `rls.test.ts` covers all
> six new tables.
