# Jobwork UI — Field-by-Field Data Sources

**Companion to** `JOBWORK_DOMAIN_AND_MODULE_MAP.md` §8. That document says _what the screens are_.
This one answers a single question for every field on every screen:

> **Where does this value come from?**

Nothing here changes the design in that document — it expands §8 only.

**Status:** design, pre-schema. Table and column names are proposals, not existing objects.

---

## 1. How to read this document

Every field is tagged with exactly one source type. The tag is the answer to "where does it come
from"; the notes column is the answer to "and under what filter".

| Tag           | Source                                       | Rule of thumb                                                               |
| ------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| **`AUTO`**    | System-generated                             | `NumberSequence` — never typed, never sent by the client                    |
| **`CTX`**     | Request context                              | `req.tenantId`, `req.user.id`, server date. **Never** from the request body |
| **`MASTER`**  | A master table                               | Always with a filter — a lookup with no filter is a bug (§2.3)              |
| **`INHERIT`** | Copied from the parent document at open time | Locked or pre-filled — the notes say which                                  |
| **`SNAP`**    | Snapshotted at save time                     | Frozen copy. Reprinting an old document must not show today's data (§2.4)   |
| **`LEDGER`**  | A query over the Stock Ledger                | Availability is **always** computed, never a stored column                  |
| **`CALC`**    | Computed on screen                           | Not persisted. Re-derived on every render                                   |
| **`CALC+`**   | Computed **and** persisted                   | Only where the note justifies it                                            |
| **`INPUT`**   | Typed by the user                            | The only tag that means "free"                                              |
| **`CF`**      | Per-org custom field                         | From `custom_field_definitions` where `entityType` matches                  |

### 1.1 The three questions this document exists to answer

1. **Which table does the dropdown read?** — and with what `WHERE` clause.
2. **Is it a live reference or a frozen copy?** — see §2.4, it is the most commonly-wrong answer.
3. **What must already exist before this screen can open?** — see §9.

---

## 2. Rules that apply to every screen

Read this section once; the per-screen tables assume it.

### 2.1 Fields present on every document, never on any form

These four never appear in the UI and never come from the client:

| Field                     | Source | Note                                                                                            |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `organizationId`          | `CTX`  | `req.tenantId` — set by `tenantContext` after checking membership. **Never** `req.params.orgId` |
| `createdBy` / `updatedBy` | `CTX`  | `req.user.id`. Omit from the input type entirely so the client cannot send them                 |
| `createdAt` / `updatedAt` | `CTX`  | Database defaults                                                                               |
| `isDeleted`               | `CTX`  | Always `false` on create; a "delete" is an update                                               |

### 2.2 Document numbers — generate on **save**, not on open

Every `AUTO` number comes from `NumberSequence` (`entityType` + `prefix` + `nextNumber`, already
built, org-scoped).

🔴 **Allocate the number inside the save transaction, not when the dialog opens.** If it is allocated
on open, every abandoned dialog burns a number and the sequence develops gaps — which for a GST tax
invoice is a compliance problem, not an annoyance. Show `(auto)` in the field until save.

New `entityType` values needed: `job_order` · `job_issue` · `job_receipt` · `purchase_receipt` · `lot` ·
`delivery_challan` · `sales_invoice` · `stock_transfer` · `stock_adjustment` · `jobwork_bill`.

**Lot numbers** draw from this same mechanism, org-global. **Lot unit numbers do not** — they are a
counter inside their parent lot, restarting at 1 (`LOT-00012/1 … /50`). See the parent doc §5.2.2.

### 2.3 Every `MASTER` lookup carries a filter

An unfiltered dropdown is the most common defect in this kind of screen. The minimum on every one:

```
WHERE organization_id = :tenantId      -- plus runAsTenant
  AND is_deleted = false
```

…and then the domain filter, which is what actually matters:

| Lookup             | Domain filter                                         |
| ------------------ | ----------------------------------------------------- |
| Processor          | `vendorTypes @> ['job_worker'] AND status = 'active'` |
| Broker             | `vendorTypes @> ['broker']`                           |
| Transporter        | `vendorTypes @> ['transporter']`                      |
| Material supplier  | `vendorTypes @> ['material_supplier']`                |
| Source location    | `type IN ('godown','shopfloor')`                      |
| Processor location | `type = 'processor' AND vendorId = :selectedVendor`   |
| Item (issue)       | `isDeleted = false AND isActive = true`               |
| UoM                | org's UoM list                                        |

**Soft-deleted rows must not appear in a picker but must still render on documents that already
reference them.** A vendor deleted today cannot be chosen on a new challan, and must still show its
name on last year's challan. That is what `SNAP` (§2.4) is for.

### 2.4 Live reference vs snapshot — decide per field

The single most-commonly-wrong call on document screens.

|                         | Live reference (`MASTER`)                       | Snapshot (`SNAP`)              |
| ----------------------- | ----------------------------------------------- | ------------------------------ |
| Stored                  | Foreign key only                                | Copy of the value at save time |
| When the master changes | The document changes too                        | The document does not move     |
| Use for                 | Anything you navigate to, join on, or report by | **Anything printed**           |

**Rule: store both.** Keep the FK for joins and reporting, and freeze a copy of what was printed.

- `vendorId` **and** `vendorNameSnapshot`, `vendorAddressSnapshot`, `vendorGstinSnapshot`
- `itemId` **and** `itemNameSnapshot`
- `routeId` **and** `routeNameSnapshot`

Why it matters concretely: Sunrise Dyers moves premises in October. Reprinting August's challan must
show the **August** address — the goods went there, and a GST officer comparing the challan with the
e-way bill will see a mismatch otherwise.

🔴 **A `JobOrderStep` is a full snapshot of a Route step, not a live link.** Editing a route must
never rewrite job orders already running against it. The route supplies defaults **once**, at job
order creation, and is never read again.

### 2.5 The default chain

Many fields have four possible sources and take the first one that is set. Documenting the chain once
here means the per-screen tables can just say "default chain".

```
Process master  →  Route step  →  Job Order step  →  the document
   (org-wide)      (per route)     (per job order)     (per issue/receipt)
   broadest                                            most specific — wins
```

Fields that use it: `rate` · `rateBasis` · `tolerancePct` · `issueItemId` · `issueUomId` ·
`receiveItemId` · `receiveUomId` · `expectedYield` · `processorId`.

Each level is **copied down**, not referenced up, so a later edit to the Process master does not
alter a job order already released. `Item.defaultTolerancePct` sits below the Process master as a
final fallback when the process itself declares none.

🔴 **The two unit fields do not start at the Process master.** `Process.defaultIssueUomId` /
`defaultReceiveUomId` were removed on 2026-08-10. A step transacts in its **items' stocking units**
(domain §5.1) — one item has exactly one stocking unit, and `postMovement` writes the _lot's_ unit
into the ledger whatever the document says — so an org-wide default on the operation master was a
guess about one item, and applying it is precisely what let a challan and the ledger describe a
single movement in two different units with nothing erroring. `issueUomId` / `receiveUomId` now
resolve as **item stocking uom → the step's own value → null**; a null is refused where it matters
(the Issue dialog), which is louder than a plausible wrong unit. Transacting in a unit other than
the item's is a real requirement, but it needs `ItemUomConversion`, which does not exist yet.

### 2.6 Custom fields (`CF`)

Every **document** screen ends with a custom-fields block. Source is always:

```
custom_field_definitions
WHERE organizationId = :tenantId AND entityType = '<module>' AND isActive = true AND isDeleted = false
ORDER BY sortIndex
```

Validated through `customFields.engine.ts` inside the **same** `runAsTenant` transaction as the write.
This is where the mind map's _"may be required some extra fields at time of issue — lot-wise pcs,
cutper, meter"_ lands. Those must **not** become hardcoded columns.

New `entityType` values: `job_order` · `job_issue` · `job_receipt` · `purchase_receipt` · `lot` ·
`delivery_challan`.

🔴 **The two jobwork MASTERS have no custom-fields block** — `process` and `process_route` both left
`ENTITY_TYPES` on 2026-08-10. They are set up once and rarely revisited, so the section was one
nobody filled in; the per-run detail an org actually wants to record belongs on the documents above,
which is where the mind map's "lot-wise pcs, cutper, meter" already lands. Both tables keep their
`custom_fields` columns and whatever those already hold — nothing reads or writes them now, and
neither module is offered in Settings → Modules. Their lists still get Customize Columns through
`LIST_ONLY_ENTITY_TYPES` (`listViews.catalog.ts`).

---

## 3. §8.1 Navigation — where the sidebar comes from

| Element                                                 | Tag      | Source                                                                                                          |
| ------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| Main module list (Purchases, Jobwork, Sales, Inventory) | `MASTER` | `app_modules` where `parentId IS NULL AND isActive`, ordered by `sortIndex`. Global table, not per-org          |
| Sub-module list                                         | `MASTER` | `app_modules` where `parentId = :moduleId`                                                                      |
| **Which entries actually render**                       | `CALC`   | Intersected with the caller's resolved permission set — an entry shows only if the user holds `<resource>:read` |
| Org name / logo in the header                           | `MASTER` | `organizations` via `req.tenantId`                                                                              |
| Org switcher list                                       | `MASTER` | `memberships` where `userId = :caller AND isDeleted = false`, joined to non-deleted orgs                        |

**The permission set is resolved once per request** by `tenantContext` (owner → all permissions;
otherwise the membership's permission template). The sidebar filters against that same set the routes
enforce — so a hidden menu item and a 403 always agree.

---

## 4. §8.2 Job Order

§8 shows the Overview page, which is post-save. The create form is covered first because it is where
most of the Overview's data originates.

### 4.1 Create form — header

| Field                                                          | Tag                 | Source and filter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job Order Number                                               | `AUTO`              | `NumberSequence('job_order')`. `(auto)` until save                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Date                                                           | `CTX`               | Server date in the org's timezone. Editable; not before the org's book-close date                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ~~Input Item~~ · ~~Input UoM~~ · ~~Input Qty~~ · ~~Available~~ | `CALC+`             | 🔴 **Gone from the form, 2026-08-07.** A step consumes a SET of items (domain §5.7), so one item and one quantity on the document that owns all of them could only ever name one — and it would be the field everybody then trusted. What the order runs on is **step 1's CONSUMES list** (§4.2). `job_orders.input_item_id` / `input_qty` survive as stored projections of that list's first row, for the list page; they are nullable, never sent by a client, and never read to decide anything |
| ~~Material In~~                                                | —                   | 🔴 **Gone from the form, 2026-08-07.** Stock comes from Purchase Received and Opening Stock (`PURCHASE_RECEIVED_AND_ITEMS_SPEC.md` §D3). Until those ship, a job order is a plan and there may be nothing to issue against it — see `JOBWORK_IMPLEMENTATION_PLAN.md` §12.6                                                                                                                                                                                                                         |
| Route                                                          | `MASTER`            | `routes` where `isActive`. **Default:** `Item.defaultRouteId` if set (the mind map's "auto-selected based on item"), else blank for manual pick                                                                                                                                                                                                                                                                                                                                                    |
| Route name snapshot                                            | `SNAP`              | Frozen at save (§2.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Ownership                                                      | `INHERIT` / `INPUT` | `own` by default. Set to `customer` + `ownerPartyId` for inward jobwork (shape D). **Determines everything downstream** — valuation, invoice type, which lots may be issued                                                                                                                                                                                                                                                                                                                        |
| Source Sales Order                                             | `MASTER`            | `sales_orders` where `status IN ('open','partially_delivered')` and, if a customer is set, that customer's. **Optional** — never required                                                                                                                                                                                                                                                                                                                                                          |
| Target date                                                    | `INPUT`             | Defaults to the SO's delivery date when one is linked                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Custom fields                                                  | `CF`                | `entityType = 'job_order'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### 4.2 Create form — the steps grid

The grid is **populated by the route**, then freely editable. A job order with no route starts empty
and the user adds rows by hand — the parent doc's "fully flexible" requirement.

| Column                  | Tag       | Source                                                                                                                                                                                                                                                                      |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seq                     | `AUTO`    | Row position, renumbered on drag                                                                                                                                                                                                                                            |
| Process                 | `MASTER`  | `processes` where `isActive`. Pre-filled from the route step                                                                                                                                                                                                                |
| Processor type          | `INHERIT` | `vendor` \| `customer` \| `internal`, from the route step                                                                                                                                                                                                                   |
| Processor               | `MASTER`  | Filtered by processor type: job-worker vendors, or customers with `isJobworkParty`, or hidden entirely when `internal`                                                                                                                                                      |
| Work centre             | `MASTER`  | Only when `internal` — `locations` where `type = 'work_centre'`                                                                                                                                                                                                             |
| Rate                    | `INHERIT` | Default chain (§2.5). Editable                                                                                                                                                                                                                                              |
| Rate basis              | `INHERIT` | Default chain. **No safe default** — a dyer bills received, in-house cutting bills issued                                                                                                                                                                                   |
| **Consumes** (a list)   | `INPUT`   | One row per item the step consumes. Copied from the route step when one is picked, and typed otherwise. 🔴 **What is typed is what is saved** — see §4.2.2                                                                                                                  |
| **Produces** (a list)   | `INPUT`   | One row per item the step produces. Same rule                                                                                                                                                                                                                               |
| ~~Expected yield~~      | —         | 🔴 **Gone from the form, 2026-08-07.** One ratio cannot relate three inputs to two outputs, and every output already carries its own expected quantity, which says the same thing without implying a conversion (§5.1). The column survives and is still honoured when sent |
| Tolerance % — all items | `INHERIT` | Default chain. Any input row may override it on itself (§4.2.1)                                                                                                                                                                                                             |

#### 4.2.1 The input and output rows

| Column       | Tag       | Source                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item         | `MASTER`  | `items` where `isActive AND NOT isDeleted`. Every row is freely chosen — there is no locked row any more, because the header no longer names an item (§4.1)                                                                                                                                                                                                                        |
| UoM          | `INHERIT` | 🔴 `Item.stockingUomId`, **forced, never chosen**. One item, one stocking unit (§5.1) — and the ledger records the LOT's unit whatever a document says, so a unit that disagrees with the item makes the challan and the ledger describe one movement two ways                                                                                                                     |
| Planned qty  | `INPUT`   | Per input item, in that item's unit. **Pre-filled from the route step's own quantity when a route is picked** (§4.2.3), then blank takes whatever the steps above have LEFT of that item — netted, so two steps drawing on one output do not each get all of it; an item drawn from stock with no route default stays blank. Exceeding that remainder warns, never blocks (§6.4.0) |
| Tolerance %  | `INPUT`   | Inputs only. Blank falls through to the step's, **shown greyed in the box** so an empty field stops reading as "no tolerance". Fabric at 3% beside thread at 25% — one percentage across three items is either too tight for one or meaningless for another                                                                                                                        |
| Expected qty | `INPUT`   | Per output item. Blank is fine — the receipt is what says what actually came back. The **primary** output shows what will be stored if left blank, greyed (§4.2.4); a blank placeholder means nothing will be stored and the box is genuinely asking                                                                                                                               |
| Primary      | `CALC`    | Outputs only. 🔴 **No longer asked** (2026-08-10) — the radio decided nothing in the common case, one item back. It is the FIRST output row, which is the server's own fallback (`flagPrimaryOutput`); a row already flagged in saved data keeps its flag                                                                                                                          |
| From stock   | `CALC+`   | Inputs only. `true` when no earlier step produces this item, so it is drawn from stock. Computed at save and stored, so the Overview can label it without re-walking the chain                                                                                                                                                                                                     |

🔴 **Validation across rows is a CLASSIFICATION, not a rejection** (domain §6.4). An input no
earlier step produces is labelled _"from stock"_ and saved — thread and buttons legitimately come
from the godown, not from the operation above. **Step order is not checked at all** (2026-08-11): an
input produced only by a later step is labelled _"from stock"_ too, where it used to be refused with
_"reorder the steps"_.

🔴 **Nothing replaced it as a refusal** (domain §6.4.0). Planning **more of an item than the steps
above expect to produce** raises an amber note under the row, live as it is typed, and the save goes
through — the difference can legitimately come from stock, which is exactly the mixed supply a single
`fromStock` flag cannot express. A from-stock row says nothing, and neither does one whose producer
left its expected quantity blank. The note is `overPlanWarning`; the balance it reads is the same one
the server walks to fill in the blank rows.

What the old hard rule protected against — an empty lot picker days later — now surfaces at issue
time, per item, on the screen where someone can act on it. There is one hard rule left at issue time
and it is new: **a step cannot issue until the step before it has returned something** (domain
§6.4.1).

#### 4.2.3 The route's default quantities (2026-08-10)

`route_step_inputs.planned_qty` was in the data model from Sprint 2 (plan §4, row 2) and never built;
it exists now, and it is the **consumed side only**.

|                         |                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What the number means   | The amount this org usually puts through the step — "5,000 M grey, 12 CONE thread". A **default**, nothing more                                                                                                                |
| What it is **not**      | 🔴 Consumption per unit of output. Scaling it by an order quantity needs a ratio between 2,910 PCS and 80 KG, and no conversion exists anywhere in this system (§5.1). Nothing multiplies it, ever                             |
| How it reaches an order | Copied once into `job_order_step_inputs.planned_qty` when the route is picked, then owned by the order (§2.4). Editing the route afterwards cannot reach an order already created — pinned by a test in `jobwork.flow.test.ts` |
| Why PRODUCES has none   | What comes back is a per-run answer. A template that guessed it would put a number on the receipt screen nobody had reason to believe. The job order derives the primary output's expected qty where it can — see §4.2.4       |
| Why no tolerance on it  | Same reason. How far over a step may run is a decision about a real run                                                                                                                                                        |

#### 4.2.4 Greyed placeholders, not pre-filled values (2026-08-12)

Two boxes on the steps grid mean something when left blank, and an empty box said the opposite of
what it did. Both now show the value that will actually be stored, **greyed inside the box**:

| Box                               | What blank means                                                   |
| --------------------------------- | ------------------------------------------------------------------ |
| **Tolerance %** (per input)       | Falls through to the step's — so the step's figure is shown greyed |
| **Expected qty** (primary output) | The server derives it — so the derived figure is shown greyed      |

🔴 **A placeholder, never a value written into the row.** A copied value freezes at the moment it is
made: change the step tolerance afterwards and the rows would hold stale numbers that nothing could
tell apart from ones somebody typed deliberately. The placeholder stays live and typing overrides it.

🔴 **The expected quantity is derived only where there is a basis** (`derivedExpectedQty`, mirrored
client and server). Two things count, and nothing else does:

- **A stated `expectedYield`** — somebody typed the ratio, so it answers across units: 0.6 turns
  4,800 M into 2,880 PCS.
- **The same unit on both sides** — dyeing takes metres and returns metres. 1:1 is honest.

Otherwise **no placeholder and nothing stored**, which is the cutting case: metres in, pieces out,
no ratio anywhere in the system (§5.1). It used to store `plannedQty × 1` — 4,800 PCS of panels from
4,800 M of fabric — and that invented figure became the next step's planned input, which is the base
its **tolerance ceiling** is computed from. An empty box on exactly that row is the point: it is the
one number the system genuinely cannot know.

#### 4.2.2 🔴 What is typed is what is saved

_(Added 2026-08-07.)_

The service infers nothing about these two lists any more. It used to: an empty CONSUMES list took
the step above's main output, and an empty PRODUCES list took a copy of the input back whenever the
process was not flagged as changing the item.

Both read well on paper and were unusable on screen. The grid had to render a row nobody had typed,
labelled _"automatic"_, and the honest question that produced was **"so what actually goes into the
database?"** — which is not a question a form should leave anyone asking.

The client seeds those rows **visibly** instead, at the moment somebody can see them:

- **Add step** puts the previous step's main output in as its first CONSUMES row.
- **Picking a process** that does not change the item puts the input item into PRODUCES as the main
  output — only while PRODUCES is still empty; an existing list is the user's and is never rewritten.

An empty list now means an empty list, and the grid says so in words rather than showing a chip.

### 4.3 Overview page — header strip

| Element                    | Tag      | Source                                                                                                           |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| JO number, date, item, qty | `MASTER` | The `job_orders` row                                                                                             |
| Route name                 | `SNAP`   | The frozen copy, not a join to `routes`                                                                          |
| SO link                    | `MASTER` | Join to `sales_orders` for the number and customer name                                                          |
| Status badge               | `CALC+`  | Stored, but only ever written by the service that recomputes it from step balances. Never set directly by a user |
| **ISSUED** tile            | `CALC`   | `SUM(job_issue_lines.qty)` for step 1                                                                            |
| **IN HAND** tile           | `LEDGER` | Current balance of this job order's lots, all locations                                                          |
| **WASTAGE %** tile         | `CALC`   | `(totalIssued − totalReceived − returned) ÷ totalIssued` across closed steps                                     |
| **COST / unit** tile       | `CALC`   | Accumulated lot value ÷ current qty in the current unit. Derived every time — never stored (parent doc §9.1)     |

### 4.4 Overview page — the step stepper

| Element                      | Tag      | Source                                                                                                                                                                                       |
| ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process name, processor      | `SNAP`   | The `job_order_steps` row                                                                                                                                                                    |
| Step status                  | `CALC+`  | From issued vs received balances                                                                                                                                                             |
| `In item qty → Out item qty` | `CALC`   | Issued from `job_issue_lines`; received from `job_receipt_lines` where `disposition = 'accepted'`                                                                                            |
| Wastage + tolerance verdict  | `CALC`   | Against `step.tolerancePct`                                                                                                                                                                  |
| Rate × qty = amount          | `CALC`   | Which qty depends on `step.rateBasis`                                                                                                                                                        |
| "2 issues · 3 receipts"      | `CALC`   | `COUNT` over the two child tables                                                                                                                                                            |
| ⚠ rework banner              | `CALC`   | `EXISTS` a receipt line with `disposition = 'rework'` and no closing issue                                                                                                                   |
| **`[+ Issue]` enabled?**     | `LEDGER` | Enabled when the step's **issue item** has a positive balance at a permitted location **with matching ownership**. Disabled with the reason shown ("no stock of Dyed Fabric at Main Godown") |
| **`[+ Receive]` visible?**   | `CALC`   | Visible once ≥1 issue exists against the step with an open balance                                                                                                                           |

---

## 5. §8.3 The Issue dialog

The screen the user asked about. Every field, in order.

### 5.1 Header

| Field                            | Tag       | Source and filter                                                                                                                                                                                                              |
| -------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Challan Number                   | `AUTO`    | `NumberSequence('job_issue')`, allocated in the save transaction (§2.2)                                                                                                                                                        |
| Date                             | `CTX`     | Server date. **Must be ≥ the job order date** and ≥ the last movement on the lots being issued — you cannot back-date a movement behind stock that did not yet exist                                                           |
| Job Order                        | `INHERIT` | **Locked.** From the page context                                                                                                                                                                                              |
| Step                             | `INHERIT` | **Locked.** The step whose `[+ Issue]` was clicked                                                                                                                                                                             |
| Process name                     | `SNAP`    | `step.processNameSnapshot`. Display only                                                                                                                                                                                       |
| `isRework` / `attemptNo`         | `INHERIT` | `false` / `1` for a normal issue. Set to `true` / `n+1` when launched from a receipt's rework line                                                                                                                             |
| Processor                        | `MASTER`  | Default `step.processorId`. Filter: `vendorTypes @> ['job_worker'] AND status='active' AND NOT isDeleted`. Hidden when `processorType = 'internal'`                                                                            |
| **Source location**              | `LEDGER`  | The locations that actually hold the step's issue item, with their balances. Auto-selected when only one qualifies. This is a **ledger query, not a location list** — offering a location with no stock is how users get stuck |
| **Destination location**         | `CALC`    | Derived from the processor: `locations` where `vendorId = :processor AND type = 'processor'`. **Auto-created on first use** if absent. Read-only. When `internal`, this is the step's work centre instead                      |
| ~~Issue Item / UoM~~             | —         | **Gone from the header.** A challan carries several items now (domain §5.7), so the item moved down to the line. The dialog renders one collapsible section per `job_order_step_inputs` row, each holding its own lot picker   |
| Remarks                          | `INPUT`   | One free-text note, in the header grid. Printed on the challan and shown on the issue detail                                                                                                                                   |
| ~~Transporter~~                  | —         | **Gone 2026-08-10.** `transporter_id` survives as an unused column; no screen ever offered a picker for it                                                                                                                     |
| ~~Vehicle no · LR no · LR date~~ | —         | **Gone 2026-08-10** — see below                                                                                                                                                                                                |
| ~~E-way bill no~~                | —         | **Gone 2026-08-10** — see below                                                                                                                                                                                                |
| ~~Custom fields~~                | —         | **Gone 2026-08-10.** `job_issue` is no longer a custom-field module                                                                                                                                                            |

⚠️ **The Transport section and the Additional fields section were both removed on 2026-08-10, end to
end.** `vehicle_no`, `lr_no`, `lr_date` and `eway_bill_no` were **dropped from `job_issues`**
(`migrations/20260810115248_remove_job_issue_transport_columns`), so the printed challan no longer
carries a transport strip and existing challans reprint without those details. The two list columns
(Vehicle No, E-way Bill) and the two search columns went with them. Restoring any of it means
restoring the columns first — the markup alone is not enough.

`job_issue` moved out of `ENTITY_TYPES` and into `LIST_ONLY_ENTITY_TYPES`, the same treatment
`process` and `process_route` got on the same day: the `custom_fields` column stays with whatever it
already holds, the Issues list keeps Customize Columns, but the module is no longer offered in
Settings → Modules and no `cf:` columns merge into its list. It was the one place "lot-wise pcs /
cutper / meter" was meant to land (§2.6) — that need now has no home, which is worth remembering if
it comes back.

### 5.2 The lot picker — the core query

**This is the answer to "where do the Lot and Taka numbers come from".** They are not a master list.
They are the result of an availability query over the Stock Ledger, and nothing else.

**The query runs once per input item** — the dialog has one section per `job_order_step_inputs` row
(domain §5.7), and each section runs this with its own `:itemId`.

```sql
-- Lots available to issue for ONE of the step's input items
SELECT  l.id, l.lot_number, l.supplier_lot_ref, l.accumulated_value,
        l.created_at,
        SUM(sl.qty_in - sl.qty_out) AS available_qty
FROM    stock_ledger sl
JOIN    lots l ON l.id = sl.lot_id
WHERE   sl.organization_id = :tenantId
  AND   sl.item_id         = :stepInput.itemId      -- ← one section per input row
  AND   sl.location_id     = :selectedSourceLocation
  AND   sl.ownership       = :jobOrder.ownership    -- ← 🔴 own vs customer must match
  AND   sl.owner_party_id  IS NOT DISTINCT FROM :jobOrder.ownerPartyId
  AND   l.is_deleted       = false
GROUP BY l.id
HAVING  SUM(sl.qty_in - sl.qty_out) > 0
ORDER BY l.created_at;                              -- FIFO suggestion
```

| Column shown                  | Tag       | Source                                                |
| ----------------------------- | --------- | ----------------------------------------------------- |
| Lot number                    | `MASTER`  | `lots.lot_number`                                     |
| **Available qty**             | `LEDGER`  | The `SUM` above. 🔴 **Never a stored balance column** |
| UoM                           | `INHERIT` | `Item.stockingUomId` — identical on every row         |
| Cost / unit                   | `CALC`    | `accumulated_value ÷ available_qty`                   |
| Qty to issue                  | `INPUT`   | Validated `≤ available_qty`                           |
| ~~Supplier / heat / tag ref~~ | —         | **Removed 2026-08-10** — see below                    |
| ~~Age (days)~~                | —         | **Removed 2026-08-10** — see below                    |

⚠️ **Supplier ref and age are no longer in this payload (2026-08-10).** Both were columns the picker
printed and nothing read — no rule, no sort, no validation depended on either. `getAvailableStock`
therefore stops returning `supplierLotRef` and `ageDays` altogether. `lots.supplier_lot_ref` is
untouched and still shown on the Lots list, the job order overview and the printed challan; age had
no other reader. The day a FIFO suggestion or the 180-day GST clock needs age, compute it in
`lots.service.ts` — one implementation, server side — never on the client.

🔴 **The `ownership` filter is not optional.** Without it, a customer's goods held under one inward
jobwork order can be issued into another customer's job order — you would be processing A's material
on B's order and both stock reports would be wrong. This is the same class of failure as a missing
tenant filter.

### 5.3 The taka (lot unit) expansion

> ⚠️ **SWITCHED OFF, 2026-08-07 — not decided against.** Issue and receive are both LOT level:
> material moves as a quantity against the lot and no screen names an individual taka. The code below
> is intact and unreachable behind two named switches — `mode = 'bulk'` in `jobReceipts.service.ts`
> and `PACKAGE_LEVEL` in the web `LotPicker` — plus `lotPackageId: null` in `jobIssues.service.ts`.
>
> 🔴 The cost, stated plainly: **while it is off, nothing records which returned roll came from which
> issued roll, and that cannot be reconstructed afterwards.** Lot-level genealogy through
> `parentLotIds` is unaffected. See `JOBWORK_IMPLEMENTATION_PLAN.md` §12.5.

Shown only when `Item.lotTracking = 'lot_and_unit'`. Expanding a lot row runs:

```sql
SELECT id, unit_number, qty, uom_id
FROM   lot_units
WHERE  lot_id = :lotId
  AND  state  = 'available'      -- not already issued, consumed or dispatched
  AND  is_deleted = false
ORDER BY unit_number;
```

| Column       | Tag      | Source                                                                                             |
| ------------ | -------- | -------------------------------------------------------------------------------------------------- |
| Taka number  | `MASTER` | `lot_units.unit_number`, rendered `LOT-00012/7`                                                    |
| Qty (metres) | `MASTER` | `lot_units.qty` — the **measured** figure captured at Purchase Received, which is why no two match |
| Select       | `INPUT`  | A checkbox, not a qty box: **ticking takes the unit's full measured quantity**                     |

The label on the column ("Taka", "Roll", "Bale", "Coil") is `MASTER` from the org's configured lot-unit
label — the word is per-org, the table is not.

### 5.4 Running totals and guards

🔴 **Every one of these is PER INPUT ITEM.** There is deliberately no grand total across the
challan: metres plus cones plus pieces is a number with no unit, and printing it would be worse than
printing nothing (domain §8.3).

| Element               | Tag      | Computation                                                                                                                                                                                                                                                                                                             |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selected units        | `CALC`   | Count of ticked lot units, for this item                                                                                                                                                                                                                                                                                |
| Selected qty          | `CALC`   | Sum of ticked units, or typed lot quantities, for this item                                                                                                                                                                                                                                                             |
| Already issued        | `CALC`   | `SUM(job_issue_lines.qty)` for this step **and this item**, excluding this draft                                                                                                                                                                                                                                        |
| Remaining to issue    | `CALC`   | `stepInput.plannedQty − alreadyIssued − selectedQty`                                                                                                                                                                                                                                                                    |
| **Tolerance ceiling** | `CALC`   | `stepInput.plannedQty × (1 + step.tolerancePct ÷ 100)`. Over it → block, or require an override reason + approver. Never silently allow                                                                                                                                                                                 |
| **Single-lot guard**  | `MASTER` | `Process.requiresSingleLot`. When true, selecting a second lot **of the same item** is blocked with the reason shown — shade variation is invisible until the garment is assembled. It constrains one item, never the challan: two dye lots of one fabric is the defect, fabric plus thread is just a bill of materials |
| **Partial challan**   | —        | 🔴 **Legal, and must stay legal.** Fabric goes today, buttons follow tomorrow. The step stays `partially_received` until every item is accounted for (domain §6.5), so nothing is lost by allowing it                                                                                                                   |

### 5.5 What the save writes

| Written                              | Source                                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job_issues` header                  | The form + `CTX` + `AUTO` number. **No `itemId` and no `totalQty`** — see below                                                                                                  |
| `job_issue_lines`                    | One row per selected lot / lot unit, with `itemId`, `uomId`, `lotId`, `lotUnitId`, `qty`                                                                                         |
| **Stock Ledger — two rows per line** | `−qty` at source location, `+qty` at destination. Ownership and lot copied unchanged. `postMovement` takes the item from the LOT, so the ledger needed no change for any of this |
| `lot_units.state`                    | → `with_processor`                                                                                                                                                               |
| `job_order_steps.status`             | Recomputed → `issued` / `partially_received`, per input item (domain §6.5)                                                                                                       |
| Challan PDF                          | Rendered from the header + lines + the `SNAP` party fields. **A block per item**, each with its own unit and its own total                                                       |

🔴 **`job_issues.totalQty` is gone, not repurposed.** Summed across three items it was 2,910 + 12 +
8,700 = 11,622 of nothing — a number with no unit, read by the status computation, the list page and
the challan. Per-item totals are derived from the lines; the list page shows `3 items` and the detail
expands them. Keeping it as "the first item's quantity" would look right on single-item challans and
be silently wrong on the rest, which is the worst of both.

---

## 6. §8.4 The Receive dialog

### 6.1 Header

| Field                          | Tag       | Source and filter                                                                                                                                                      |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipt Number                 | `AUTO`    | `NumberSequence('job_receipt')`                                                                                                                                        |
| Date                           | `CTX`     | Server date. **Must be ≥ the date of every issue it closes**                                                                                                           |
| Issue reference (multi-select) | `MASTER`  | `job_issues` where `jobOrderStepId = :step AND status IN ('issued','partially_returned') AND NOT isDeleted`. Multi-select because one receipt may close several issues |
| Processor                      | `INHERIT` | From the selected issues. Locked — receiving from a different processor than you issued to is a transfer, not a receipt                                                |
| **Mode (unit-wise / bulk)**    | `MASTER`  | 🔴 **Not a user preference.** `Process.preservesPackaging` decides it. Dyeing returns the same roll → unit-wise; cutting destroys rolls → bulk only                    |
| ~~Output item / UoM~~          | —         | **Gone from the header.** A receipt returns several items now (domain §5.7), each with its own quantity and disposition split. They live in the Returned grid, §6.4    |
| Custom fields                  | `CF`      | `entityType = 'job_receipt'`                                                                                                                                           |

🔴 **Two grids, not one.** What was consumed and what came back are different items, in different
units, of different lengths — §6.2 is the consumed side, §6.4 the returned side. One table holding
both would leave half its columns blank on every row, and the two sum checks would have to skip rows
rather than add them up.

### 6.2 Consumed grid — unit-wise mode

> ⚠️ **SWITCHED OFF, 2026-08-07 — not decided against.** Issue and receive are both LOT level:
> material moves as a quantity against the lot and no screen names an individual taka. The code below
> is intact and unreachable behind two named switches — `mode = 'bulk'` in `jobReceipts.service.ts`
> and `PACKAGE_LEVEL` in the web `LotPicker` — plus `lotPackageId: null` in `jobIssues.service.ts`.
>
> 🔴 The cost, stated plainly: **while it is off, nothing records which returned roll came from which
> issued roll, and that cannot be reconstructed afterwards.** Lot-level genealogy through
> `parentLotIds` is unaffected. See `JOBWORK_IMPLEMENTATION_PLAN.md` §12.5.

**What the lot-level grid does instead:** one row per ITEM, carrying how much of that item this
receipt accounts for. Grouped per item rather than one total, because a bulk line that does not say
which item it settles makes the allocation walk every open challan line oldest-first — and settle a
panel receipt by consuming thread.

🔴 **The consumption record is written per resolved ALLOCATION, not per request row** (2026-08-07).
`allocateConsumption` works out which challan lines a receipt closes in order to post the ledger;
persisting that decision is what keeps `job_receipt_lines.jobIssueLineId` populated. It was null on
every lot-level row before, and every outstanding calculation in the module keys off that column — so
the prefill re-offered the full quantity forever, challans never reached `closed`, and the receipt
could not say which challans it had settled.

Rows are **not** entered by the user; they are generated from what was issued:

```sql
SELECT jil.id, jil.lot_id, jil.lot_unit_id, lu.unit_number, jil.qty AS issued_qty
FROM   job_issue_lines jil
JOIN   lot_units lu ON lu.id = jil.lot_unit_id
WHERE  jil.job_issue_id IN (:selectedIssueIds)
  AND  jil.is_deleted = false;
```

| Column            | Tag       | Source                                                                                                                                                   |
| ----------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item              | `INHERIT` | `job_issue_lines.itemId`. Rows are **grouped by item**, with a subtotal per group                                                                        |
| Taka number       | `MASTER`  | via `job_issue_lines.lotUnitId`                                                                                                                          |
| Issued qty        | `INHERIT` | `job_issue_lines.qty`. **Read-only**                                                                                                                     |
| Consumed qty      | `INPUT`   | The only typed column. How much of that line this receipt accounts for                                                                                   |
| Difference        | `CALC`    | `issued − consumed`                                                                                                                                      |
| Wastage %         | `CALC`    | `difference ÷ issued × 100`                                                                                                                              |
| `parentLotUnitId` | `CALC+`   | Persisted on the **output** row it produced — the 1:1 mapping that makes taka-level traceability possible. Cannot be reconstructed later from quantities |
| Group totals      | `CALC`    | Per item: total units · total issued · total consumed · total difference · total wastage %                                                               |

**Bulk mode** collapses each item's group to one row: total issued (`INHERIT`), total consumed
(`INPUT`), difference and wastage % (`CALC`).

### 6.3 Yield strip

> ⚠️ **Not built, 2026-08-07 — `expectedYield` is no longer asked for anywhere** (§4.2). With
> nothing to compare against, two of the three rows below have no value to show. The stored column
> is untouched, so this strip is a display away if the ratio is ever captured again.

| Element        | Tag       | Computation                                                                                               |
| -------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| Actual yield   | `CALC`    | `primaryOutput.receivedQty ÷ firstInput.consumedQty`, displayed with both units — `0.604 PCS/MTR`         |
| Expected yield | `INHERIT` | `step.expectedYield`                                                                                      |
| Variance       | `CALC`    | Highlighted past a threshold. 🔴 **Never used as a conversion factor** — it is an observation, not a rate |

Measured against the **primary** output and the **first** input. With several of each there is no
single ratio, and picking a pair to display is honest only because that pair is the one the plant
thinks in — panels per metre, not buttons per metre.

### 6.4 Returned grid — one row per item that came back

> ⚠️ **"Sent back" (`returnedQty`) is not asked for, 2026-08-07.** Goods refused at the gate never
> entered stock, so nothing was ever posted for them — the box recorded a number no report reads and
> a fourth figure to reconcile on every row. The disposition is now **Good + Rework + Scrap =
> Received**.
>
> The consequence is worth knowing: what you do not take simply **stays outstanding on the challan**,
> which is the more honest position, because the material is still at the processor. The step stays
> _Partly back_ until the rest arrives or it is closed short. The column survives, written as 0.

Pre-filled from `job_order_step_outputs`, and **rows can be added**. The plan says what was expected;
the receipt says what actually came back, and only the receipt is a fact — _"it can become 1 item, 2
items, 10 or more"_.

| Field                       | Tag             | Source                                                                                                                                                                    |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item                        | `MASTER`        | `items`. Defaulted from the step's outputs, and a new row picks freely                                                                                                    |
| UoM                         | `INHERIT`       | 🔴 `Item.stockingUomId`, **forced**. One item, one stocking unit                                                                                                          |
| Received qty                | `INPUT`         |                                                                                                                                                                           |
| Accepted qty                | `INPUT`         |                                                                                                                                                                           |
| Rework qty                  | `INPUT`         |                                                                                                                                                                           |
| Scrap qty                   | `INPUT`         |                                                                                                                                                                           |
| ~~Return-to-processor qty~~ | `CALC+`         | **Not asked for** — see the note above. Written as 0                                                                                                                      |
| **Sum check**               | `CALC`          | 🔴 **Per row.** Good + rework + scrap must equal that row's received qty. The dialog will not save otherwise — this is what makes a separate "Rejection Note" unnecessary |
| ~~**Primary**~~             | `CALC+`         | **Positional, not chosen** — the first row. §6.4.1                                                                                                                        |
| ~~**Value**~~               | `CALC+`         | **Not asked for** — by-products at ₹0, the first row absorbs the pot. §6.4.1                                                                                              |
| Reason                      | `MASTER`        | `rejection_reasons` — a small per-org master. Free text cannot be grouped, and wastage analysis is a release-1 report                                                     |
| Responsibility              | `INPUT`         | `ours` \| `theirs`. Drives whether rework is re-charged or free, and the vendor scorecard                                                                                 |
| Tolerance breach approver   | `CTX` + `INPUT` | Recorded only when the breach flag is set                                                                                                                                 |

### 6.4.1 Value strip

> ⚠️ **Not built as a strip, and the by-product value box is not asked for (2026-08-07).** The split
> still happens exactly as below — it is simply not a thing the user types. Every by-product is
> recorded at **₹0** and the first returned row absorbs the pot, which is §9.2.1's own stated default:
> offcuts carry no cost until somebody sells them, and the surviving product should carry the cost of
> the whole operation. A box for it earns its place once by-products are actually being sold.
>
> **Which row is "primary" is positional** — the first in the list. The radio that asked decided
> nothing in the common case (one item back) and was one more thing to get wrong in the uncommon one.
> The rows seed with the step's own main output first.

| Element           | Tag      | Computation                                                                                                                                                                                                                           |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consumed value    | `LEDGER` | `SUM(valueIn − valueOut)` over the lots this receipt consumes, at the processor's location                                                                                                                                            |
| Process charge    | `CALC`   | `qty × step.rate` — 🔴 the PRINCIPAL input's quantity for `per_issued_unit`, the PRIMARY output's for `per_received_unit`. Against a cross-item sum it would multiply the rate by 100 PCS + 5 CONE + 300 PCS, which is 405 of nothing |
| Pot               | `CALC`   | consumed + charge                                                                                                                                                                                                                     |
| By-product values | `CALC+`  | ₹0 each, stored. Not typed today — see the note above                                                                                                                                                                                 |
| Primary's share   | `CALC`   | pot − sum of by-product values                                                                                                                                                                                                        |
| **Balance check** | `CALC`   | 🔴 Conserved by construction: the first row takes exactly what is left. By-products claiming more than the whole operation was worth is refused rather than left to make the primary negative                                         |

### 6.5 Preview before post

Entirely `CALC` — nothing is written until confirmed. It states the lots that will be created, their
quantities, the scrap, and the resulting step status. A ledger posting is not reversible by editing,
so the user sees the consequence first.

### 6.6 What the save writes

| Written                                                             | Source                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job_receipts` + `job_receipt_consumptions` + `job_receipt_outputs` | The form. Two child tables, per §6.2 / §6.4                                                                                                                                                                                      |
| **One output lot per returned item** with accepted qty > 0          | `AUTO` number · `parentLotIds` = **every** lot consumed · value per §6.4.1. Genealogy is many-to-many now, which `parentLotIds` already supports — it is a uuid array precisely because a lot has _"zero, one, or many"_ parents |
| **New rework child lot**                                            | Per output row with `rework qty > 0`. Separate lot = separate piece count                                                                                                                                                        |
| **Stock Ledger**                                                    | `−consumed qty` of each input item at the processor location; `+accepted qty` of each output item at our location                                                                                                                |
| `lot_units.state`                                                   | → `consumed`, and new units created for the **primary** output when the process preserves packaging. A by-product has no package that went out to map back to                                                                    |
| Step / job order status                                             | Recomputed **per input item** (domain §6.5)                                                                                                                                                                                      |

---

## 7. §8.5 Traceability view

The whole screen is derived. Nothing on it is stored, and nothing is entered.

| Element                    | Tag      | Source                                                                                                                                      |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry point                | `INPUT`  | Any lot number, challan number, purchase receipt number, invoice number, or supplier lot ref                                                |
| Resolution to a lot        | `MASTER` | A union search across the numbered documents, then to the lots they touched                                                                 |
| **Backward tree**          | `CALC`   | Recursive walk **up** `lots.parentLotIds` until a lot with no parents — the origin (Purchase Received, opening stock, or customer-supplied) |
| **Forward tree**           | `CALC`   | Recursive walk **down**: every lot listing this one as a parent, plus rework branches and scrap leaves                                      |
| Per-node qty + unit        | `MASTER` | The lot row                                                                                                                                 |
| Per-node value + cost/unit | `CALC`   | `accumulated_value`, and value ÷ qty                                                                                                        |
| Per-node document link     | `MASTER` | `lots.sourceDocType` + `sourceDocId`                                                                                                        |
| Terminal nodes             | `MASTER` | Delivery challans and invoices the lot was dispatched on                                                                                    |

Implemented as one recursive CTE over lot parentage in each direction. 🔴 **The number is never used
to infer the tree** — `LOT-00088` is not the parent of `LOT-00089`; only `parentLotIds` knows.

---

## 8. Where each screen's data ultimately originates

Tracing every field back to its true origin, there are only six:

| Origin                         | Feeds                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------- |
| **Masters an admin maintains** | Items, UoM, Vendors, Customers, Locations, Processes, Routes, rejection reasons |
| **`NumberSequence`**           | Every document number and every lot number                                      |
| **Request context**            | Org, acting user, server date                                                   |
| **The Stock Ledger**           | Every availability figure, every balance, every "can I issue this" decision     |
| **A parent document**          | Everything inherited or snapshotted down the chain                              |
| **The user**                   | Quantities, dates, references, dispositions, reasons                            |

Everything else on every screen is arithmetic over those six.

---

## 9. Load order — what must exist before a screen works

Useful for both the build sequence and for writing seed data.

| To open…           | These must already exist                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Job Order create   | ≥1 Item · ≥1 UoM · ≥1 Location · ≥1 Process · (Route optional)                              |
| Job Order Overview | A saved job order with ≥1 step                                                              |
| **Issue dialog**   | A job order step · ≥1 job-worker Vendor · **stock in the ledger for the step's issue item** |
| Taka expansion     | Item with `lotTracking = 'lot_and_unit'` · lot units created at Purchase Received           |
| Receive dialog     | ≥1 posted issue with an open balance                                                        |
| Traceability       | ≥1 lot with genealogy                                                                       |

🔴 **The Issue dialog cannot be built or demoed before Purchase Received exists**, because its central
grid is a ledger query and an empty ledger renders an empty screen. That dependency is why the parent
document puts Purchase Received in phase 2 and Issue in phase 3.

---

## 10. Field-source defects to watch for

Each has been seen in production systems of this shape:

| Defect                               | Symptom                                                       | Correct source                                        |
| ------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------- |
| Lot picker reads `lots` directly     | Shows fully-consumed lots; users issue stock that is gone     | `LEDGER` query with `HAVING > 0`                      |
| Availability stored as a column      | Drifts from history; nobody can say when                      | `LEDGER`, always computed                             |
| Missing `ownership` filter           | One customer's goods issued into another's job order          | Filter on `jobOrder.ownership`                        |
| Party name stored as FK only         | Reprinting an old challan shows today's address               | `SNAP` alongside the FK                               |
| Route referenced live                | Editing a route silently rewrites running job orders          | `SNAP` at job order creation                          |
| Number allocated on dialog open      | Sequence gaps; a GST compliance issue                         | Allocate inside the save transaction                  |
| Receive mode offered as a choice     | Users pick taka-wise for cutting, where no 1:1 mapping exists | `Process.preservesPackaging`                          |
| Yield reused as a conversion factor  | Stock silently invented or destroyed                          | Observation only; never a factor                      |
| Unfiltered vendor dropdown           | Transporters offered as processors                            | Filter on `vendorTypes`                               |
| `createdBy` accepted from the client | Audit trail forgeable                                         | `CTX` from `req.user.id`, omitted from the input type |
