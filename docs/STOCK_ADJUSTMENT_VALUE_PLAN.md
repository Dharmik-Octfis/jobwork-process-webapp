# Inventory Adjustment by Value — plan

**Status: planned and BUILT 2026-10-02. Not committed, not deployed.**

Still owed:

- 🔴 **No screen has been walked in a browser** — the form's Value mode, the item-page panel, the
  list's Type column, the detail's "Purchases revalued" table, and the item valuation report's
  pair rows. Keyboard order, 390px and 768px are unchecked.
- Migration `20261002120013_value_adjustment` is applied to `jobwork_local` only.

**Where the build differs from the text below:**

- **Switching type keeps the items** and clears only their figures and the reason (§7 said
  "clears the lines").
- **The posting date is the later of the adjustment date and the item's last movement there**, so
  the item report never prints the change above the bill that brought the stock in. V8 compares
  by whole day: a bill and a value adjustment on the same date are allowed.
- **"Drawn on since" (V11) is decided by the clock, not `now()`**: draws and revaluation records
  set `created_at` from the application clock, because `now()` is the transaction's start and a
  challan that waited on the adjustment's layer lock would otherwise look older than it.
- **A cancellation gets its own heading in the item report**, even straight after the posting it
  reverses.
- **Within an entry a decrease is split by value, an increase by quantity** — identical when the
  entry has one rate, and a decrease can never push a layer of a blended entry below ₹0.
- Tests: `adjustments.value.test.ts` (17), plus a value case in `adjustments.contract.test.ts`.

Round 1 (`STOCK_ADJUSTMENT_PLAN.md`) and round 2 (`STOCK_ADJUSTMENT_ROUND2_PLAN.md`) built
adjustment by **quantity**. Both left value out because `postMovement` refuses value without
quantity and cost lives in FIFO layers (`FIFO_COSTING_PLAN.md`). This plan adds Zoho's second tab,
**Value Adjustment**: change what stock on hand is worth without moving any of it.

Decided with the user on 2026-10-02:

| Question                                  | Decision                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| Which stock takes the change              | The **newest purchase entry** at that location (Zoho's behaviour), whole      |
| A reduction bigger than it                | That entry goes to ₹0, the rest moves to the next-newest entry                |
| Batch or lot (unit) selection             | **None.** Cost is not stored on a batch or a lot, so the user never picks one |
| Units on / off ("Track individual units") | Same rule either way — units only mean more layers behind the scenes          |
| How it is stored                          | **Value-only ledger rows** (qty 0) — no quantity ever leaves or comes back    |
| How the item valuation report shows it    | **Two rows, like Zoho**: `−Q @ old rate`, `+Q @ new rate`                     |
| Account field                             | **Not built** — this app has no general ledger (§9)                           |

## 1. Words used here

| Word               | In code                      | What it is                                                                                                                     | Holds cost?              |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| Batch              | `batches`                    | Physical group (supplier batch ref)                                                                                            | no                       |
| Lot / Taka / Roll  | `batch_units`                | A unit inside a batch; exists only when the preference is on; the org names it                                                 | no                       |
| **Purchase entry** | `stock_cost_layers`, grouped | The stock ONE inward document brought into ONE location on one date — a bill, a receipt, opening stock, an adjustment increase | **yes — the only place** |

One inward document writes one ledger row per batch (and per unit when units are on), and each row
writes one layer. A purchase entry is those layers taken together: same item, same location, same
inward document, same `in_date`. A legacy cut-over layer has no document and is an entry on its own.
This is the same grouping the FIFO Cost Lot report already uses (`fifoCostLotTracking.service.ts`),
minus the rate, because after a value adjustment followed by a cancelled challan the layers of one
entry can carry different rates (§6, V12).

## 2. Worked example

Item at Head Office, own godown:

| Purchase entry    | Batch / lot | Left  | Rate | Value   |
| ----------------- | ----------- | ----- | ---- | ------- |
| Opening stock     | B0          | 70    | ₹100 | ₹7,000  |
| BILL-020 (newest) | B1 / L1     | 300   | ₹10  | ₹3,000  |
|                   | B1 / L2     | 300   | ₹10  | ₹3,000  |
|                   | B2 / L1     | 400   | ₹10  | ₹4,000  |
| **Total**         |             | 1,070 |      | ₹17,000 |

**ADJ-00012, value −₹2,000.** BILL-020 is the newest entry and holds ₹10,000, enough to absorb it.
Every layer of it loses the same amount per unit (₹2): spread by remaining quantity, the last layer
taking the paisa rounding. Opening stock is untouched.

| Purchase entry | Left  | Rate after | Value after |
| -------------- | ----- | ---------- | ----------- |
| Opening stock  | 70    | ₹100       | ₹7,000      |
| BILL-020       | 1,000 | **₹8**     | **₹8,000**  |
| **Total**      | 1,070 |            | **₹15,000** |

Item valuation report:

```
02-10-2026  Inventory Adjustment By Value # ADJ-00012   −1,000 @ 10   −10,000
                                                       +1,000 @ 8     +8,000    1,070   15,000
```

**ADJ-00013, value −₹12,000** (from ₹15,000). BILL-020 holds ₹8,000 → goes to ₹0; the remaining
₹4,000 comes off opening stock (₹7,000 → ₹3,000). Four rows, two per entry. **ADJ-00014, value
−₹16,000** is refused: only ₹15,000 is on the books there.

## 3. Rules

- **V1 — One type per adjustment.** `quantity` or `value`, chosen on the form; lines of the other
  kind are refused. A value line has no quantity, no batches and no cost price.
- **V2 — One line per item** (round 2's B1). The item must be inventory-tracked goods.
- **V3 — Own places only.** The location must be an own godown — not `processor`, `in_transit` or
  `customer_site`, the same `OWN_PLACE` test every report uses. Stock at a job worker carries layers
  tagged to a challan line, and revaluing them would leak into that receipt's landed cost.
- **V4 — There must be stock to revalue.** No remaining layers at that item + location → refused.
- **V5 — Newest entry first.** "Newest" is FIFO age (`in_date DESC, in_seq DESC`), i.e. the entry
  that will be consumed last. An increase goes entirely onto the newest entry. A decrease takes the
  newest entry down to ₹0 at most, then the next, and so on.
- **V6 — Never below ₹0, never more than is there.** A decrease larger than the current value at
  that item + location is refused with the figure. Writing an entry down to exactly ₹0 is allowed.
- **V7 — Adjusted value ≠ 0.**
- **V8 — Date not before the last movement** of that item at that location (own stock, any
  document), checked at Adjust, not at draft. The adjustment changes the entries that are on hand
  NOW; dated earlier, the as-on valuation would show the change against stock that had not arrived
  yet. Round 1's existing date rules (books-begin anchor etc.) still apply.
- **V9 — An increase shows a warning, not a block**: under Ind AS 2 / IAS 2 stock is carried at the
  lower of cost and realisable value, so raising it is only right to correct a cost that was wrong
  or reverse an earlier write-down.
- **V10 — Approval is the same gate as quantity adjustments** — nothing moves until approved.
- **V11 — Cancel** gives back exactly what each layer received, as a value-only reversal row. Refused,
  naming the document, when any of those layers has been **drawn on since** the adjustment (the
  added or removed value has already flowed into a challan, receipt, …). Also refused if giving it
  back would take a layer below ₹0 (a later adjustment wrote it down further — cancel that first).
- **V12 — A purchase entry carrying a live value adjustment cannot be taken back by its own
  document.** Editing or deleting the bill, reducing opening stock, cancelling the receipt or
  assembly or quantity adjustment that created it — all refused, naming the value adjustment, until
  that is cancelled. Otherwise the bill would withdraw its layer at ₹8 having posted it at ₹10, and
  the leftover ₹2/unit would sit on a document that no longer exists. Enforced once, in
  `drawLayers` for the `withdraw` and `entry` scopes, so every caller inherits it.
- **Not a rule, a consequence:** a challan that drew on an entry BEFORE its value adjustment, and is
  cancelled AFTER it, returns its stock at the rate it left at (FIFO D2 — no re-costing). The entry
  then carries a blended rate. Totals and the invariant stay exact.

## 4. Schema

```prisma
// stock_adjustments
adjustmentType String @default("quantity") @map("adjustment_type") @db.VarChar(10) // quantity | value

// stock_adjustment_lines
valueAdjusted Decimal? @map("value_adjusted") @db.Decimal(18, 4) // value lines: SIGNED, the user's figure
valueBefore   Decimal? @map("value_before")   @db.Decimal(18, 4) // read by the server at Adjust
```

On a value line `quantity_adjusted` is `0`, `quantity_before` records stock on hand at Adjust, and
`value` is the signed change actually posted. The header's `value` is the signed total.

**Reasons** become per type. Quantity keeps `damaged | lost | found | count_correction | other`.
Value: `write_down` ("Write-down to realisable value"), `cost_correction`, `other`.

**New table `stock_layer_revaluations`** — what one adjustment did to one layer. Bookkeeping owned
by the ledger like `stock_layer_draws`: no soft delete, no `custom_fields`, no `updated_by`.

```prisma
model StockLayerRevaluation {           // @@map("stock_layer_revaluations")
  id, organizationId @db.Uuid
  layerId          @db.Uuid             // the layer changed
  ledgerEntryId    @db.Uuid             // the value-only stock_ledger row that carries it
  qty              Decimal(18,4)        // the layer's remaining qty at that moment — the report's Q
  valueBefore      Decimal(18,4)
  valueAfter       Decimal(18,4)
  reversedAt       Timestamptz?         // set by cancel
  createdAt        Timestamptz
  @@index([layerId]) @@index([ledgerEntryId])
}
```

It carries `organization_id` → **direct RLS policy written into the migration by hand** (guarded
`pg_policies` shape, `20260911150000_…`), and it goes into `TENANT_TABLES` in `src/db/rls.test.ts`.
`migrate diff` will not remind anyone of either (CLAUDE.md).

`MOVEMENT_TYPES` gains `'revaluation'` (and the DB check, if one exists on `movement_type`).

## 5. The engine

**`revalueLayers(tx, key, change, …)` in `costLayers.ts`** — the only new costing code.

1. Lock the untagged remaining layers of (item, location) `FOR UPDATE`, newest first, with each
   layer's inward row (`source_doc_type`, `source_doc_id`, `batch_unit_id`).
2. Group them into purchase entries (§1). Walk entries newest first, assigning the change by V5/V6.
3. Inside an entry, split its share by remaining quantity; the last layer takes the rounding.
4. Update each layer's `remaining_value` (`value` — the original — is never touched).
5. Return one record per layer changed.

**`postRevaluation(tx, input)` in `stockLedger.service.ts`** — the only writer of value-only rows.
It does NOT loosen `postMovement`; the "exactly one of qtyIn / qtyOut" check stays for everyone
else. Per changed layer it writes one ledger row:

| Column                      | Value                                                                     |
| --------------------------- | ------------------------------------------------------------------------- |
| `qty_in`, `qty_out`         | 0                                                                         |
| `value_in` / `value_out`    | the layer's increase / decrease                                           |
| `movement_type`             | `revaluation`                                                             |
| `stock_effect`              | `accounting` — quantity reports (`both`, `physical`) never see it         |
| `batch_id`, `batch_unit_id` | the layer's batch, and the unit of the row that created it (legacy: null) |
| `source_doc_*`              | `inventory_adjustment`, the adjustment, the line                          |
| `posted_at`                 | the adjustment date                                                       |

…and the matching `stock_layer_revaluations` row. `checkLayerInvariant` holds by construction:
ledger value and layer value move by the same amount.

The unallocated-opening-stock guard (`postMovement:351`) does not apply: nothing is picked or moved,
and opening stock is exactly what a write-down often targets. Draft batches have no layers.

**Cancel** (`cancelPosted` branches on type): per live revaluation record, check V11, subtract
`valueAfter − valueBefore` from the layer, write the opposite value-only row (`movement_type
'reversal'`), stamp `reversed_at`. `reverseMovement` is not used — it would refuse a row with no
quantity.

## 6. Backend

- `postAdjustment` branches on `adjustmentType`; value lines call `postRevaluation` instead of
  `postRow`. Same transaction, same all-or-nothing (round 2's B3), same approval handler.
- Schemas: `adjustmentType` on create/update; a value line is `{ itemId, valueAdjusted }`; reason
  validated against the type's list.
- **`GET …/inventory/adjustments/current-values?locationId=&itemIds=`** (`stock_adjustment:read`) —
  quantity and value on hand per item from the layers, ONE grouped query, for the form's "Current
  Value". Display only: Adjust re-reads.
- Approval payload gains `adjustmentType`, so a process can approve value adjustments differently.
- No new permission keys.

## 7. Frontend

- **Form page and the item-page panel** gain the radio `Quantity Adjustment / Value Adjustment`
  (round 2's form, not a new page). Switching type clears the lines. Value lines: Item, Quantity on
  hand (read-only), Current Value (read-only), **New Value**, **Adjusted Value** (±) — typing one
  fills the other, like Zoho's Changed / Adjusted Value. Reason list follows the type. V9's warning
  sits beside an increase as an info icon, not a sentence under the field.
- **List**: a Type column (`Quantity` / `Value`); Value shows the signed change.
- **Detail**: for a posted value adjustment, a table per line — purchase entry, quantity, rate
  before → after, value before → after — read from `stock_layer_revaluations`.
- Shared controls only, Tab walk and 390 / 768 / desktop walk before calling it done (CLAUDE.md).

## 8. Reports

| Report                                           | Change                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory Valuation Summary                      | none — already `SUM(value_in − value_out)` over `both, accounting`                                                                                                                                                                                             |
| **Item valuation (`getItemLedger`)**             | value-only rows render as **two rows per purchase entry**: `−Q @ old`, `+Q @ new` (Q, old, new from `stock_layer_revaluations`). A cancel renders the mirror pair. Running Stock on Hand / Asset Value printed on the second row of the pair only — see §10 Q1 |
| FIFO Cost Lot Tracking                           | a lot touched by a value adjustment lists it as an event (`rate 10 → 8`); label `Inventory Adjustment By Value`                                                                                                                                                |
| Stock Summary, Stock Movement                    | none — they read `both, physical`, so qty-0 accounting rows never appear                                                                                                                                                                                       |
| Batch report, Taka report                        | value sums pick it up; verify the taka report groups a revaluation row under its unit                                                                                                                                                                          |
| Stock adjustments on the item's Transactions tab | show the type                                                                                                                                                                                                                                                  |

`describeDocuments` already names `inventory_adjustment`.

## 9. Accounting — what this does NOT do

There is no chart of accounts in this app, so Zoho's **Account** field has nothing to point at and
is not built. A value adjustment changes this app's inventory valuation only. The user must post the
matching journal (stock value Dr/Cr against write-down / cost correction) in their books — Zoho
Books, Tally — or the two disagree. The detail page says so in one line.

Also out of scope:

- Stock at job workers / in transit (V3).
- Choosing a batch, lot or purchase entry by hand (§1 — cost does not live there).
- A used bill's rate change. Value adjustment touches stock on hand only; the difference on stock
  already consumed needs re-costing or a price-difference account, still parked
  (`FIFO_COSTING_PLAN.md` §8). `revalueLayers` is reusable for it later.

## 10. Open questions for the user

- **Q1 — Row order in the item valuation report.** Zoho prints `+Q @ new` first and `−Q @ old`
  second, so its Stock on Hand column briefly shows a quantity you never had (2,070 in your
  screenshot). Proposed: `−Q @ old` first, `+Q @ new` second, running columns on the second row only.
- **Q2 — Value reasons**: `Write-down to realisable value`, `Cost correction`, `Other` — enough?

## 11. Build order

1. Migration: two columns + type, two line columns, `stock_layer_revaluations` + RLS by hand;
   `TENANT_TABLES`; `db:draft` → hand-trim → `db:promote` → `db:apply`.
2. `revalueLayers` + `postRevaluation` + tests: increase onto newest; decrease spills; ₹0 floor;
   over-limit refused; units-on item spreads over batches and units at one rate; legacy layer;
   invariant after each.
3. V12 in `drawLayers` + tests: bill edit/delete, opening reduction, receipt cancel each refused
   naming the adjustment.
4. Service: type branch, value lines, date rule V8, own-place V3, cancel V11 + tests; approval
   pending → approve posts; contract test.
5. Current-values endpoint.
6. Form, item-page panel, list, detail.
7. Item valuation two-row rendering, FIFO Cost Lot event, taka report check + tests.
8. Docs: mark this plan built; round-2 plan's "Value Adjustment — still out" row.

QC (`jobwork_dev`) needs the migration before anyone opens the form there.
