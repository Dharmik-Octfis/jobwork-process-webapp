# Jobwork — Core Walkthrough

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
value — process name, rate, processor — is _copied_ into the job order's own rows.

This is why `job_order_steps` carries `processNameSnapshot` and `processorNameSnapshot` beside the
ids. It looks redundant. It is not: **the rate on a released order is a number somebody agreed with a
vendor**, and a route edited next March must not silently rewrite a challan printed last January. The
snapshot is what makes routes safe to edit at all.

### 1.2 The ledger is the only truth about quantity

There is no `stock_balance` table and there will not be one. Stock on hand is always computed:

```
SUM(qty_in − qty_out)  grouped by  item × lot × location × ownership
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

| Field                 | Source | What it decides                                                                                                                                                                |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                | typed  | Unique per organisation. Deleting and re-creating "Dyeing" **revives** the old row rather than failing — a soft-deleted row still holds its unique key                         |
| `code`, `description` | typed  | Free text. Nothing derives meaning from either                                                                                                                                 |
| `itemChanges`         | typed  | **Does what comes back differ from what went in?** Cutting: yes (fabric → panels). Washing: no. Drives whether the form seeds the output as a copy of the input                |
| `rateBasis`           | typed  | `per_issued_unit` \| `per_received_unit` — do you pay for what you sent or for what came back? Copied down to each step, overridable there                                     |
| `preservesPackaging`  | typed  | **Does the physical roll survive?** Dyeing: the same taka returns, so roll-to-roll traceability is possible. Cutting: the roll is destroyed. Decides unit-wise vs bulk receipt |
| `requiresSingleLot`   | typed  | Blocks mixing two lots of one item on one challan. Two dye lots in one garment show shade variation nobody catches until it is assembled                                       |
| `defaultTolerancePct` | typed  | The over-issue allowance a step inherits when it states none. 🔴 `null` ≠ `0` — null means "no default set", zero means "no tolerance whatsoever"                              |

---

## 3. Route — the reusable sequence

**Writes:** `routes` · `route_steps` · `route_step_inputs` · `route_step_outputs`

A Route is a named sequence: _"Shirting — grey to finished"_ = Dyeing → Cutting → Stitching. It
exists so nobody retypes the same twelve fields on every order.

Each step lists what it **consumes** and what it **produces** — as two lists, not two fields.
Stitching consumes panels _and_ thread _and_ buttons, and returns shirts _and_ rejects. One item in,
one item out was never enough to describe real work.

| Table                | One row is                | Key fields                                                                                                                             |
| -------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `routes`             | The template header       | `name`, `code`, `description`                                                                                                          |
| `route_steps`        | One operation in sequence | `seq` (1…n), `processId`, `processorType`, `processorId`, `workCentreLocationId`, `rate`, `rateBasis`, `expectedYield`, `tolerancePct` |
| `route_step_inputs`  | What the step consumes    | `seq`, `itemId`, `uomId`, `plannedQty` — the quantity this shop _usually_ runs                                                         |
| `route_step_outputs` | What the step produces    | `seq`, `itemId`, `uomId`, `isPrimary` — 🔴 **no quantities at all**                                                                    |

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
| `rate`, `rateBasis`                    | typed          | What you pay. Blank `rateBasis` inherits the process's                                                                         |
| `expectedYield`                        | typed          | The conversion ratio when the unit changes — 0.6 turns 4,800 M into 2,880 PCS. Not on the grid today; arrives via route or API |
| `tolerancePct`                         | typed          | The step's over-issue allowance. Each consumed item may override it on its own row                                             |
| `plannedInputQty`                      | **derived**    | A copy of the principal input's quantity, kept in step with it                                                                 |
| `status`                               | **derived**    | `pending → issued → partially_received → completed`, or `short_closed`                                                         |

> ⚠️ **Dropped 2026-08-12** (Migration B): `issueItemId`, `issueUomId`, `receiveItemId` and
> `receiveUomId`, on both `job_order_steps` and `route_steps`. They duplicated the principal input and
> the primary output onto the step row while the screens moved onto the two lists. Everything reads
> **row 1 of the relevant list** now — the Issue dialog, the receipt prefill, the Overview's
> availability figure and its wastage unit check. If you find one referenced anywhere, it is stale.

### 4.3 What a step consumes — `job_order_step_inputs`

| Field             | Source       | Role                                                                                                                                                                                                  |
| ----------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seq`             | renumbered   | Row order. **Row 1 is the principal input** — what the step is fundamentally about                                                                                                                    |
| `itemId`, `uomId` | **forced**   | 🔴 The unit is always the **item's own stocking unit**, never chosen. A document disagreeing with the ledger about units is how a challan and the stock record describe one movement two ways         |
| `plannedQty`      | typed        | How much to consume. Left blank on a chain-fed row, it takes whatever the steps above still have spare                                                                                                |
| `tolerancePct`    | typed        | Per item, because small quantities vary proportionally more — fabric at 3% beside thread at 25%. Blank inherits the step's, and the box shows the step's figure greyed so blank never reads as "none" |
| `fromStock`       | **computed** | **Where does this item come from?** `false` = an earlier step in this order produces it. `true` = it comes off the shelf. Computed at save by walking the earlier steps; a client cannot send it      |

### 4.4 What a step produces — `job_order_step_outputs`

| Field             | Source               | Role                                                                                                                                                                                                                |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seq`             | renumbered           | Row order                                                                                                                                                                                                           |
| `itemId`, `uomId` | **forced**           | Same rule — the item's own stocking unit                                                                                                                                                                            |
| `expectedQty`     | typed **or derived** | How much should come back. Derived only where there is a basis: a stated yield, or the same unit on both sides. Metres in and pieces out with no yield has **no derivable answer**, so the box stays empty and asks |
| `isPrimary`       | **computed**         | Exactly one per step — **the output that absorbs the step's cost**. Offcuts are a by-product and carry none. Defaults to the first row                                                                              |

🔴 **Why one output must be primary.** The step's whole cost — material consumed plus the vendor's
charge — has to land somewhere. Two primaries would pay for the operation twice; none would lose the
cost entirely. It cannot be split by quantity either, because 2,880 PCS and 80 KG have no ratio.

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

One row per **lot** — or per physical roll, when the item is tracked that finely.

| Field             | Role                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `itemId`, `uomId` | 🔴 The item lives **here**, not on the header. One challan carries fabric, thread and buttons |
| `lotId`           | Which batch physically went                                                                   |
| `lotPackageId`    | Which roll, when the item is tracked to package level. Null otherwise                         |
| `qty`             | How much of that lot went                                                                     |

You do not issue "100 metres" — you issue **100 metres from lot LOT-0042**. That distinction is why a
storekeeper has to be at the rack: the planner, days earlier, could not know which lots would be on
the shelf today.

### 5.3 Three guards before it saves

1. **The chain.** A step past the first cannot issue until the step before it has returned
   _something_. Until then there is physically nothing to send on. **Any amount unblocks it**, so
   partial progress works normally — cutting returns 40 of 100 panels and stitching can start on
   those 40 immediately.
2. **The item set.** Every line must name an item the step declared it consumes. You can send less,
   or skip an item entirely; you cannot invent one.
3. **The tolerance ceiling.** Per item, cumulative across every challan for that step:
   `planned × (1 + tolerancePct ÷ 100)`. Over it the save is refused until a reason is typed. Rework
   issues are excluded from the running total.

### 5.4 The ledger writes — two rows per line

```
transfer_out   qty_out = 5000   @ Main Godown
transfer_in    qty_in  = 5000   @ Sunrise Dyers
```

Net quantity change: **zero**. Nothing was consumed — it moved. This is §1.2: goods at a processor
are still yours, at a different location.

---

## 6. Receipt — what actually came back

**Writes:** `job_receipts` · `job_receipt_outputs` · `job_receipt_lines` · `lots` · `lot_packages` ·
`stock_ledger` · `number_sequences`

The most information-dense document in the module, because it answers three questions at once: what
was **consumed**, what **came back**, and **in what condition**.

### 6.1 The disposition split

Every returned quantity breaks into four buckets, and they must add up exactly to `receivedQty`:

| Bucket        | Meaning                                                                     | Ledger row?                        |
| ------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| `acceptedQty` | Good. Goes into stock as a new lot                                          | Yes — `produce`                    |
| `reworkQty`   | Fixable. Gets its **own separate lot**, so the piece count stays measurable | Yes — into a separate lot          |
| `scrapQty`    | Destroyed. Accounted for, but worthless                                     | Yes                                |
| `returnedQty` | Handed straight back at the gate                                            | 🔴 **No — it never entered stock** |

🔴 **Why the four must sum.** That single check is what makes a separate "Rejection Note" document
unnecessary. Two documents can disagree about how much came back. One row cannot disagree with
itself.

### 6.2 Header — `job_receipts`

| Field                                 | Role                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `receiptNumber`, `receiptDate`        | Allocated on save; when the goods arrived                                                                    |
| `mode`                                | `unit_wise` \| `bulk` — copied from the process at save, so a later edit cannot retell what this receipt did |
| `outputItemId`, `outputUomId`         | What came back. A **different item** from what went out whenever the process says so                         |
| `locationId`                          | Where the goods landed — ours again, so a godown                                                             |
| `outputLotId`, `reworkLotId`          | The lots this receipt created. Shortcuts back; `Lot.parentLotIds` is what carries genealogy                  |
| `totalIssuedQty` … `totalReturnedQty` | The six summed totals. Refused unless the split adds up                                                      |
| `status`                              | `posted` \| `cancelled`. A cancellation posts **reversing** rows; it never deletes anything                  |

### 6.3 Two child tables, different lengths

| Table                 | Answers                                                        | Notable fields                                                                                                    |
| --------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `job_receipt_lines`   | What was **consumed** — closes the challan lines that went out | `jobIssueId`, `jobIssueLineId`, `parentPackageId`, `issuedQty`, `receivedQty`, the four buckets                   |
| `job_receipt_outputs` | What **returned** — one row per item that came back            | `itemId`, `receivedQty`, the four buckets, `isPrimary`, `valueShare`, `outputLotId`, `reasonId`, `responsibility` |

They are separate because they are genuinely different lengths. Cutting consumes one fabric and
returns panels, offcuts and waste; stitching consumes three items and returns two. One table holding
both would leave half its columns null on every row, and neither sum check could then add up its own
rows.

**Two fields worth calling out:**

- `responsibility` — `ours` \| `theirs`. Decides whether rework is re-charged to the vendor or
  absorbed, and feeds the vendor scorecard later.
- `parentPackageId` — which roll that went out is this roll that came back. 🔴 **Only recordable at
  this moment**; it cannot be reconstructed from quantities afterwards.

---

## 7. Lots, packages and the ledger

These three tables sit underneath the whole module and are shared with the rest of inventory. Jobwork
writes to them; it does not own them.

| Table          | One row is                                 | Key fields                                                                                                                                             |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lots`         | A batch of one item sharing an identity    | `lotNumber`, `itemId`, `uomId`, `ownership`, `ownerPartyId`, `parentLotIds[]`, `sourceDocType`, `sourceDocId`, `status`                                |
| `lot_packages` | One physical taka / roll / bundle in a lot | `packageNumber` (🔴 restarts at 1 inside each lot), `label`, `qty`, `parentPackageId`, `status`                                                        |
| `stock_ledger` | One movement of one quantity. Append-only  | `itemId`, `lotId`, `lotPackageId`, `locationId`, `ownership`, `qtyIn`, `qtyOut`, `valueIn`, `valueOut`, `movementType`, `sourceDocType`, `sourceDocId` |

### 7.1 Genealogy — `parentLotIds`

When a receipt creates a lot of dyed fabric it records **every** lot consumed to make it. Written at
that moment or never — it cannot be reconstructed from history that was not recorded. This is what
answers _"which grey fabric ended up in this shirt?"_ two years later.

🔴 A lot number carries **no meaning**. A child lot has a higher number than its parents only because
it was created later. Parentage lives in the array and nowhere else.

### 7.2 Movement types

| Type                           | Written by               | Means                                           |
| ------------------------------ | ------------------------ | ----------------------------------------------- |
| `transfer_out` / `transfer_in` | Issue                    | Same goods, new location. Net zero              |
| `consume`                      | Receipt                  | The issued material is used up at the processor |
| `produce`                      | Receipt                  | A new item exists, in a new lot, at your godown |
| `receipt` / `opening`          | Purchase / opening stock | Stock enters the books from outside             |
| `reversal`                     | Cancellation             | The opposite of a posted row. Never a delete    |

---

## 8. Statuses are derived, never set

Both `job_orders.status` and `job_order_steps.status` are recomputed from the documents underneath
them. The API refuses to accept either — a list page saying "completed" beside an overview that adds
up the receipts and disagrees is worse than no status at all.

| Step status          | Means                                                              |
| -------------------- | ------------------------------------------------------------------ |
| `pending`            | Nothing issued yet                                                 |
| `issued`             | Material is out; nothing accounted for yet                         |
| `partially_received` | Some items back, some still at the processor                       |
| `completed`          | **Every item** issued has been fully accounted for                 |
| `short_closed`       | A human decision: finished, and the numbers do not balance. Sticky |

🔴 **Completion is judged per item, on the input side** — consumed against issued, never received
against issued. Both are in the input's own unit, so the comparison means something on every step.
Judging by what came back would work for dyeing (metres in, metres out) and be nonsense for cutting,
where a perfectly finished step would sit at `partially_received` forever because 2,880 is less than
4,950.

The order rolls up from its steps: `draft` until the first issue, then `in_progress`, then
`completed`. `short_closed` and `cancelled` are **sticky** — once set, the roll-up returns early and
the label never changes on its own.

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
| `job_issue_lines` | 1    | Grey Fabric, lot `LOT-0088`, 5,000 M                      |

| Movement       | Lot        | Location      |    Qty |     Value |
| -------------- | ---------- | ------------- | -----: | --------: |
| `transfer_out` | `LOT-0088` | Main Godown   | −5,000 | −₹250,000 |
| `transfer_in`  | `LOT-0088` | Sunrise Dyers | +5,000 | +₹250,000 |

Step 1's status flips to `issued`. Step 2 is still blocked — nothing has come back from step 1, so
there is physically nothing to cut.

### Day 9 — the dyer returns 4,950 M

Of which 4,900 accepted, 30 rework, 20 scrap.

| Table                 | Rows | Contents                                                                        |
| --------------------- | ---- | ------------------------------------------------------------------------------- |
| `job_receipts`        | 1    | `RC-0019` · received 4,950 · accepted 4,900 · rework 30 · scrap 20              |
| `job_receipt_lines`   | 1    | Closes issue line from `JI-0031` · `issuedQty` 5,000                            |
| `job_receipt_outputs` | 1    | Dyed Fabric · `isPrimary` · the four buckets                                    |
| `lots`                | 2    | `LOT-0091` accepted · `LOT-0092` rework — both with `parentLotIds = [LOT-0088]` |

| Movement  | Lot        | Location      |    Qty | Note                  |
| --------- | ---------- | ------------- | -----: | --------------------- |
| `consume` | `LOT-0088` | Sunrise Dyers | −5,000 | The grey is used up   |
| `produce` | `LOT-0091` | Main Godown   | +4,900 | Accepted dyed fabric  |
| `produce` | `LOT-0092` | Main Godown   |    +30 | Rework, kept separate |

The missing 50 metres never appear as a row — they are **issued minus received**, which is exactly
how wastage is reported. Step 1 becomes `completed`; step 2 unblocks; the order moves to
`in_progress`.

**Where the balance stands:**

```
Grey Fabric @ Main Godown      0
Dyed Fabric @ Main Godown  4,930   (4,900 good + 30 rework)
```

---

## 10. What will bite you

### 10.1 Editing is allowed only past the work front

A running order is editable — but only _past the last step that has a live challan or receipt_.
Everything at or behind that line is frozen, **including untouched steps sitting between two started
ones**, because removing one would renumber the started steps after it and their numbers are printed
on paperwork.

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

Repeatedly and deliberately. `tolerancePct = null` means "nothing set, inherit"; `0` means "no
tolerance whatsoever". `rate = 0` means free of charge, not unpriced. Every inheritance in this
module uses `??`, never `||`, for exactly this reason.

### 10.4 A soft-deleted row still holds its unique key

Deleting "Dyeing" does not free the name — which is why creating it again **revives** the old row
rather than failing. The same reasoning is why step `seq` values are hard-deleted rather than soft: a
removed step would otherwise hold its number forever.

### 10.5 Stock availability is currently not enforced

⚠️ The issue screen will presently create a **zero-valued lot** for an item with no stock on record.
This is temporary scaffolding from before Purchase Received existed — without it there would be no
way to put stock on the books at all and the whole loop would be untestable. The chain guard (§5.3)
is deliberately _not_ relaxed alongside it: raw material can be conjured while Purchase Received is
missing, work in progress cannot.

🔴 Restore the `availableQty > 0` check the day Purchase Received lands. Until then the issue screen
tells you what _should_ be there rather than what is.
