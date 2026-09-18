# Jobwork — Core Walkthrough

> ### 🔴 2026-08-12 — "lot" is now "batch", and package tracking is gone
>
> Two changes landed together and every document in `docs/` was renamed with them:
>
> 1. **`lots` → `batches`.** The table, `lot_number` → `batch_number`, `supplier_lot_ref` →
>    `supplier_batch_ref`, `parent_lot_ids` → `parent_batch_ids`, and every `lot_id` → `batch_id`.
>    A pure rename — no row, ledger entry or genealogy array changed. The number sequence now mints
>    `BATCH-00001`; numbers already printed on tags keep their `LOT-` prefix on purpose.
> 2. **Package-level (per-taka) tracking was REMOVED end to end.** `lot_packages`,
>    `lot_package_id` on five tables, `parent_package_id`, `Process.preservesPackaging` and
>    `JobReceipt.mode` are all dropped. Quantity granularity now stops at the batch.
>    `Item.lot_tracking` went with it — `inventory_tracking` (`none | batch`) is the one tracking
>    column, and it is the one the item form has always written.
>
> **The rest of this document has been brought in line with both** — every table, column and
> field listed below is one that exists today. `JOBWORK_DOMAIN_AND_MODULE_MAP.md` keeps the
> package reasoning, marked as history, because that is where re-adding it would start.

**Status:** explainer, reflects shipped code as of 2026-08-12. This document assumes **no prior
knowledge** of the module. It answers three questions in one pass: what each module is for, what role
every field plays, and which database table gets written at which moment.

**Who it is for:** a developer joining the project, and an operations person who needs to know what
the screens are actually doing. It is deliberately not a spec — the three documents beside it hold
the design reasoning (`JOBWORK_DOMAIN_AND_MODULE_MAP.md`), the field-by-field UI contract
(`JOBWORK_UI_FIELD_SOURCES.md`) and the build order (`JOBWORK_IMPLEMENTATION_PLAN.md`). Where this
document simplifies, those three are correct.

**How to read it:** one worked example runs the whole way through — job order `JO-0007`, 5,000 metres
of grey fabric, dyed then cut. Every section returns to it.

---

## 0. The one-minute version

This system runs **jobwork**: work you send out to someone else and get back. A mill sends grey
fabric to a dyer, gets dyed fabric back, sends that to a cutter, gets panels back, sends those to a
stitcher, gets shirts back. At every hop the goods are still **yours** — they are just sitting
somewhere else.

Five modules, in a fixed order:

| Stage | Module        | What it is                                      | Physical? |
| ----- | ------------- | ----------------------------------------------- | --------- |
| 1     | **Process**   | One operation. "Dyeing." Defined once, reused   | No        |
| 2     | **Route**     | A sequence of operations                        | No        |
| 3     | **Job Order** | One real run. Copies a route once, then owns it | No        |
| 4     | **Issue**     | A challan. Material physically leaves           | **Yes**   |
| 5     | **Receipt**   | What came back, and in what condition           | **Yes**   |

The first three are **paperwork** — nothing physical happens and nothing touches stock. The last two
are **movements**, and they are the only two that write to `stock_ledger`. That single split explains
most of the design: a job order can be edited, a challan essentially cannot.

### The items in the example

| Item                | Unit | Role                                                          |
| ------------------- | ---- | ------------------------------------------------------------- |
| **Grey Fabric**     | MTR  | What we start with — 5,000 m in the godown                    |
| **Dyed Fabric**     | MTR  | Comes back from the dyer                                      |
| **Shirt Panels**    | PCS  | Comes back from the cutter — _the unit changes here_          |
| **Thread**          | CONE | Consumed at stitching, drawn from the godown, not from a step |
| **Stitched Shirts** | PCS  | The finished goods                                            |

---

## 1. Two rules that explain most of the design

Almost every "why is it built like that?" question resolves to one of these two.

### 1.1 A job order is a SNAPSHOT, not a link

When a job order is created from a route, the route is read **exactly once** and never again. Every
value — process name, processor, each output's rate — is _copied_ into the job order's own rows.

This is why `job_order_steps` carries `processNameSnapshot` and `processorNameSnapshot` beside the
ids. It looks redundant. It is not: **the rate on a released order is a number somebody agreed with a
vendor**, and a route edited next March must not silently rewrite a challan printed last January. The
snapshot is what makes routes safe to edit at all.

### 1.2 The ledger is the only truth about quantity

There is no `stock_balance` table and there will not be one. Stock on hand is always computed:

```
SUM(qty_in − qty_out)  grouped by  item × batch × location × ownership
```

`stock_ledger` is **append-only**. A mistake is never edited or deleted — it is corrected with a
reversing entry, and cancelling a posted document writes the opposite rows and flips the document's
status. History survives and the balance stays right.

The consequence worth internalising: **goods at a processor are still your stock.** Sending fabric to
a dyer is a _transfer_, not a disposal. It changes location; it never leaves your books.

---

## 2. Process — one operation, defined once

**Writes:** `processes`

A Process is a single operation your shop does or buys: Dyeing, Cutting, Stitching, Washing. Defined
once. It holds _defaults_ and _behavioural flags_ — never quantities, never a price for a specific
job.

| Field                     | Source | What it decides                                                                                                                                                 |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                    | typed  | Unique per organisation. Deleting and re-creating "Dyeing" **revives** the old row rather than failing — a soft-deleted row still holds its unique key          |
| `code`, `description`     | typed  | Free text. Nothing derives meaning from either                                                                                                                  |
| `itemChanges`             | typed  | **Does what comes back differ from what went in?** Cutting: yes (fabric → panels). Washing: no. Drives whether the form seeds the output as a copy of the input |
| ~~`rateBasis`~~           | —      | **Gone, 2026-09-15.** Every charge is rate × accepted qty on an output row (§4.4). The column is dropped by landed-cost Migration 2                             |
| ~~`defaultTolerancePct`~~ | —      | **Gone, 2026-09-15.** Tolerance is typed on each consumed row of the job order (§4.3); the item-level default that briefly replaced it went on 2026-09-16       |

---

## 3. Route — the reusable sequence

**Writes:** `routes` · `route_steps` · `route_step_inputs` · `route_step_outputs`

A Route is a named sequence: _"Shirting — grey to finished"_ = Dyeing → Cutting → Stitching. It
exists so nobody retypes the same twelve fields on every order.

Each step lists what it **consumes** and what it **produces** — as two lists, not two fields.
Stitching consumes panels _and_ thread _and_ buttons, and returns shirts _and_ rejects. One item in,
one item out was never enough to describe real work.

| Table                | One row is                | Key fields                                                                                                          |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `routes`             | The template header       | `name`, `code`, `description`                                                                                       |
| `route_steps`        | One operation in sequence | `seq` (1…n), `processId`, `processorType`, `processorId`, `workCentreLocationId`, `expectedYield`                   |
| `route_step_inputs`  | What the step consumes    | `seq`, `itemId`, `uomId`, `plannedQty` — the quantity this shop _usually_ runs                                      |
| `route_step_outputs` | What the step produces    | `seq`, `itemId`, `uomId`, `isPrimary`, `rate` — the suggested charge per accepted unit. 🔴 **No quantities at all** |

**Why outputs carry no quantity.** What comes back is a per-run answer. A template that guessed it
would put a number on the receipt screen nobody had reason to believe. The consumed side carries a
default because "we usually run 5,000 metres" is a real, reusable fact.

**Editing a route is always safe.** Rename it, re-rate it, delete it — none of it can reach an order
already running. That is §1.1 paying for itself.

> ⚠️ **One implementation oddity.** Saving a route **hard-deletes** its steps and rewrites them, in a
> codebase where everything else soft-deletes. It is safe only because nothing points at a
> `route_steps.id` — a job order copies values, never references. The moment anything does reference
> one, this has to become a soft delete with a partial unique index.

---

## 4. Job Order — one real run

**Writes:** `job_orders` · `job_order_steps` · `job_order_step_inputs` · `job_order_step_outputs` ·
`number_sequences`

The document everything else hangs off. It says: _this specific material, through these specific
operations, at these agreed rates._ It is still only a plan — creating one moves no stock and writes
nothing to the ledger.

### 4.1 The header — `job_orders`

| Field                                   | Source        | Role                                                                                                                                                                                         |
| --------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobOrderNumber`                        | **allocated** | From `number_sequences`, **inside the save transaction** — an abandoned form burns no number and an interrupted save leaves no gap. A typed number is honoured and pushes the series past it |
| `orderDate`, `targetDate`               | typed         | When raised, when it is due                                                                                                                                                                  |
| `routeId`                               | typed         | Optional. A job order with **no route** is completely normal — steps typed by hand is what "fully flexible" means                                                                            |
| `routeNameSnapshot`                     | **snapshot**  | Frozen so a deleted route still prints                                                                                                                                                       |
| `ownership`, `ownerPartyId`             | typed         | **Whose goods are these?** `own` = ours, enters valuation. `customer` = someone else's material we are processing (inward jobwork) — always zero-valued                                      |
| `inputItemId`, `inputUomId`, `inputQty` | **derived**   | 🔴 Never typed. Copied from step 1's first consumed row so the list page has a column. A step consumes a _set_ of items, so one item on the header could only ever name one of them          |
| `status`                                | **derived**   | Recomputed from the documents underneath. Never accepted from a client — see §8                                                                                                              |
| `remarks`, `customFields`               | typed         | Free text; per-org dynamic fields                                                                                                                                                            |

### 4.2 The steps — `job_order_steps`

| Field                                  | Source         | Role                                                                                                                           |
| -------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `seq`                                  | **renumbered** | 1…n from array position. 🔴 **Printed on challans**, which is why reordering a started step is refused                         |
| `processId`                            | typed          | Which operation                                                                                                                |
| `processNameSnapshot`                  | **snapshot**   | Frozen at creation. Rename the process next year; this still prints what was agreed                                            |
| `processorType`                        | typed          | `vendor` \| `customer` \| `internal`. Internal means in-house, so a work centre replaces the vendor                            |
| `processorId`, `processorNameSnapshot` | **snapshot**   | Who does the work. Name frozen — a vendor deleted next year must still print on this order                                     |
| `workCentreLocationId`                 | typed          | Only for `internal`. Mutually exclusive with `processorId`                                                                     |
| ~~`rate`, `rateBasis`~~                | —              | **Gone, 2026-09-15** — the rate is on each output row (§4.4). Dropped by Migration 2                                           |
| `expectedYield`                        | typed          | The conversion ratio when the unit changes — 0.6 turns 4,800 M into 2,880 PCS. Not on the grid today; arrives via route or API |
| ~~`tolerancePct`~~                     | —              | **Gone, 2026-09-15** — tolerance is per consumed row (§4.3). Dropped by Migration 2                                            |
| `plannedInputQty`                      | **derived**    | A copy of the principal input's quantity, kept in step with it                                                                 |
| `status`                               | **derived**    | `pending → issued → partially_received → completed`, or `short_closed`                                                         |

> ⚠️ **Dropped 2026-08-12** (Migration B): `issueItemId`, `issueUomId`, `receiveItemId` and
> `receiveUomId`, on both `job_order_steps` and `route_steps`. They duplicated the principal input and
> the primary output onto the step row while the screens moved onto the two lists. Everything reads
> **row 1 of the relevant list** now — the Issue dialog, the receipt prefill, the Overview's
> availability figure and its wastage unit check. If you find one referenced anywhere, it is stale.

### 4.3 What a step consumes — `job_order_step_inputs`

| Field             | Source       | Role                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seq`             | renumbered   | Row order. **Row 1 is the principal input** — what the step is fundamentally about                                                                                                                                                                                                                                    |
| `itemId`, `uomId` | **forced**   | 🔴 The unit is always the **item's own stocking unit**, never chosen. A document disagreeing with the ledger about units is how a challan and the stock record describe one movement two ways                                                                                                                         |
| `plannedQty`      | typed        | How much to consume. Left blank on a chain-fed row, it takes whatever the steps above still have spare. 🔴 Required, with every output's `expectedQty`, before the step's first challan posts — every receipt is costed from the two (§6.5)                                                                           |
| `tolerancePct`    | typed        | Per item, because small quantities vary proportionally more — fabric at 3% beside thread at 25%. Typed per run, never inherited — the item default was removed 2026-09-16 because the allowance is not fixed for an item. Blank = unchecked, 0 = none allowed. The over-issue ceiling reads this row and nothing else |
| `fromStock`       | **computed** | **Where does this item come from?** `false` = an earlier step in this order produces it. `true` = it comes off the shelf. Computed at save by walking the earlier steps; a client cannot send it                                                                                                                      |

### 4.4 What a step produces — `job_order_step_outputs`

| Field             | Source               | Role                                                                                                                                                                                                        |
| ----------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seq`             | renumbered           | Row order                                                                                                                                                                                                   |
| `itemId`, `uomId` | **forced**           | Same rule — the item's own stocking unit                                                                                                                                                                    |
| `expectedQty`     | typed **or derived** | How much should come back. Defaulted only on a step with a **single output** in the input's unit; otherwise typed. With the inputs' `plannedQty` it states the plan ratio every receipt is costed by (§6.5) |
| `isPrimary`       | **computed**         | Exactly one per step — the row a receipt header's totals describe. Defaults to the first row. It no longer carries the step's cost (§6.5)                                                                   |
| `rate`            | typed                | Charge per **accepted** unit of this output, copied from the route output. `null` = none agreed, `0` = free                                                                                                 |
| `components`      | **snapshot**         | A composite output's recipe, frozen into `job_order_step_output_components` at save — what receipts draw by. Editing the item's recipe afterwards changes no running order                                  |

🔴 **What a step may look like, checked at save (V1, V2, V5).** A step consuming more than one item may
only produce **composites**, whose recipe says what each output is made from, and every component must
be one of the step's inputs. An output that is itself one of the inputs — leftover fabric returned
beside the shirts — passes straight through and is exempt. Every input must be used by something the
step produces: an item in no recipe is refused rather than quietly written off at completion. A
single-input step with **two or more** outputs gives each a **Share (%)** of the input's material (R1b),
in any units, totalling 100 % — checked when the job order is saved — so a thick item made from 9 m of the 100 m is
charged 9 m, not a metre's worth. Those are what let every output carry its own cost without comparing
pieces with kilograms (§6.5).

---

## 5. Issue — the challan at the gate

**Writes:** `job_issues` · `job_issue_lines` · `stock_ledger` (×2 per line) · `number_sequences`

The first document where something physically happens. Material leaves your godown and arrives at the
processor. One challan covers **one movement to one processor** — which is why fabric, thread and
buttons ride on the same document.

### 5.1 Header — `job_issues`

| Field                                                                         | Role                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `challanNumber`                                                               | Allocated on save and never reused — it is printed and handed to a driver                                                                                    |
| `sourceLocationId`, `destinationLocationId`                                   | Stock moves **out** of source, **in** to destination. The processor's location is auto-created the first time you send them anything                         |
| `processorNameSnapshot`, `processorAddressSnapshot`, `processorGstinSnapshot` | Frozen for printing. The address is one text blob, not five columns — never queried, only printed, and Indian address shapes vary too much to parse back out |
| `itemId`, `uomId`                                                             | **legacy** header copy. The item really lives on the line                                                                                                    |
| `isRework`, `attemptNo`                                                       | Rework goes back to the _same_ step. The attempt counter stops a second pass being mistaken for over-issue                                                   |
| `totalQty`                                                                    | Sum of the lines, denormalised. Safe because lines are written once in this document's own transaction and never edited                                      |
| `toleranceOverrideReason`                                                     | Why an over-issue was allowed. 🔴 A tolerance breach that leaves no trace is a tolerance that does not exist                                                 |
| `status`                                                                      | **derived** — `issued` \| `partially_received` \| `closed` \| `cancelled`                                                                                    |

### 5.2 Lines — `job_issue_lines`

One row per **batch** — or per physical roll, when the item is tracked that finely.

| Field             | Role                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `itemId`, `uomId` | 🔴 The item lives **here**, not on the header. One challan carries fabric, thread and buttons |
| `batchId`         | Which batch physically went                                                                   |
| `qty`             | How much of that batch went                                                                   |

You do not issue "100 metres" — you issue **100 metres from batch BATCH-0042**. That distinction is why a
storekeeper has to be at the rack: the planner, days earlier, could not know which batches would be on
the shelf today.

### 5.3 The guards before it saves

1. **The chain.** A step past the first cannot issue until the step before it has returned
   _something_. Until then there is physically nothing to send on. **Any amount unblocks it**, so
   partial progress works normally — cutting returns 40 of 100 panels and stitching can start on
   those 40 immediately.
2. **The item set.** Every line must name an item the step declared it consumes. You can send less,
   or skip an item entirely; you cannot invent one.
3. **The tolerance ceiling.** Per item, cumulative across every challan for that step:
   `planned × (1 + the row's tolerancePct ÷ 100)`; a row with no percentage is unchecked. Over it the
   save is refused until a reason is typed. Rework
   issues are excluded from the running total.
4. **The batch, when the item is batch-tracked.** 🔴 An item at `inventoryTracking = 'batch'` cannot
   be issued without naming the batch it goes out of — `resolveLines` returns 400 with
   `details['lines.N.batchId']`. That column is a promise that every metre traces to the roll it
   came off, and an issue is the moment the trace is created; a batch invented then traces to
   nothing, and by the time anyone notices the goods are at the processor. The same column already
   refuses batch-less opening stock, so the two screens now say the same thing. Items at
   `inventoryTracking = 'none'` are unaffected — a bare quantity is exactly what that setting means
   (§10.5).
5. **The plan (V4).** A posted first-pass challan is refused while any input row has no planned
   quantity or any output no expected one. Once a challan exists the step cannot be re-planned, and
   every receipt is costed from those numbers (§6.5). Drafts and rework challans are exempt.
6. **The step is still open (R9).** Nothing is issued against — and no challan is cancelled on — a
   completed or closed-short step, whose remainder has already been written off (§8.1).

### 5.4 The ledger writes — two rows per line

```
transfer_out   qty_out = 5000   @ Main Godown
transfer_in    qty_in  = 5000   @ Sunrise Dyers
```

Net quantity change: **zero**. Nothing was consumed — it moved. This is §1.2: goods at a processor
are still yours, at a different location.

---

## 6. Receipt — what actually came back

**Writes:** `job_receipts` · `job_receipt_outputs` · `job_receipt_lines` · `batches` ·
`stock_ledger` · `number_sequences`

The most information-dense document in the module, because it answers three questions at once: what
was **consumed**, what **came back**, and **in what condition**.

### 6.1 The disposition split

Every returned quantity breaks into four buckets, and they must add up exactly to `receivedQty`:

| Bucket        | Meaning                                                                       | Ledger row?                        |
| ------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| `acceptedQty` | Good. Goes into stock as a new batch                                          | Yes — `produce`                    |
| `reworkQty`   | Fixable. Gets its **own separate batch**, so the piece count stays measurable | Yes — into a separate batch        |
| `scrapQty`    | Destroyed. Accounted for, but worthless                                       | Yes                                |
| `returnedQty` | Handed straight back at the gate                                              | 🔴 **No — it never entered stock** |

🔴 **Why the four must sum.** That single check is what makes a separate "Rejection Note" document
unnecessary. Two documents can disagree about how much came back. One row cannot disagree with
itself.

### 6.2 Header — `job_receipts`

| Field                                                                                         | Role                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `receiptNumber`, `receiptDate`                                                                | Allocated on save; when the goods arrived                                                                                                   |
| `bulk` — copied from the process at save, so a later edit cannot retell what this receipt did |
| `outputItemId`, `outputUomId`                                                                 | What came back. A **different item** from what went out whenever the process says so                                                        |
| `locationId`                                                                                  | Where the goods landed — ours again, so a godown                                                                                            |
| `outputBatchId`, `reworkBatchId`                                                              | ⚠️ The **first** accepted / rework batch of the primary output — see §6.4. Shortcuts back; `Batch.parentBatchIds` is what carries genealogy |
| `totalIssuedQty` … `totalReturnedQty`                                                         | The six summed totals. Refused unless the split adds up                                                                                     |
| `consumedValue`, `processChargeTotal`                                                         | What the consumes posted, and the charges on top — the receipt's cost, stored as posted (§6.5)                                              |
| `status`                                                                                      | `posted` \| `cancelled`. A cancellation posts **reversing** rows; it never deletes anything                                                 |

### 6.3 Three child tables, different lengths

| Table                        | Answers                                                        | Notable fields                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `job_receipt_lines`          | What was **consumed** — closes the challan lines that went out | `jobIssueId`, `jobIssueLineId`, `issuedQty`, `receivedQty`, the four buckets                                                                    |
| `job_receipt_outputs`        | What **returned** — one row per item that came back            | `itemId`, `receivedQty`, the four buckets, `isPrimary`, `rate`, `materialValue`, `processCharge`, `outputBatchId`, `reasonId`, `responsibility` |
| `job_receipt_output_batches` | **Which batches** each returned row landed in — §6.4           | `kind` (`accepted` \| `rework`), `batchId`, `qty`, `isNewBatch`                                                                                 |

The first two are separate because they are genuinely different lengths. Cutting consumes one fabric
and returns panels, offcuts and waste; stitching consumes three items and returns two. One table
holding both would leave half its columns null on every row, and neither sum check could then add up
its own rows.

**Two fields worth calling out:**

- `responsibility` — `ours` \| `theirs`. Decides whether rework is re-charged to the vendor or
  absorbed, and feeds the vendor scorecard later.

### 6.4 One returned row, several batches (2026-08-21)

Until this date a returned row created **exactly one** accepted batch and one rework batch. Two
ordinary things were therefore impossible:

- a dyer returning **three dye lots** in one consignment — one label across all three loses the
  separation the lots were physically kept in;
- the **second half of a split delivery** — 500 m of dye lot 23 today and 500 m tomorrow could only
  become two batches carrying the same label, so a recall on lot 23 finds half the stock.

So `outputs[].batches` and `outputs[].reworkBatches` each carry a list, and every entry is one of two
things:

| Entry            | Means                                             | `isNewBatch` |
| ---------------- | ------------------------------------------------- | ------------ |
| `batchReference` | Create a batch under this label — the normal case | `true`       |
| `batchId`        | **Add to** a batch that already exists            | `false`      |

**The rules, and why each exists:**

- The batches must **add up** to their side's quantity, checked in the schema _and_ beside the write.
  Under-allocating posts less stock than the receipt claims came back; over-allocating posts stock
  nobody received, and neither is recoverable from the document afterwards.
- Accepted and rework **never share a batch**. Merged, the piece count rework has to be measured by
  is gone and the re-issue cannot send back only the pieces that failed.
- Scrap and returned goods get **no batch at all** — a planned loss's cost stays inside the batches
  that survived, what the receipts never used is written off at completion (§8.1), and returned
  goods never entered stock (§6.4 of the domain map).
- An existing batch must match on **item, unit, and the ownership pair**. The third is the dangerous
  one: merging customer-owned inward jobwork into own stock silently converts somebody else's goods
  into our asset.
- Its `parentBatchIds` are **appended**, deduped, never self. The second delivery may have consumed
  input batches the first did not, and an incomplete trace cannot be rebuilt.
- Its `sourceDocType` / `sourceDocId` are **not** rewritten — they say what _bore_ the batch, which
  stays true. Later deposits live on the ledger, keyed to the receipt that made them.

**The picker** (`GET …/jobwork/receipts/batch-options`) is scoped by **provenance, not location**:
this job order's own batches in one group, every other batch of the item in a second. The reason is
the day-two case above — 500 m received Monday and issued onward Wednesday sits at **zero**, so a
"what's in this godown" list hides exactly the batch Friday's delivery wants to continue, and offers
every unrelated batch that happens to be sitting there instead. Where each batch _is_ comes back as
data on the row (`byLocation`, split into `internalQty` / `externalQty`, since goods at a processor
are our stock at their location and must never be summed into "on hand").

The second group **answered a search only until 2026-08-22**. The intent — make merging into an
unrelated batch a deliberate act — still holds, but the price was that a _first_ receipt opened the
picker on two empty sections and read as a broken screen. Both groups are now listed, and
deliberateness is carried where it belongs: by the two headings (a heading is a hard separator; an
icon on an interleaved row is not) and by the per-row warning on group two. What changed with it:

|               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Group one** | Returned **whole** — bounded by construction, ~one batch per prior delivery. Not paged, because group two excludes it by id list and a partial list would let a batch appear in both. Capped at **3 rows in the UI** with a `+ N more` expander, so a long delivery history cannot bury group two's heading below the fold. Arrowing onto the last visible row expands it — the `+ N more` button lives in the portal, outside the dialog's focus trap, so Tab can never reach it. |
| **Group two** | One **keyset** page of 25 (`otherNextCursor`, `(created_at, id) DESC`), fetched on scroll. Not `OFFSET`: a batch created mid-scroll shifts the tail and rows duplicate or vanish. A cursor page carries `jobOrderBatches: []` — re-shaping group one per page would cost a balance query for rows the client already holds.                                                                                                                                                        |
| **Search**    | Narrows **both** groups. Filtering only the second left an unfiltered group sitting above a filtered one, which reads as the search having failed. Debounced 300ms; `batch_number` stays unsearchable (2026-08-14). Backed by GIN/`pg_trgm` indexes on `supplier_batch_ref` and `manufacturer_batch` — the match is infix `ILIKE '%…%'`, which no b-tree serves, and it now runs on every plain open of the dropdown rather than only once somebody has typed.                     |

**Cancellation** reads `job_receipt_output_batches` for every batch the receipt touched — including
by-products, which the header's two columns never named — and refuses when anything **other than
this receipt** has taken quantity **out** of one. Quantity somebody else put _in_ is harmless, and
must stay so: a batch created by an earlier receipt and topped up by this one carries that earlier
`produce` forever.

### 6.5 How a receipt is costed (landed cost, 2026-09-15)

A receipt **no longer settles its challans in full**. It works out how much of each input the goods
that came back used, consumes exactly that, and leaves the rest at the processor. The rules live in
`receipts/landedCost.ts`; `docs/JOBWORK_LANDED_COST_PLAN.md` §3 numbers them R1–R9.

| Question                                  | Answer                                                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How much of an input one unit draws (`w`) | The output's recipe quantity, from the snapshot on the job order, for a composite · 1 for a plain output of a single-input step · 1 against itself for an output that is also an input, and on a rework receipt |
| The plan ratio (`k`)                      | `planned ÷ Σ(expected × w)` per input item — it carries the expected loss and, across a unit change, the conversion. Rework uses `k = 1`                                                                        |
| Need                                      | `(accepted + rework) × w × k`, to 4 dp                                                                                                                                                                          |
| Used                                      | The typed figure (refused above what is still out, or when nothing returned draws on the item), else `min(need, still out)` — a cap is a warning, never a refusal. Allocated oldest challan line first          |
| Closing a challan (2026-09-17)            | Ticked per challan. Used is at least everything still out on the closed challans (a typed figure below that is refused), and their lines are allocated first. Stored as `job_receipt_lines.closes_challan`      |
| Material value per row                    | Each input's consumed value split across the rows that draw on it **by need**, through `splitByQty`                                                                                                             |
| Charge per row                            | `rate × accepted`. The rate on the receipt row, else the job order output's; `null` = ₹0                                                                                                                        |
| Accepted vs rework                        | The row's material splits by quantity; the charge lands on accepted only                                                                                                                                        |
| Stored                                    | `rate`, `materialValue`, `processCharge` on each output row; `consumedValue`, `processChargeTotal` on the header — never re-derived                                                                             |

**What it refuses:** an item the step's plan does not list (first pass); a composite output with no
recipe frozen onto the job order; rework and first-pass challans on one receipt; any receipt, or
receipt cancellation, on a completed or closed-short step; closing a challan whose item nothing
returned is made from; and any receipt — draft or posted — against a challan a posted receipt closed,
naming that receipt. Cancelling the closing receipt is how the challan reopens. The Receive screen previews the same
arithmetic per row (`receiptCostPreview`), but the server's figure is the one that posts.

---

## 7. Batches and the ledger

These two tables sit underneath the whole module and are shared with the rest of inventory. Jobwork
writes to them; it does not own them.

| Table          | One row is                                | Key fields                                                                                                                               |
| -------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `batches`      | A batch of one item sharing an identity   | `batchNumber`, `itemId`, `uomId`, `ownership`, `ownerPartyId`, `parentBatchIds[]`, `sourceDocType`, `sourceDocId`, `status`              |
| `stock_ledger` | One movement of one quantity. Append-only | `itemId`, `batchId`, `locationId`, `ownership`, `qtyIn`, `qtyOut`, `valueIn`, `valueOut`, `movementType`, `sourceDocType`, `sourceDocId` |

### 7.1 Genealogy — `parentBatchIds`

When a receipt creates a batch of dyed fabric it records **every** batch consumed to make it. Written at
that moment or never — it cannot be reconstructed from history that was not recorded. This is what
answers _"which grey fabric ended up in this shirt?"_ two years later.

🔴 A batch number carries **no meaning**. A child batch has a higher number than its parents only because
it was created later. Parentage lives in the array and nowhere else.

### 7.2 Movement types

| Type                           | Written by                  | Means                                                                                             |
| ------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `transfer_out` / `transfer_in` | Issue                       | Same goods, new location. Net zero                                                                |
| `consume`                      | Receipt                     | What the returned goods used, at the processor                                                    |
| `produce`                      | Receipt                     | A new item exists, in a new batch, at your godown                                                 |
| `receipt` / `opening`          | Purchase / opening stock    | Stock enters the books from outside                                                               |
| `reversal`                     | Cancellation                | The opposite of a posted row. Never a delete                                                      |
| `scrap`                        | Complete step / Close short | What was still at the processor, written off as job order loss (`sourceDocType = job_order_step`) |

---

## 8. Statuses are derived, never set

Both `job_orders.status` and `job_order_steps.status` are recomputed from the documents underneath
them. The API refuses to accept either — a list page saying "completed" beside an overview that adds
up the receipts and disagrees is worse than no status at all.

| Step status          | Means                                                                |
| -------------------- | -------------------------------------------------------------------- |
| `pending`            | Nothing issued yet                                                   |
| `issued`             | Material is out; nothing accounted for yet                           |
| `partially_received` | Some items back, some still at the processor                         |
| `completed`          | A human marked it complete. What was still out is written off (§8.1) |
| `short_closed`       | A human decision: finished, and the numbers do not balance. Sticky   |

🔴 **Completion is a decision, not a sum** (2026-08-24). Arithmetic decides everything below it —
`issued` and `partially_received` are judged per item, on the input side, consumed against issued,
never received against issued, because both are in the input's own unit (2,880 pieces against 4,950
metres compares nothing). But a step whose paperwork balances is still `partially_received` until
somebody presses **Mark as complete** — and with landed costing the paperwork rarely balances anyway,
because receipts leave unplanned loss at the processor.

The order rolls up from its steps: `draft` until the first issue, then `in_progress`, then
`completed`. `short_closed` and `cancelled` are **sticky** — once set, the roll-up returns early and
the label never changes on its own.

### 8.1 Completing a step writes off what is left (2026-09-15)

**Writes:** `stock_ledger` (`scrap`, one row per open challan line) · `job_order_steps`

Receipts consume only what the plan says the goods used, so a step ends with material still standing
at the processor — unless its challans were **closed** on their last receipt, which consumes the
remainder into cost and leaves nothing here to write off (§6.5). **Mark as complete** is somebody
saying none of what is still out is coming back:

- every posted challan line's remainder — `qty − used by posted receipts − already written off` — is
  scrapped where it stands, same batch and same package, **however small**, so a completed step
  leaves exactly nothing at the processor;
- it is valued at that batch's running cost there, and that value is **job order loss** — reported
  on the Overview per input item, never loaded back onto output batches that may already have moved
  on. Customer-owned stock writes off at zero value;
- each row carries `sourceDocType = job_order_step`, `sourceDocId` = the step and `sourceDocLineId` =
  the challan line, which is how `closedQtyByIssueLine` counts it as no longer out.

It is **refused while a draft challan or receipt is parked on the step** (a draft there could never
post), and refused — rather than posted into a negative balance — when the ledger holds less at the
processor than the challans say is out. **Close short** writes off every step it closes the same way.
There is no reopen: afterwards the step accepts no issue, receipt, or cancellation.

---

## 9. End to end — every write, in order

Job order `JO-0007`: 5,000 metres of grey fabric, dyed then cut.

### Day 1 — the plan is created

| Table                    | Rows  | Contents                                                                       |
| ------------------------ | ----- | ------------------------------------------------------------------------------ |
| `number_sequences`       | 1 upd | Next job order number advanced to 8                                            |
| `job_orders`             | 1     | `JO-0007`, ownership `own`, `inputQty` 5000 **derived** from step 1            |
| `job_order_steps`        | 2     | seq 1 Dyeing @ Sunrise Dyers · seq 2 Cutting @ Precision Cutting               |
| `job_order_step_inputs`  | 2     | Step 1: Grey 5,000 M `fromStock=true` · Step 2: Dyed 4,950 M `fromStock=false` |
| `job_order_step_outputs` | 2     | Step 1: Dyed 4,950 M · Step 2: Panels 2,880 PCS (typed — the unit changes)     |
| `stock_ledger`           | **0** | 🔴 Nothing. A plan moves no stock                                              |

Step 2's input was left blank on the form and the system planned it at **4,950** — exactly what step
1 expects to return. Its output had to be typed, because 4,950 metres has no derivable answer in
pieces.

### Day 2 — 5,000 M goes to the dyer

| Table             | Rows | Contents                                                  |
| ----------------- | ---- | --------------------------------------------------------- |
| `job_issues`      | 1    | `JI-0031` · Main Godown → Sunrise Dyers · `totalQty` 5000 |
| `job_issue_lines` | 1    | Grey Fabric, batch `BATCH-0088`, 5,000 M                  |

| Movement       | Batch        | Location      |    Qty |     Value |
| -------------- | ------------ | ------------- | -----: | --------: |
| `transfer_out` | `BATCH-0088` | Main Godown   | −5,000 | −₹250,000 |
| `transfer_in`  | `BATCH-0088` | Sunrise Dyers | +5,000 | +₹250,000 |

Step 1's status flips to `issued`. Step 2 is still blocked — nothing has come back from step 1, so
there is physically nothing to cut.

### Day 9 — the dyer returns 4,930 M

4,900 accepted, 30 rework.

The 4,900 accepted metres came back as **two dye lots**, kept apart, so the operator allocates them
to two batches in the Add Batches grid: 3,000 to `DY-23` and 1,900 to `DY-24`.

| Table                        | Rows | Contents                                                                                 |
| ---------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| `job_receipts`               | 1    | `RC-0019` · received 4,930 · accepted 4,900 · rework 30 · cost stored                    |
| `job_receipt_lines`          | 1    | Against `JI-0031`'s line · `issuedQty` 4,979.7980                                        |
| `job_receipt_outputs`        | 1    | Dyed Fabric · `isPrimary` · the four buckets                                             |
| `job_receipt_output_batches` | 3    | accepted → `DY-23` 3,000, `DY-24` 1,900 · rework → `DY-23/RW` 30 — all `isNewBatch` true |
| `batches`                    | 3    | All three, each with `parentBatchIds = [BATCH-0088]`                                     |

| Movement  | Batch        | Location      |         Qty | Note                             |
| --------- | ------------ | ------------- | ----------: | -------------------------------- |
| `consume` | `BATCH-0088` | Sunrise Dyers | −4,979.7980 | What the goods used, by the plan |
| `produce` | `DY-23`      | Main Godown   |      +3,000 | Accepted, first lot              |
| `produce` | `DY-24`      | Main Godown   |      +1,900 | Accepted, second lot             |
| `produce` | `DY-23/RW`   | Main Godown   |         +30 | Rework, kept separate            |

**How much grey this used comes from the plan** (§6.5): 5,000 M planned for 4,950 M expected, so
every metre back used 1.0101 M, and 4,930 back used **4,979.7980 M** — the planned 1% shrinkage
included. That is all that is consumed, worth ₹248,989.90. The material splits between accepted and
rework by quantity; the output's rate × 4,900 accepted is added to the accepted side only; and across
the two accepted batches the **last batch takes the remainder**, so the batches hold exactly what was
posted.

The other **20.2020 M stays at Sunrise Dyers** — still out, not wastage. The next delivery can use
it; if none comes, completing the step writes it off as job order loss (§8.1). Step 1 is
`partially_received`; step 2 unblocks; the order moves to `in_progress`.

**Where the balance stands:**

```
Grey Fabric @ Main Godown          0
Grey Fabric @ Sunrise Dyers  20.2020   (still out — written off if the step is completed)
Dyed Fabric @ Main Godown      4,930   (3,000 DY-23 + 1,900 DY-24 + 30 rework)
```

### Day 12 — the dyer sends the rest of DY-23

A further 400 metres of the **same dye lot** turns up. It is not a new lot, so the operator picks
`DY-23` in the grid instead of typing a label — even though Day 10's 3,000 metres have already gone
to the cutter and `DY-23` sits at zero in the godown.

| Table                        | Rows | Contents                                                   |
| ---------------------------- | ---- | ---------------------------------------------------------- |
| `job_receipt_output_batches` | 1    | accepted → `DY-23` 400, `isNewBatch` **false**             |
| `batches`                    | 0    | 🔴 None created. One physical lot stays under one batch id |

`DY-23`'s `parentBatchIds` gains whatever this delivery consumed that Day 9 did not; its
`sourceDocId` still points at `RC-0019`, because that is what bore it.

---

## 10. What will bite you

### 10.1 Editing is allowed only past the work front

A running order is editable — but only _past the last step that has a live challan or receipt_.
Everything at or behind that line is frozen, **including untouched steps sitting between two started
ones**, because removing one would renumber the started steps after it and their numbers are printed
on paperwork.

**One exception (2026-09-17): a frozen step's processor.** On the step it is only the Issue screen's
default — every challan snapshots its own processor and receipts inherit from the challans — so it
may be changed, and only the next challan feels it. "Done by" stays frozen, as does the processor of a
completed or closed-short step, which takes no more challans.

> 🔴 **The cascade that eats your challans.** Saving an order **hard-deletes** steps before rewriting
> them, and both `job_issues` and `job_receipts` are `onDelete: Cascade` off the step. If that delete
> is ever run unscoped over a running order, **every challan and receipt on it is silently destroyed**
> and their ledger rows orphaned. The scope — delete only where `seq > frontSeq` — is the only thing
> preventing it. Never widen it.

### 10.2 Units are never converted

There is no metres-to-pieces conversion anywhere and there will not be one. Knowing both units tells
you the two numbers differ; it does not tell you the ratio, because that depends on the pattern being
cut, not on the units. 4,800 M yields 2,880 shirt panels **or** ~14,000 sleeve panels from the
identical two units.

The planned `ItemUomConversion` does not help either: that is _one item in two units_ (buy fabric in
KG, issue in M), which is a fixed property of the item. This is _two different items_, and the
relationship between them is per-job.

### 10.3 `null` is not `0`

Repeatedly and deliberately. `tolerancePct = null` on a consumed row means "not checked"; `0` means "no
tolerance whatsoever". An output's `rate = null` means none agreed and charges ₹0; `rate = 0` means agreed as free. Every inheritance in this
module uses `??`, never `||`, for exactly this reason.

### 10.4 A soft-deleted row still holds its unique key

Deleting "Dyeing" does not free the name — which is why creating it again **revives** the old row
rather than failing. The same reasoning is why step `seq` values are hard-deleted rather than soft: a
removed step would otherwise hold its number forever.

### 10.5 Stock availability is currently not enforced — for untracked items only

⚠️ The issue screen will presently create a **zero-valued batch** for an item with no stock on record.
This is temporary scaffolding from before Purchase Received existed — without it there would be no
way to put stock on the books at all and the whole loop would be untestable. The chain guard (§5.3)
is deliberately _not_ relaxed alongside it: raw material can be conjured while Purchase Received is
missing, work in progress cannot.

🔴 Since 2026-08-13 the scaffold is reachable **only for `inventoryTracking = 'none'`**. A
batch-tracked item is turned away by guard 4 (§5.3) before it gets there, so the one case where an
invented batch would destroy real information no longer happens. What the storekeeper does instead is
**Add stock** on the Issue screen itself: one batch, at the godown the challan is going out of, owned
by whoever owns the job order.

That button opens the **same** editor the Item page's "Add Opening Stock" opens — every location, every
existing batch — and posts to the same `POST /items/:id/opening-stock`. Two screens writing one document
must not show two different pictures of it.

🔴 It only became safe to open from there on 2026-08-13, when that endpoint stopped being destructive.
It used to reverse **every** opening movement the item had and re-create them from the payload, which is
only sound while nothing has left: batch A opens at 100, 40 go to a dyer, someone re-saves, and the full
100 is reversed at the godown — A lands at **−40** while a new A′ takes the +100. The location total
still added up, which is why it went unnoticed; `getAvailableBatches` filters on a positive balance, so A
simply vanished from every picker. It now reconciles by **delta** against what the document already said
(`items.service.settleOpening`), keyed on the batch id the form round-trips, and a reduction that would
take out stock which has already moved is refused by name. Pinned by `items.openingStock.test.ts`.

🔴 Restore the `availableQty > 0` check for every item the day Purchase Received lands. Until then the
issue screen tells you what _should_ be there rather than what is — for untracked items.
