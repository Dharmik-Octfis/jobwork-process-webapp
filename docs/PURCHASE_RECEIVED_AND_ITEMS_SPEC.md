# Purchase Received & Item Changes — Implementation Spec

> ### 🔴 2026-08-12 — "lot" is now "batch", and package tracking is gone
>
> **`lots` → `batches`** (plus `lot_number`/`supplier_lot_ref`/`parent_lot_ids`/`lot_id` →
> `batch_*`), a pure rename that changed no data. New numbers mint as `BATCH-00001`; numbers
> already on physical tags keep `LOT-`.
>
> **Package-level (per-taka) tracking was REMOVED end to end** — `lot_packages`, every
> `lot_package_id`, `parent_package_id`, `Process.preservesPackaging` and `JobReceipt.mode`.
> Quantity granularity stops at the batch. `Item.lot_tracking` went too; `inventory_tracking`
> (`none | batch`) is now the single tracking column and the item form writes it.
>
> **Text below about takas, packages, unit-wise receiving or `lot_packages` is HISTORY.** It is
> kept for the reasoning, which is where re-adding packages would start.

**Status:** design, agreed 2026-08-06. No code written from it yet.

**What this is.** Sprints 1–4 shipped the jobwork loop with **Material In on the Job Order** standing
in for a real inward-goods document (`JOBWORK_IMPLEMENTATION_PLAN.md` §1.3). This document specifies
the module that replaces it, and the Item changes that have to land with it. It exists so the module
can be built from one place instead of from a conversation.

**Companion documents**

|                                    |                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `JOBWORK_DOMAIN_AND_MODULE_MAP.md` | Why the domain is shaped this way. §5.2 (batches), §5.3 (ownership), §5.6 (derived balances) are load-bearing here |
| `JOBWORK_UI_FIELD_SOURCES.md`      | The `AUTO` / `CTX` / `MASTER` / `INHERIT` / `SNAP` / `LEDGER` / `CALC` / `INPUT` / `CF` tagging used in §5 below   |
| `JOBWORK_IMPLEMENTATION_PLAN.md`   | Sprints 1–4, and §1.3 which this document supersedes                                                               |

---

## 1. The five decisions

Each was taken deliberately, and each has an intuitive alternative that was rejected. Changing one of
these later is not a refactor.

### D1 — Purchase Received accepts a receipt with **or without** a purchase order

The module carries a `sourceType` with four values. One document, four ways material can arrive.

**Rejected:** PR receives only against a PO. That leaves three real cases uncovered — a cash purchase
with no PO, a customer's goods sent for jobwork, and go-live opening stock — and each uncovered case
becomes a second document that writes stock. Two stock-creating documents for the same physical
consignment is how a godown ends up holding twice what it holds.

The domain doc already assumed this: §7.4 says receiving a customer's goods is _"a Purchase Received
with `ownership = customer`"_, which is only possible if PR works with no PO and no vendor.

### D2 — Opening stock is a ledger posting, never a column on the Item

`items.opening_stock` and `items.opening_stock_value_per_unit` exist today and **nothing reads them**
(verified 2026-08-06: captured in `items.schemas.ts`, echoed by `items.service.ts`, rendered on
`CreateItemPage.tsx` / `EditItemPage.tsx`, and read by no balance, report or ledger query).

A single number on the item cannot express which batch, which location, which packages, whose goods, or
when they arrived — and every one of those is required before the Issue screen can offer the stock.
It is also a column, so it gets `UPDATE`d, which contradicts the append-only ledger (§5.6).

**Rejected:** wiring the existing columns up. See §3.3 for what happens to them instead.

### D3 — Material In retires when PR ships; it does not become a second doorway

Once PR exists, the Job Order's Material In section is removed from the create form and replaced by a
**`+ Receive material`** button that opens the PR dialog pre-filled with the job order's item,
ownership and owning party.

**Rejected:** keeping both. Material In has no document number, no edit, no cancel, no reversal and no
list page. PR has all five. Keeping both means the same consignment can be entered twice, and nothing
in the system can detect it because both entries are individually valid.

Existing Material In data is untouched — see §7.

### D4 — FIFO is a suggested pick order, never a valuation method

Valuation stays **specific-batch** (`JOBWORK_IMPLEMENTATION_PLAN.md` §3, decision 3). FIFO may order the
batch picker and nothing more.

The cost model in domain doc §9 carries a total value on the batch and derives the rate; traceability
(§8.5), shade matching (§5.2.4) and the 180-day ageing report (§5.4) all need batch identity preserved.
A cost-flow assumption over a pool destroys exactly that.

⚠️ **Today's picker is not FIFO and does not claim to be.** `getAvailableBatches` sorts by
`batchNumber.localeCompare()`. Field-sources §5.2 specifies `ORDER BY l.created_at` plus an Age column,
and domain doc §5.2.2 is explicit that the batch number carries no meaning. Fix this when PR lands —
the ageing report needs the same `postedAt`-based age anyway. See §9.

### D5 — Ownership alone does not scope the batch picker

`balanceWhere` in `stockLedger.service.ts` filters `ownership` but never `ownerPartyId`, though
`stock_ledger.owner_party_id` is populated on every row.

Two inward-jobwork orders for two different customers, same item, same godown → customer A's batch is
offered in customer B's job order. Field-sources §10 lists this exact scenario as a defect class; the
SQL in field-sources §5.2 has the same gap. **This is a bug to fix with PR**, because PR is what makes
multi-customer stock common. See §9.

---

## 2. What PR is, and what it is not

|                              |                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **It is**                    | The document that records goods physically arriving, and the only thing (after D3) that creates inward stock               |
| **It is not**                | A price document. Rate is captured provisionally; the Purchase Bill and three-way match remain deferred (domain doc §11.2) |
| **It is not**                | A quality document. Inspection/rejection of purchased goods is out of scope for v1 — everything received is accepted       |
| **Writes to the ledger via** | `stockLedger.service.ts` only. `postMovement`, `createBatch`, `createPackages`. Nothing else, ever                         |

---

## 3. Item changes

### 3.1 What already exists (Sprint 1 — no work needed)

| Column              | State                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| `stockingUomId`     | ✅ FK to `units_of_measurement`, nullable. Backfilled from the legacy `unit` string |
| `inventoryTracking` | ✅ `none` / `batch` / `batch`, default `none`                                       |
| `nature`            | ✅ `raw` / `semi_finished` / `finished` / `consumable` / `scrap` / `service`        |
| `defaultRouteId`    | ✅ plain uuid, no FK yet                                                            |

### 3.2 Required changes

| #       | Change                                                                                                                                                                                                                                                                                                                              | Why                                                                                                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **I-1** | **Surface `stockingUomId`, `inventoryTracking` and `nature` on the item form.** They exist in the database and are set by nothing in the UI today                                                                                                                                                                                   | PR cannot receive an item with no stocking uom (§4.6 V-2), and `inventoryTracking` decides whether the taka grid appears at all. Leaving them invisible means every new item defaults to `inventoryTracking = 'none'` and no user can change it        |
| **I-2** | **Block PR (not item save) when `stockingUomId` is null.** A clear message: _"Set a stocking unit on «item» before receiving it."_                                                                                                                                                                                                  | The backfill left unmatched rows null on purpose — a loud, fixable failure beats a silently wrong balance (`items.prisma:37`). Do **not** make the column required by migration: that would need a value invented for every unmatched row              |
| **I-3** | **Remove `openingStock` and `openingStockValuePerUnit`** from the form, the Zod schemas, the service mapping and finally the table                                                                                                                                                                                                  | D2. A field a user fills, that saves, and that does nothing, is worse than a missing field — they believe they have stock and they have none                                                                                                           |
| **I-4** | ✅ **DONE 2026-08-12 — both are now live.** `trackInventory` = is this item stocked at all; `inventoryTracking` = `none \| batch`, NOT NULL, lowercase. The third column they duplicated (`lot_tracking`) was dropped and every jobwork reader repointed at `inventoryTracking`, so the item form's radio finally changes behaviour | It was the worst version of I-3: a control the user could set, that saved, and that nothing read — so ticking "Batch" produced an item tracking nothing. Backed with real logic rather than dropped, because the form already asked the right question |
| **I-5** | **Leave the legacy `unit` string alone** for now                                                                                                                                                                                                                                                                                    | It is what the item form shows today. `stockingUomId` is what the ledger uses. Collapsing the two is a separate, larger change and is not blocking                                                                                                     |

### 3.3 Migration order for I-3 / I-4

Dropping a column that the frontend still posts produces a 500 on every item save. Sequence:

1. Remove the fields from `CreateItemPage.tsx` / `EditItemPage.tsx`
2. Remove them from `items.schemas.ts` (create + update) and the `items.service.ts` mapping
3. Deploy
4. `npm run db:draft -- drop_dead_item_stock_columns` → the generated SQL will be destructive, so the
   file needs `-- @destructive-ok: dead columns, never read, replaced by stock_ledger` before
   `db:promote` will accept it
5. `npm run db:promote` → `npm run db:apply`

### 3.4 The one item-form shortcut that is allowed

For items with `inventoryTracking = 'none'` — buttons, thread, dye chemicals, packing tape — an opening
quantity genuinely is one number.

An "Opening quantity" + "Location" pair **may** appear on the item **create** form for those items
only, provided it:

- posts through `createBatch` + `postMovement` with `movementType: 'opening'` — never a column
- is **create-only**; it disappears on edit. Corrections go through a stock adjustment, not by
  retyping a number
- is skipped entirely when `inventoryTracking` is `batch` or `batch`

This is a convenience over the same code path, not a second mechanism. If it is not built, nothing
breaks — PR's `opening_balance` source type covers it.

---

## 4. Purchase Received — the module

### 4.1 The four source types

`sourceType` is the field the whole form keys off.

| `sourceType`        | Counterparty          | PO           | Ownership                   | Value                 | `movementType` |
| ------------------- | --------------------- | ------------ | --------------------------- | --------------------- | -------------- |
| `purchase_order`    | Vendor (from the PO)  | **Required** | `own`                       | From the PO line rate | `receipt`      |
| `direct`            | Vendor (picked)       | none         | `own`                       | Typed                 | `receipt`      |
| `customer_supplied` | **Customer** (picked) | none         | `customer` + `ownerPartyId` | **Forced to 0**       | `receipt`      |
| `opening_balance`   | none                  | none         | `own`                       | Typed                 | `opening`      |

Everything else on the form is identical across the four. That is the point — one grid, one taka
entry screen, one ledger write path.

🔴 **The zero value on `customer_supplied` is not enforced here.** `postMovement` already zeroes
`valueIn`/`valueOut` whenever the batch's ownership is `customer` (`stockLedger.service.ts:135`). PR
passes whatever it has and the rule stays in one place. Do not re-implement it.

### 4.2 Status vocabulary

```
posted → cancelled
```

**There is no draft in v1.** A draft would need somewhere to hold typed package quantities before the
batch exists, which means a staging table that duplicates `lot_packages` — for a document that in
practice is filled and saved at the gate in one sitting. Material In has worked this way through
Sprints 2–4.

If a draft is added later, hold the packages as JSONB on the line and materialise them at post. Do not
add a second package table.

### 4.3 Schema

Two tables. Packages are **not** a third table — they are `lot_packages`, created by the post.

```prisma
model PurchaseReceipt {
  id             String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String @map("organization_id") @db.Uuid

  /// PR-00001, from NumberSequence('purchase_receipt') — the prefix is already
  /// reserved (numberSequence.ts). Allocated INSIDE the save transaction (§2.2).
  receiptNumber String   @map("receipt_number") @db.VarChar(50)
  receiptDate   DateTime @map("receipt_date") @db.Date

  /// purchase_order | direct | customer_supplied | opening_balance
  sourceType String @map("source_type") @db.VarChar(30)

  purchaseOrderId String? @map("purchase_order_id") @db.Uuid
  vendorId        String? @map("vendor_id") @db.Uuid
  /// Plain uuid, no FK — matching Batch.ownerPartyId (inventory.prisma:56). An FK
  /// is checked OUTSIDE RLS and so accepts another org's id anyway; the check
  /// that matters lives in the service either way.
  customerId      String? @map("customer_id") @db.Uuid

  /// Where the goods physically landed. type IN ('godown','shopfloor').
  locationId String @map("location_id") @db.Uuid

  /// own | customer. Derived from sourceType, STORED — a ledger row is a
  /// historical fact and must not change if the source type is ever reinterpreted.
  ownership    String  @default("own") @db.VarChar(20)
  ownerPartyId String? @map("owner_party_id") @db.Uuid

  /// §2.4 — reprinting last August's receipt must show last August's address.
  partyNameSnapshot    String? @map("party_name_snapshot") @db.VarChar(255)
  partyGstinSnapshot   String? @map("party_gstin_snapshot") @db.VarChar(20)
  partyAddressSnapshot String? @map("party_address_snapshot")

  transporterId String? @map("transporter_id") @db.Uuid
  vehicleNo     String? @map("vehicle_no") @db.VarChar(30)
  lrNumber      String? @map("lr_number") @db.VarChar(50)
  lrDate        DateTime? @map("lr_date") @db.Date

  remarks String?

  /// posted | cancelled
  status         String    @default("posted") @db.VarChar(20)
  postedAt       DateTime  @default(now()) @map("posted_at") @db.Timestamptz(6)
  cancelledAt    DateTime? @map("cancelled_at") @db.Timestamptz(6)
  cancelledBy    String?   @map("cancelled_by") @db.Uuid
  cancelReason   String?   @map("cancel_reason")

  customFields Json @default("{}") @map("custom_fields")
  // + the five audit columns, per CLAUDE.md

  @@unique([organizationId, receiptNumber])
  @@index([organizationId, receiptDate])
  @@map("purchase_receipts")
}

model PurchaseReceiptLine {
  id             String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  /// Denormalised so this table carries its own RLS policy, like lot_packages.
  organizationId String @map("organization_id") @db.Uuid

  purchaseReceiptId  String  @map("purchase_receipt_id") @db.Uuid
  /// Set only when sourceType = purchase_order. Ordered qty is read through it.
  purchaseOrderItemId String? @map("purchase_order_item_id") @db.Uuid

  itemId           String  @map("item_id") @db.Uuid
  itemNameSnapshot String? @map("item_name_snapshot") @db.VarChar(255)
  /// Snapshot of Item.stockingUomId at receipt. One item, one stocking unit.
  uomId            String? @map("uom_id") @db.Uuid

  receivedQty Decimal  @map("received_qty") @db.Decimal(18, 4)
  /// Provisional until the Purchase Bill ships. Null for customer_supplied.
  rate        Decimal? @db.Decimal(18, 4)
  /// receivedQty × rate, or typed directly. Ignored when ownership = customer.
  value       Decimal? @db.Decimal(18, 4)

  /// The batch this line created. Written at post; this is the traceability anchor.
  batchId          String? @map("batch_id") @db.Uuid
  supplierBatchRef String? @map("supplier_batch_ref") @db.VarChar(100)

  remarks String?

  customFields Json @default("{}") @map("custom_fields")
  // + the five audit columns

  @@index([organizationId, purchaseReceiptId])
  @@map("purchase_receipt_lines")
}
```

**`orderedQty` is deliberately not a column.** It is `purchase_order_items.quantity`, reachable
through `purchaseOrderItemId`. Copying it would let the two disagree after a PO revision.

🔴 **Both tables need an RLS policy and an entry in `TENANT_TABLES` (`src/db/rls.test.ts`).** A tenant
table with no policy is unprotected and nothing will tell you.

### 4.4 New constants

| Where                                                        | Add                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `SOURCE_DOC_TYPES` (`jobwork.types.ts`, or a shared module)  | `purchaseReceipt: 'purchase_receipt'`                              |
| `Batch.sourceDocType` values                                 | `purchase_receipt` — for all four source types                     |
| `ENTITY_TYPES` (`customFields.constants.ts`)                 | `purchase_receipt`                                                 |
| `CUSTOM_FIELD_MODULES` (`customFields.schemas.ts`, frontend) | same                                                               |
| `listViews.catalog.ts` + `listFilters.catalog.ts`            | `purchase_receipt` — TypeScript will not compile without both      |
| `NUMBER_SEQUENCE_DEFAULTS`                                   | ✅ already there — `purchase_receipt: { prefix: 'PR-', width: 5 }` |

**One `sourceDocType` for all four source types**, not four. `movementType` already separates
`opening` from `receipt`, and the receipt row carries `sourceType` for anything finer. Two columns
saying the same thing is how they start disagreeing.

### 4.5 Field-by-field sources

Tags per `JOBWORK_UI_FIELD_SOURCES.md` §1.

**Header**

| Field                     | Tag                  | Source and filter                                                                                      |
| ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| Receipt number            | `AUTO`               | `NumberSequence('purchase_receipt')`, allocated **in the save transaction**. Shows `(auto)` until save |
| Receipt date              | `CTX`                | Server date, editable. Not in the future                                                               |
| **Source type**           | `INPUT`              | The four of §4.1. Everything below is conditional on it                                                |
| Purchase Order            | `MASTER`             | `purchase_orders` where `status IN ('open','partially_received')`. Only when `purchase_order`          |
| Vendor                    | `MASTER` / `INHERIT` | Inherited + locked from the PO; picked when `direct`, filtered `vendorTypes @> ['material_supplier']`  |
| Customer                  | `MASTER`             | Only when `customer_supplied`. `customers` where `isJobworkParty` if that flag exists, else all active |
| Party snapshots           | `SNAP`               | Name, GSTIN, address frozen at save                                                                    |
| Location                  | `MASTER`             | `locations` where `type IN ('godown','shopfloor')`. Auto-selected when the org has one                 |
| Ownership                 | `CALC+`              | Derived from source type, stored. Not a user field                                                     |
| Transporter               | `MASTER`             | `vendorTypes @> ['transporter']`                                                                       |
| Vehicle / LR no / LR date | `INPUT`              |                                                                                                        |
| Custom fields             | `CF`                 | `entityType = 'purchase_receipt'`                                                                      |

**Lines**

| Column             | Tag                  | Source                                                                                             |
| ------------------ | -------------------- | -------------------------------------------------------------------------------------------------- |
| Item               | `MASTER` / `INHERIT` | Pre-filled from the PO lines when `purchase_order`; picked otherwise, `isActive AND NOT isDeleted` |
| UoM                | `INHERIT`            | `Item.stockingUomId`. **Read-only**                                                                |
| Ordered qty        | `INHERIT`            | `purchase_order_items.quantity`. Read-only, blank for the other three source types                 |
| Already received   | `CALC`               | `SUM(received_qty)` over posted receipt lines for that PO line                                     |
| **Received qty**   | `INPUT`              | The main typed column                                                                              |
| Rate               | `INHERIT` / `INPUT`  | PO line rate, editable. Hidden for `customer_supplied`                                             |
| Value              | `CALC` / `INPUT`     | `receivedQty × rate`, overridable. Forced to 0 for `customer_supplied`                             |
| Batch number       | `AUTO` / `INPUT`     | Blank → `NumberSequence('batch')`. Typed when the physical tag already carries one                 |
| Supplier batch ref | `INPUT`              | The vendor's batch number, the heat number, whatever the tag says                                  |

**Package (taka) grid — per line, only when `Item.inventoryTracking = 'batch'`**

| Column           | Tag     | Source                                                                              |
| ---------------- | ------- | ----------------------------------------------------------------------------------- |
| Package no.      | `AUTO`  | Restarts at 1 inside the batch. Assigned by `createPackages`                        |
| Label            | `INPUT` | Defaults to `<batchNumber>/<n>`; mills override with the supplier's own taka number |
| **Measured qty** | `INPUT` | The whole reason `lot_packages` exists. No two are the same                         |
| Sum vs line qty  | `CALC`  | Live. Must match exactly before save (V-4)                                          |

A **"generate N rows"** helper is worth building — 50 takas is the worked example in domain doc §A.1,
and 50 manual row-adds is how a user gives up on the screen.

### 4.6 Validation rules

| #        | Rule                                                                                                                                                  | Failure                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **V-1**  | Source-type conditionals: `purchase_order` needs a PO; `direct` needs a vendor; `customer_supplied` needs a customer; `opening_balance` needs neither | 400 with the field keyed                                                                                            |
| **V-2**  | Every line's item must have `stockingUomId` set                                                                                                       | 400: _"Set a stocking unit on «item» before receiving it"_                                                          |
| **V-3**  | Packages may only be entered when `Item.inventoryTracking = 'batch'`                                                                                  | 400 — copy the message from `jobOrders.service.ts:336`                                                              |
| **V-4**  | `SUM(packages.qty) === line.receivedQty`, exactly                                                                                                     | 400. **Never silently overwrite one with the other** — one of the two is a typo and guessing invents or loses stock |
| **V-5**  | `receivedQty > 0`                                                                                                                                     | 400                                                                                                                 |
| **V-6**  | The PO, its lines, the vendor, the customer, the item, the uom and the location all belong to this org                                                | 400. FK checks bypass RLS in Postgres — the service must check                                                      |
| **V-7**  | A PO line's item must equal the receipt line's item                                                                                                   | 400                                                                                                                 |
| **V-8**  | Over-receipt against ordered qty → **warn, do not block**                                                                                             | Partial and over deliveries are normal (domain doc §6.1)                                                            |
| **V-9**  | `receiptDate` not in the future                                                                                                                       | 400                                                                                                                 |
| **V-10** | Custom fields validated through `customFields.engine.ts` in the **same** transaction                                                                  | 400 with `customFields.<key>` details                                                                               |

### 4.7 What the save writes

In one transaction, in this order:

1. `allocateNumber(tx, orgId, 'purchase_receipt')` → the receipt number
2. `purchase_receipts` header, `status: 'posted'`, with the party snapshots
3. For each line:
   1. `purchase_receipt_lines` row
   2. `createBatch(tx, { itemId, uomId, batchNumber?, supplierBatchRef, ownership, ownerPartyId, sourceDocType: 'purchase_receipt', sourceDocId: receipt.id, parentBatchIds: [] })`
   3. write `batchId` back onto the line
   4. when packages were entered: `createPackages(tx, { batchId, packages })`
   5. `postMovement` — **one row per package**, or one row for the batch when there are none.
      `movementType` per §4.1, `qtyIn` = the measured quantity, `valueIn` = that package's share
4. Nothing else. PO status is **derived**, not written — see §4.9

🔴 **Value is spread across packages pro-rata, remainder on the last row.** Copy
`jobOrders.service.ts:407-428` exactly. Putting the whole amount on the first taka makes one roll
carry the cost of forty, and every per-unit cost derived from it is wrong.

🔴 **Use `runAsDocument`, not `runAsTenant`.** A 50-taka receipt writes ~100 rows through
`postMovement`, each of which re-reads its batch; Prisma's 5-second default transaction timeout is
comfortably exceeded and the failure shape is a half-written document. `runAsDocument` already exists
in `jobwork.types.ts` — move it somewhere shared (`src/lib/`) rather than importing jobwork from
purchases.

### 4.8 Cancel

Cancelling posts **reversing entries**; it never edits or deletes (§5.6).

1. 🔴 **Refuse if the stock has moved on.** For every batch the receipt created, if any ledger row exists
   with `sourceDocId != receipt.id`, block: _"PR-00012 cannot be cancelled — BATCH-00044 has already
   been issued."_ Reversing stock that is no longer there produces a negative balance and there is no
   good answer to it
2. For every ledger row the receipt wrote, post its opposite with `movementType: 'reversal'` and a
   `remarks` carrying the reason
3. `status → 'cancelled'`, stamp `cancelledAt` / `cancelledBy` / `cancelReason`
4. Soft-delete the batches and packages the receipt created (they now hold zero and must not appear in
   any picker)

### 4.9 PO linkage

- **Received quantity per PO line** = `SUM(received_qty)` over posted receipt lines. Derived, never
  stored
- **PO status roll-up** — `open → partially_received → received`. Recomputed by a service function
  after every post and every cancel, the same shape as `jobOrders.status.ts`
- **A "Receipts" tab on the PO detail page**, listing the PRs raised against it
- ⚠️ This is a change to the **Purchase Orders** module, which uses snake_case Prisma fields unlike
  every other model (domain doc §7.3). Budget for the friction

### 4.10 Routes, permissions, files

```ts
// src/routes/index.ts — before the generic /organizations mount
apiRouter.use('/organizations/:orgId/purchases/receipts', purchaseReceiptsRouter);
```

`Router({ mergeParams: true })` → `authenticate, tenantContext` → `requirePermission` per route.
Controller reads `req.tenantId`, never `req.params.orgId`.

| Route                | Permission                |
| -------------------- | ------------------------- |
| `GET /` · `GET /:id` | `purchase_receipt:read`   |
| `POST /`             | `purchase_receipt:create` |
| `POST /:id/cancel`   | `purchase_receipt:update` |

**No `PUT` and no `DELETE`.** A posted ledger document is corrected by reversal, not by editing.
`purchase_receipt:delete` should not exist in the catalog — a checkbox that describes no screen is
worse than a missing one (the same reasoning that made `batch` read-only).

Catalog entry goes in the **`purchases`** group of `permissions.catalog.ts`:

```ts
{
  key: 'purchases',
  label: 'Purchases',
  resources: [
    { resource: 'vendor', label: 'Vendors' },
    { resource: 'purchase_receipt', label: 'Purchase Received', actions: ['read', 'create', 'update'] },
  ],
},
```

⚠️ **`purchase_order` is currently filed under the `settings` group** (`permissions.catalog.ts:152`),
which is a misfiling. Moving it to `purchases` changes only the admin UI grouping — the stored
resource key is unchanged, so no template loses a permission. Worth doing in the same change.

**Files**

```
backend/prisma/schema/purchases.prisma        + PurchaseReceipt, PurchaseReceiptLine
backend/src/modules/purchases/receipts/       purchaseReceipts.{routes,controller,service,schemas,types}.ts
web/src/features/purchases/receipts/          purchaseReceipts.api.ts · .schemas.ts
                                              PurchaseReceiptsList · CreatePurchaseReceipt
                                              PurchaseReceiptDetail · ReceiptLinesGrid · PackageGrid
```

Copy `src/modules/purchases/vendors/` for module shape. Copy
`web/src/features/jobwork/job-orders/MaterialInSection.tsx` for the package grid — it already solves
the sum-check and the row generation.

---

## 5. Reuse — do not rebuild

| Need                                                | Already exists                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Batch creation, package creation, ledger posting    | `stockLedger.service.ts` — `createBatch`, `createPackages`, `postMovement`, `postMovements` |
| Document number allocation                          | `allocateNumber` (`lib/numberSequence.ts`), `PR-` prefix already reserved                   |
| Long-transaction budget                             | `runAsDocument` (`jobwork.types.ts` — move to `src/lib/`)                                   |
| Package grid with live sum check                    | `MaterialInSection.tsx`                                                                     |
| List page with search, pagination, columns, filters | `VendorsList.tsx`                                                                           |
| Detail page with activity + comments                | `VendorDetail.tsx`                                                                          |
| Modal with focus trap                               | `components/ui/Modal.tsx`                                                                   |
| Dropdowns                                           | `Select.tsx` · `SearchableSelect.tsx` · `ComboBox.tsx`                                      |

---

## 6. Ordering

| #   | Step                                                                              | Blocks                                                         |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Item form: surface `stockingUomId` / `inventoryTracking` / `nature` (I-1)         | Everything — PR cannot receive an item with no stocking unit   |
| 2   | Fix D5 (`ownerPartyId` in `balanceWhere`) and D4 (age-based picker order)         | Small, and both get harder once multi-customer stock is common |
| 3   | Migration: `purchase_receipts` + `purchase_receipt_lines` + RLS + `TENANT_TABLES` |                                                                |
| 4   | Backend module + registration (§4.4, §4.10)                                       |                                                                |
| 5   | Frontend: list, create, detail                                                    |                                                                |
| 6   | PO roll-up + Receipts tab (§4.9)                                                  |                                                                |
| 7   | ~~Material In cutover (§7)~~                                                      | ⚠️ **Already done, 2026-08-07 — out of order.** See §7         |
| 8   | Item dead-column removal (I-3 / I-4)                                              | Independent; can run in parallel                               |

⚠️ **Step 1 is now partly done too:** `stockingUomId` is on the item form (2026-08-07), set by the
existing Unit dropdown, which writes the FK and the legacy `unit` string together. `inventoryTracking` and
`nature` are still unsurfaced — `inventoryTracking` matters much less while taka-level movement is off
(plan §12.5), but PR's package grid needs it before takas come back.

---

## 7. Material In cutover

> ⚠️ **THIS HAPPENED ON 2026-08-07, BEFORE PR WAS BUILT.** The section below says it must not, and
> that instruction is now history rather than guidance. What actually occurred, and what it means for
> whoever builds PR:
>
> - Material In was removed from the job order create form, and `postMaterialIn` deleted from
>   `jobOrders.service.ts`. `materialIn` is gone from `createJobOrderSchema`.
> - **Nothing replaced it.** There is no inward document at all right now. `JOBWORK_IMPLEMENTATION_PLAN.md`
>   §12.6 documents the temporary scaffold that keeps the loop walkable: an issue line with no batch
>   creates one at ZERO value. That scaffold is what PR deletes — four marked places, listed there.
> - Steps 2–4 of the list below (the `+ Receive material` button, the PR dialog pre-filled from the
>   job order, `jobOrderId` on `purchase_receipts`) are **still to build**, and are now the whole of
>   the cutover rather than the tail of it.
> - 🔴 The pre-fill described in step 2 must change: it says "pre-filled with `inputItemId`", and the
>   job order header no longer has one (plan §12.5). Pre-fill from **step 1's consumed items**
>   instead — there may be several, which is the point.
>
> Everything below about existing data still holds exactly.

**Nothing is migrated and nothing is deleted.**

Batches created by Material In carry `sourceDocType = 'job_order_material_in'` and their full genealogy.
They keep issuing, keep tracing, keep valuing. The `job_order_material_in` source type stays in the
constants permanently so historical rows remain interpretable.

What changes:

1. `MaterialInSection.tsx` is removed from the Job Order **create** form
2. A **`+ Receive material`** button appears on the Job Order Overview, opening the PR dialog
   pre-filled with `inputItemId`, `ownership`, `ownerPartyId` and — when ownership is `customer` —
   `sourceType = 'customer_supplied'` with the customer locked
3. The saved PR links back to the job order. Add `jobOrderId String?` to `purchase_receipts`, or
   record it in the receipt's `remarks` — **decide this before writing the migration** (§10, Q3)
4. `materialIn` is removed from `createJobOrderSchema` and `postMaterialIn` is deleted from
   `jobOrders.service.ts`

**Until step 1 ships, Material In stays exactly as it is.** It is the only inward path and removing it
early breaks every job order.

---

## 8. Go-live: opening stock at volume

The screen is not the hard part. A mill switching systems has thousands of takas in hand on day one,
and nobody is typing those (domain doc §12, question 7).

**CSV import against `sourceType = 'opening_balance'`** is the real requirement, and it is the thing
that decides whether a rollout succeeds. Two files or one file with a parent key:

```
item_sku, batch_number, supplier_batch_ref, location, qty, value, received_date
item_sku, batch_number, package_label, package_qty
```

Import validates everything in §4.6, reports every failing row **before** writing anything, then posts
as one or more receipts. Not in the first release of PR, but the schema above already supports it —
no further table is needed.

---

## 9. Known gaps this work should close

| Gap                                                                      | Where                                                                              | Fix                                                                                                          |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Batch picker offers one customer's goods on another customer's job order | `stockLedger.service.ts` `balanceWhere` filters `ownership` but not `ownerPartyId` | Add `ownerPartyId` to `BalanceFilter` and to the `where`. Pass it from `jobIssues.service.ts` `resolveLines` |
| Picker order is not FIFO and shows no age                                | `getAvailableBatches` sorts by `batchNumber.localeCompare()`                       | Order by the batch's earliest `postedAt`; return an `ageDays` field. Field-sources §5.2                      |
| No reversal path for anything                                            | Nothing calls `movementType: 'reversal'`                                           | PR's cancel (§4.8) is the first. Generalise it afterwards                                                    |
| Dead item columns                                                        | `openingStock`, `openingStockValuePerUnit`, `trackInventory`, `inventoryTracking`  | §3.2 I-3 / I-4                                                                                               |
| `purchase_order` filed under `settings` permissions                      | `permissions.catalog.ts:152`                                                       | Move to the `purchases` group                                                                                |

---

## 10. Open questions

Decide these before the first migration.

| #      | Question                                                                       | Recommendation                                                                                                        |
| ------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Q1** | Can one PR receive against **several** POs?                                    | **No** for v1. One PR, one PO. A vendor delivering against two POs sends two challans in practice                     |
| **Q2** | Does a PR line's item have to appear on the linked PO?                         | **Yes** when `sourceType = 'purchase_order'`. An unordered item arriving with an ordered one is a `direct` receipt    |
| **Q3** | Does `purchase_receipts` carry a `jobOrderId` for the Material In replacement? | **Yes, nullable.** Cheaper than parsing remarks, and the Job Order Overview needs to list the receipts raised from it |
| **Q4** | Is over-receipt against a PO blocked, warned, or tolerance-gated?              | **Warn** in v1. Add a tolerance % on the PO later if a customer asks                                                  |
| **Q5** | Does PR capture rejection/inspection at the gate?                              | **No** for v1. Everything received is accepted. Purchase Return covers it later (domain doc §7.3)                     |
| **Q6** | Freight and landed cost apportionment                                          | **Deferred with the Purchase Bill.** PR carries the line rate as provisional value                                    |

---

## 11. Done means

> A receipt can be posted against a PO, without a PO, from a customer, and as an opening balance; each
> creates a batch with its packages and correct ledger rows; the Job Order's Issue picker finds that
> stock; a customer's batch is invisible to another customer's job order; the PO shows received-vs-ordered
> and its Receipts tab; cancelling a receipt reverses it and is refused once the stock has moved on;
> `npm run db:check-drift` exits 0; `rls.test.ts` covers both new tables.
