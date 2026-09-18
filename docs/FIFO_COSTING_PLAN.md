# FIFO Costing — Plan

**Status:** BUILT 2026-09-18 on `fix/joborderProcessRate` — phases 1–6, not yet deployed to QC.
Decisions D1–D5 taken 2026-09-18 (§4). **Where the build differs from this plan, and what is still
open, is §8** — read it before the sections above.

**Goal:** one costing method everywhere — **FIFO**, the way Zoho Inventory and Odoo value stock by
default. Cost is decided **when stock leaves a place**, written into `stock_ledger`, and every screen
and report reads that one figure. A batch stays what it is today: **traceability** (which roll went
where), not a cost bucket.

---

## 1. Why — what is wrong today

Worked example (Green Fabric, OCTFIS TECHNO, 2026-09-18):

| In                   | Batch       | Qty   | Cost    |
| -------------------- | ----------- | ----- | ------- |
| Opening stock, 09-06 | BATCH-00240 | 100 m | ₹50 / m |
| Bill, 18-09          | BATCH-00241 | 100 m | ₹30 / m |

Challan JI-00116 sends 50 m of each batch to the dyer. Receipt JR takes 51 m.

|                | Posted today (batch average) | Valuation report (FIFO, recomputed) | FIFO everywhere (this plan)          |
| -------------- | ---------------------------- | ----------------------------------- | ------------------------------------ |
| Issue value    | ₹4,000 (50×50 + 50×30)       | ₹5,000                              | **₹5,000** (100 × ₹50, oldest first) |
| Left in godown | ₹4,000                       | **₹3,000**                          | **₹3,000**                           |
| At the dyer    | ₹4,000                       | —                                   | **₹5,000**                           |
| Receipt, 51 m  | ₹2,530                       | —                                   | **₹2,550**                           |
| Godown + dyer  | ₹8,000                       | ₹3,000 + ₹4,000 = **₹7,000** ❌     | ₹8,000 ✅                            |

Two costing methods run side by side and do not tie:

- **Every posting** (issue, receipt consume, write-off, assembly consume) values stock at the **picked
  batch's running average at that location** — `SUM(value)/SUM(qty)` from `getBalancesByBatch`
  (`jobIssues.service.ts:1383`, `jobReceipts.service.ts:2219`, `jobOrders.writeOff.ts:116`,
  `assemblies.service.ts:~600`).
- **The valuation report** (`inventoryValuation.service.ts:188–226`, since the `dev` merge `d293b83`)
  throws the ledger's value away and **replays FIFO in JavaScript** on every load. Its Item Ledger does
  the same per location, the Summary per item across locations — so the two screens disagree with each
  other too. The FIFO Cost Lot report prices outflows at ₹0.

So the ledger says one thing, the report another, and ₹1,000 of Green Fabric exists in neither.

---

## 2. How Zoho, Odoo and the standard do it

- **Ind AS 2 / IAS 2** allow FIFO, weighted average, or specific identification (for goods not
  ordinarily interchangeable). The choice is a policy applied consistently. This plan fixes the policy
  at **FIFO**.
- **Odoo** (FIFO category): every incoming move creates a _valuation layer_ (qty, value,
  `remaining_qty`, `remaining_value`); every outgoing move consumes the oldest layers. Lots/serials are
  traceability only. Internal moves between own locations do not change value. Back-dated moves are
  **not** re-costed — layers are consumed in the order moves are processed.
- **Zoho Inventory** (FIFO): item-level cost, batches are traceability. A back-dated transaction
  **re-costs** later transactions ("recalculating stock value").

This plan follows the **layer** design (Odoo's), which is the one that can be built on an append-only
ledger without rewriting posted rows.

---

## 3. The design

### 3.1 Cost layers — two new tenant tables

```prisma
model StockCostLayer {            // @@map("stock_cost_layers")
  id, organizationId @db.Uuid
  itemId, locationId              // the FIFO queue this layer is in (⚖️ D1)
  inLedgerEntryId  @unique        // the stock_ledger row that created it
  originLayerId?                  // a transfer copy points at the layer it came from
  sourceDocLineId?                // e.g. the job_issue_line a processor layer belongs to (§3.4)
  batchId                         // informational only — never used to pick a layer
  inDate  Timestamptz             // FIFO order; a transfer copy KEEPS its origin's date
  inSeq   BigInt                  // tie-break: creation order
  qty, value                      // as created
  remainingQty, remainingValue    // what is still unconsumed
  createdAt …
  @@index([organizationId, itemId, locationId, inDate, inSeq]) — partial WHERE remaining_qty > 0
}

model StockLayerDraw {            // @@map("stock_layer_draws")
  id, organizationId
  layerId, outLedgerEntryId
  qty, value
  reversedAt?                     // set when the outward row is reversed and the draw restored
}
```

Both carry `organization_id` → **direct RLS policy**, written by hand in the migration (the guarded
`pg_policies` shape), and both go into `TENANT_TABLES` in `src/db/rls.test.ts` (CLAUDE.md).
Not domain tables: like `stock_ledger`, no `custom_fields`, no soft delete — a layer is derived
bookkeeping owned by the ledger.

### 3.2 `postMovement` owns cost — callers stop pricing stock

Today callers compute `valueOut` themselves. After this change:

| Row                                                                              | What the caller passes                        | What `postMovement` does                                                                                                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In** (bill, opening, produce, adjustment in)                                   | `valueIn` (the known cost)                    | writes the row **and a layer**                                                                                                                    |
| **Out** (issue out, consume, scrap, adjustment out, sale)                        | **no value** — `cost: { fifo: true, scope? }` | locks the item+location layers, consumes oldest first, writes the row with `valueOut = Σ draws` and the draws                                     |
| **Transfer** (issue godown → processor, godown → godown)                         | one call, `postTransfer(out, in)`             | out consumes FIFO at source; in creates **one layer per draw** at the destination, same unit cost, **same `inDate`** (age travels with the goods) |
| **Reversal of an out** (cancel issue / receipt / assembly)                       | `reverses: ledgerRowId`                       | restores each draw to its layer (`remaining += qty/value`), posts the opposite row at the original value                                          |
| **Reversal of an in** (bill edit/delete, opening reduce, cancel receipt produce) | `reverses: ledgerRowId`                       | allowed only while the layer is untouched enough (⚖️ D3)                                                                                          |

Rules held inside the engine, once:

- **Customer-owned stock gets no layer and no draws** — value is zero today (`postMovement:335`) and
  stays zero.
- **`stockEffect = 'physical'`** rows create/consume nothing.
- **Rounding:** a draw that empties a layer takes exactly `remainingValue`, never `qty × unitCost`, so
  no paisa dust is left behind.
- **Concurrency:** layers are read `FOR UPDATE` in `(inDate, inSeq)` order inside the posting
  transaction — two challans cannot consume the same layer.
- **Invariant**, per (item, location, own): `Σ layer.remainingQty = Σ ledger qty` and
  `Σ layer.remainingValue = Σ ledger value`. A diagnostic query and a test assert it.
- **Short of layers → refuse**, naming the item and location. This is also what stops the ledger going
  negative: today only callers check availability, and a caller that skips it (a reversal) can drive a
  balance below zero silently. Every outward row now needs layers to draw from, so no document —
  reversals included — can take out more than is there. Never cost at ₹0 silently, as the current
  report does.

### 3.3 Batch ≠ cost

The physical pick is unchanged: the Issue screen still suggests batches oldest-first and the user may
override. **Cost ignores which batch was picked** — 50 m of the ₹30 bill batch sent while the ₹50
opening layer is still open costs ₹50. That is exactly Zoho's and Odoo's behaviour. Consequence, and it
is intended: a single batch's value at a location stops being meaningful. Nothing may price anything
from `getBalancesByBatch(...).value` any more.

### 3.4 Job work — FIFO at the processor stays with the job

A processor holds material for several job orders at once. Plain location-FIFO there would let job B's
receipt consume job A's older, dearer layer. So at a **processor location** every layer carries the
`job_issue_line` it arrived on (`sourceDocLineId`), and:

- **Receipt consume** draws FIFO (by `inDate`) **only from the layers of the challans the receipt is
  received against**, closed challans first (challan-closure R12, unchanged).
- **Write-off at completion** draws the remaining layers of that step's challan lines.
- The landed-cost engine (`landedCost.ts`, R1–R7) is untouched — it only ever sees `consumedValue`.

With the example: JI-00116's two lines arrive as layers 50 m @ ₹50 and 50 m @ ₹50 (both drawn from the
opening layer) → 51 m consumed = **₹2,550**.

---

## 4. Decisions — taken 2026-09-18

|     | Decided                                                                                    |
| --- | ------------------------------------------------------------------------------------------ |
| D1  | **Per item per location**, layers travel with transfers and keep their age                 |
| D2  | **No re-costing** of already-posted documents; a back-dated inward serves the next outward |
| D3  | **Refuse** a quantity/value change on a consumed layer, naming the consumer                |
| D4  | **Cut-over** — layers built from current balances; history untouched                       |
| D5  | **Include** goods received from job work in valuation                                      |

The reasoning each choice was made on:

**D1 — FIFO queue per item per LOCATION, or per item per ORGANISATION?**

- _Per organisation_ is Odoo/Zoho's default: one queue per item, transfers between own godowns change
  nothing. But then "value at the dyer" and a per-godown valuation are not well defined, and a receipt
  would consume whichever layer is oldest anywhere.
- _Per location, layers travel with transfers_ (recommended): each godown and each processor has its
  own queue; a transfer moves the drawn layers, keeping their age. Same answer as per-organisation for
  a single-godown org; exact per-location and per-processor values for jobwork and GST ageing. This is
  SAP's "valuation per plant" and Tally's godown-wise stock.

**D2 — Back-dated documents.** A bill dated 01-Sep entered after a challan dated 05-Sep was costed.

- _No re-costing_ (recommended, Odoo): the new layer joins the queue by its date and is used by the
  **next** outward document; nothing already posted changes. The screen says so when a back-dated
  inward lands before already-costed outwards.
- _Re-cost later documents_ (Zoho): every outward row after that date is re-priced, cascading into
  receipts, landed cost, finished-goods batches and write-offs. Rewrites posted values — against the
  ledger's own rule ("a correction is a reversing entry") and a large job. Could come later as an
  explicit "Recalculate stock value" action.

**D3 — Changing an inward whose layer is already (partly) consumed** (bill edit/delete, opening-stock
reduction, receipt cancel). Today a bill is blocked only if _its batch_ was issued onward; under FIFO a
layer can be consumed by an issue that physically took a _different_ batch.

- _Refuse_ (recommended for v1): quantity/value change on a consumed layer is refused, naming the
  document that consumed it — the same shape as today's "issued onward" 409.
- _Allow a rate-only correction_: revalue the **remaining** quantity and post the consumed part's
  difference as a cost adjustment (Odoo's "price difference"). Needs a place to show that adjustment —
  a follow-up.

**D4 — Existing data (QC database).** Go-live is a fresh database (memory: no real customers yet), so
this only concerns QC/dev data.

- _Cut-over_ (recommended): one migration script builds opening layers from **current** balances — one
  layer per (batch, location, own) with its current qty and value, `inDate` = that batch's first inward
  `postedAt`. History stays as posted.
- _Replay all history under FIFO_: would rewrite posted `value_out` on thousands of rows — not done.

**D5 — Goods received from job work in the valuation report.** Both report screens exclude
`source_doc_type = 'job_receipt'` today, so dyed fabric back in the godown is missing from valuation
entirely. Recommended: include it (it is our stock at our location).

---

## 5. Every place that changes

### 5.1 Writers (30 call sites, 7 modules — full list from the 2026-09-18 survey)

| Module / function                                                                    | Today                                         | After                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bills.service` `receiveBillBatch` :307/:330, `createBill` :937, `updateBill` :1264  | receipt @ `rate × qty` — **discount ignored** | **+ layer**, valued at the line's **net** amount, recomputed on the server as `max(0, qty × rate − discountAmount)` (the client's `amount` is not trusted); per-package and untagged parts split it by quantity through `splitByQty`        |
| `bills.service` `reverseBillPostings` :472                                           | copies net value, **dated now**               | reverse the bill's layers — D3 guard replaces the batch-onward guard — and **dated at the bill's own date**, so an edit replaces the old posting for every as-of date instead of showing the stock twice between the bill date and the edit |
| `items.service` create :826, `saveOpeningStock` (6 sites), `settleOpening` :340/:397 | opening @ declared                            | + layer; a reduction reverses the opening layer's **remaining** part (D3)                                                                                                                                                                   |
| `compositeItems.service` :316                                                        | opening                                       | + layer                                                                                                                                                                                                                                     |
| `jobIssues.service` `createNewJobIssue` :1388/:1417                                  | batch average, out + in                       | **`postTransfer`** — FIFO at the source godown, layers land at the processor tagged with the issue line                                                                                                                                     |
| `jobIssues.service` `cancelJobIssue` :1725                                           | copies value                                  | restore the source draws; remove the processor layers (already guaranteed untouched — cancel is refused once anything was consumed)                                                                                                         |
| `jobReceipts.service` consume :2223                                                  | batch average at processor                    | FIFO over the **selected challans' processor layers** (§3.4)                                                                                                                                                                                |
| `jobReceipts.service` produce :2474/:2497                                            | landed cost                                   | same value, **+ layer**                                                                                                                                                                                                                     |
| `jobReceipts.service` `cancelJobReceipt` :3053                                       | copies value                                  | restore consume draws; produce layers must be untouched (replaces the "output batch used" check)                                                                                                                                            |
| `jobOrders.writeOff` :118                                                            | batch average, `postedAt = now`               | FIFO over the step's challan layers                                                                                                                                                                                                         |
| `assemblies.service` consume :578 / produce :677/:698 / cancel :956                  | batch average                                 | FIFO at the assembly location / + layer / restore                                                                                                                                                                                           |
| `lib/migrationDate.ts` `restampOpeningStock` :162                                    | re-dates opening rows                         | also re-dates their layers' `inDate`                                                                                                                                                                                                        |

The physical allocation of a receipt to challan **lines** (`openIssueLines`, ordered by line
`createdAt`) should also sort by the batch's first inward date, so traceability is FIFO too (found
2026-09-18). Cost no longer depends on it.

### 5.2 Readers

| Reader                                                                 | After                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Valuation **Summary** / **Item Ledger** (`inventoryValuation.service`) | Drop the JavaScript FIFO replay. Read the ledger's own `value_in − value_out` (now FIFO-correct) — one `SUM`, as-of on `posted_at` for both qty and value. Summary and Item Ledger then agree by construction and stay fast as data grows. |
| **FIFO Cost Lot** report                                               | Rebuild from `stock_cost_layers` + `stock_layer_draws`: the exact lots each outward consumed, at their real cost (today outflows show ₹0).                                                                                                 |
| Receipt prefill `unitCost` + client `receiptCostPreview`               | Server sends the selected challans' processor **layers** (remaining qty, unit cost, inDate); the preview walks them in the server's order.                                                                                                 |
| Batch detail / available-stock `accumulatedValue`, `costPerUnit`       | Not rendered anywhere today. Remove, or replace with the item's FIFO cost at that location.                                                                                                                                                |
| Job order overview / landed cost                                       | Unchanged — reads stored receipt figures.                                                                                                                                                                                                  |

---

## 6. Found on the way — NOT part of this plan

Listed so they are decided on their own, not folded in:

1. **Freight / loading charges on a bill.** A bill has no field for them today, so there is nothing to
   carry into a layer. Adding them — and spreading them across the bill's lines by value or quantity —
   is a feature of its own (Odoo's landed costs). _(The line discount half of this was taken into the
   plan, §5.1.)_
2. **Opening stock value-only corrections post nothing** (the quantity delta is zero).
3. **Receipt prefill prices at each challan's destination, the post at one processor location** — they
   disagree when a step's challans went to different places. FIFO removes the prefill's pricing (§5.2),
   so this closes as a side effect; listed only so nobody reintroduces it.
4. **The FIFO Cost Lot report includes customer-owned and physical-only rows**; valuation excludes them.

_Moved into the plan 2026-09-18:_ the bill line discount and the bill-edit reversal date (§5.1), and
the ledger going negative (§3.2). _Dropped:_ "write-off is dated `now()`" — there is no completion-date
field, so the moment somebody completes the step IS the completion date.

---

## 7. Phases

| #   | Phase     | Contents                                                                                                                                                                                                                                                |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Decisions | D1–D5 answered                                                                                                                                                                                                                                          |
| 1   | Schema    | Two tables, hand-written RLS, `TENANT_TABLES`, partial index                                                                                                                                                                                            |
| 2   | Engine    | Layer create / FIFO consume / transfer / reverse inside `postMovement`, locking, invariant check; unit tests on the arithmetic (worked example → ₹2,550)                                                                                                |
| 3   | Writers   | Bills, opening stock, composite opening, job issue + cancel, receipt consume/produce/cancel, write-off, assemblies — each with its existing test file updated                                                                                           |
| 4   | Readers   | Valuation Summary + Item Ledger back to the ledger `SUM`; FIFO Cost Lot on layers; receipt preview on layers                                                                                                                                            |
| 5   | Cut-over  | Script: first **lists every (item, location) whose balance is negative** and stops if any exist (they are corrected by hand first — none on 2026-09-14); then layers from current balances (D4), run on `jobwork_local`, invariant check green, then QC |
| 6   | Docs      | `JOBWORK_LANDED_COST_PLAN.md` (consume value), `JOBWORK_CORE_WALKTHROUGH.md`, this file → "built"                                                                                                                                                       |

### Tests that must exist

- The worked example end to end: opening 100 @ ₹50, bill 100 @ ₹30, issue 50 + 50 → godown ₹3,000,
  processor ₹5,000, receipt 51 m = ₹2,550, report = ledger.
- Picking the newer batch still costs the oldest layer.
- Transfer keeps age: layer moved to a processor is consumed before a newer layer there.
- Two job orders at one processor never consume each other's layers.
- Cancel issue / receipt / assembly restores layers exactly (qty and value to the paisa).
- D3 refusal when a consumed layer's bill is edited.
- A discounted bill line: layer cost = `qty × rate − discount`, not `qty × rate`.
- A bill edited after its date: an as-of report between the bill date and the edit shows the stock
  once, not twice.
- An outward document that would take more than the layers hold is refused — reversals included.
- Customer-owned: no layers, zero value, quantity still moves.
- Concurrency: two parallel issues on one item+location never over-draw a layer.
- Invariant: layers = ledger, per item+location, after every test file.

---

## 8. As built (2026-09-18)

**Where it lives.** Engine: `backend/src/modules/inventory/stock-ledger/costLayers.ts`, called only
from `stockLedger.service.ts` (`postMovement`, and the new `postTransfer` / `reverseMovement`).
Migration `20260918150000_fifo_cost_layers` (tables, hand-written RLS, both in `TENANT_TABLES`).
Cut-over: `backend/scripts/fifo-cutover.ts` (dry run by default, `--apply`). Tests:
`jobwork/fifoCosting.test.ts`, `purchases/bills/bills.fifo.test.ts`, plus layer assertions in
`assemblies.ledger.test.ts`; every scenario in "Tests that must exist" above is covered.

**How callers use it.** An inward row passes `valueIn` and gets a layer. An outward row of own stock
passes **no** `valueOut` — `postMovement` throws if one is passed — and optionally a `costScope`:

| Scope                             | Used by                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `fifo` (default)                  | issues from a godown, assemblies, any plain outflow — untagged layers only        |
| `job` (issue lines + batch)       | receipt consume, completion write-off                                             |
| `withdraw` (doc + preferred rows) | bill edit/delete, opening-stock reduction                                         |
| `entry` (via `reverseMovement`)   | cancel issue / receipt / assembly — inward rows; outward rows restore their draws |
| `batchFirst`                      | rework challans (below)                                                           |

### Where the build deliberately differs from §3–§5

1. **Receipt consume is FIFO within each allocation's own challan line**, not across all the
   selected challans' layers. The bulk walk now orders lines by their oldest open layer (§5.1's
   traceability note), so a bulk receipt still costs the oldest material first; a unit-wise receipt
   costs the line it names. What this buys: a line's remaining layers always equal what the line
   still has out, which cancel and the write-off depend on. **Confirmed 2026-09-18.**
2. **Rework challans draw their own rework batch's layers first** (`batchFirst`), then FIFO. Pure
   FIFO costed the re-issue at the accepted output's layer from the same receipt — which already
   carries the processing charge — so rework pieces were charged twice (landed-cost R7;
   `jobReceipts.landedCost.test.ts` "charges a rework piece once"). This is a specific-identification
   exception, **confirmed 2026-09-18**.
3. **`in_ledger_entry_id` is not unique** — a transfer lands one layer per draw under one
   `transfer_in` row — and it is nullable for cut-over layers. **The FIFO index is full, not
   partial** (a partial index reads as permanent drift). A column the plan did not have:
   `is_legacy`, marking cut-over layers (and layers restored for a row posted before FIFO); jobwork
   scopes accept them by batch because they carry no challan tag.
4. **Bills keep the physical "issued onward" guard beside the D3 layer guard.** Layers are per item,
   so the layer guard alone would let a bill be withdrawn while its own batch had physically left,
   driving that batch negative.
5. **Opening-stock reductions** withdraw the position's own layers first, then any other
   opening-stock layer of the item at that location (all dated the anchor) — so assigning
   unallocated stock to a batch is not refused just because FIFO costed an issue from that layer.
6. **Batch detail / availability no longer return `accumulatedValue` / `costPerUnit`** (§5.2) —
   nothing rendered them.
7. **Readers.** Valuation Summary and Item Ledger read the ledger's own value; the Item Ledger groups
   by document, location and posting moment. Stock at processor / in-transit / customer-site
   locations stays outside both screens, as before. D5 is in: `job_receipt` goods now count.
   **FIFO Cost Lot** is rebuilt on layers and draws; because only own stock has layers,
   **customer-owned and physical-only movements no longer appear in it** (§6 item 4 closes as a
   side effect).

### Bill edits go by the difference (2026-09-18, after the first build)

Withdrawing the whole bill on every save made **every** edit fail once any of its stock was used — a
changed due date included, because the form always re-sends the lines. `reconcileBillPostings` now
compares each position (batch, package, location) with what the bill already holds:

| Edit                                                     | Result                                                                                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notes, due date, terms, anything not touching stock      | allowed — nothing posted                                                                                                                                          |
| Quantity up / new batch or line                          | allowed — only the extra is received                                                                                                                              |
| Quantity down / batch or line removed / location changed | allowed while that much is still unused (physically there, and its layer not drawn by another document)                                                           |
| Rate or discount changed                                 | allowed only while none of that position is used — **what a used one should do is undecided** (options: Zoho re-costing, Odoo price difference, or keep refusing) |
| Bill date changed                                        | allowed only while none of the bill's stock is used                                                                                                               |

Refusals name the document that used the stock, and the bill form, list and detail page now show the
server's message as a toast (they only logged it before). An untracked item reuses the bill's own
hidden batch instead of minting a new one per save. Delete still takes the whole bill back.
Tests: `bills.fifo.test.ts`.

### Documents posted before FIFO keep the values they were posted with

The cut-over (D4) freezes what is on the books. A challan posted before FIFO keeps its batch-average
value — JI-00116 on `jobwork_local` stayed at ₹4,000 in the godown and ₹2,530 on a 51 m receipt.
**To re-cost an open one: cancel it and issue it again** — the re-issue draws FIFO, since the returned
stock keeps its batch's age (fixed 2026-09-18; it used to come back dated at the challan and queue
behind newer stock). Test: `fifoCosting.test.ts` "a challan posted before FIFO". On QC, list the
challans still open at deploy and re-issue the ones whose figures matter.

### Still open

- **A used bill's rate/discount change** — see the table above; parked for its own session.

- **D2's screen message** — "a back-dated inward lands before already-costed outwards" — is not built.
- **QC (`jobwork_dev`)**: `migrate deploy`, then `fifo-cutover.ts` (dry run, then `--apply`) must run
  **before anyone posts** — until it does, every outflow of pre-existing stock is refused. Run on
  `jobwork_local` 2026-09-18: no negative positions, 316 legacy layers, invariant ties for every org.
- A godown-to-godown transfer document does not exist yet; `postTransfer` is ready for it.
