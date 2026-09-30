# Jobwork Reports — Implementation Prompt

> **Status: PLAN, not built.** Four new reports in the existing Reports Center: **Taka Report**,
> **Batch Report**, **Job Order Report**, **Jobwork (Challan) Report**. Written 2026-09-30.
> Use this file as the prompt. Read §0 before you write any code, and build in §7's order.

---

## 0. Read first — in this order

1. `CLAUDE.md` — especially _Tenant isolation_, _Query shape (N+1)_, _API responses_, _Frontend_
   (responsive + tab navigation are mandatory).
2. **The template you copy — `backend/src/modules/reports/job-order-loss/`** (routes / controller /
   schemas / service) and **`web/src/features/reports/JobOrderLossReportPage.tsx`**. Every new report
   is a sibling of that one: same file layout, same raw-SQL-inside-`runAsTenant` shape, same
   paginated response, same page chrome (header, `ReportDateFilter`, `AdvancedFilter`,
   "Run Report", `CustomizeColumnsModal`, `Pagination`, `sessionStorage` filter state).
3. `backend/src/modules/reports/reports.catalog.ts` — the list the Reports Center renders.
4. `backend/prisma/schema/inventory.prisma` — `Batch`, `BatchUnit`, `StockLedgerEntry` (read the
   doc comments; they are the rules).
5. `backend/prisma/schema/jobwork.prisma` — `JobOrder`, `JobOrderStep`, `JobIssue`,
   `JobIssueLine`, `JobReceipt`, `JobReceiptLine`.
6. `backend/src/modules/jobwork/jobwork.posting.ts` → `closedQtyByIssueLine` — **the** definition of
   "how much of a challan line is no longer at the processor". Reuse it; do not re-derive.
7. `backend/src/modules/jobwork/jobwork.types.ts` → `POSTED_DOC_STATUS`, `isPostedDocStatus`,
   `isExternalLocation`, `SOURCE_DOC_TYPES`.
8. `docs/BATCH_UNITS_IMPLEMENTATION_PLAN.md` Phase 4 (§8 q3 — this work is its "no home" ageing
   report) and `docs/JOBWORK_CORE_WALKTHROUGH.md` for the worked example.

---

## 1. Rules that apply to all four reports

### 1.1 No schema change
Every column below is derivable from existing tables. **No migration, no new table, no RLS work.**
If you find yourself wanting a column, stop and say so — do not add it.

### 1.2 Stock quantities come from the ledger, never from a stored figure
- `batch_units` has **no `qty`**, and there is no `stock_balance` table. On-hand is
  `SUM(qty_in − qty_out)` from `stock_ledger`, grouped by the dimensions the report needs.
- Value is `SUM(value_in − value_out)`.
- Ageing reads **`posted_at`**, never `created_at` (a challan dated yesterday entered today ages
  from yesterday — see the `postedAt` comment).
- An **As-on date** filter means `posted_at <= asOn` inside the SUM. Never compute the current
  balance and relabel it.

### 1.3 Drafts and cancellations
- Draft documents **post nothing** to the ledger. Any sum over `job_issues` / `job_receipts` must
  use `POSTED_DOC_STATUS` (excludes `draft` and `cancelled`) — never a bare `{ not: 'cancelled' }`.
- Batches with `state = 'draft'` (`DRAFT_BATCH_STATE`) are not stock. A ledger-driven query
  excludes them naturally (they have no rows); a query that starts from `batches` or `batch_units`
  must filter them out explicitly.
- `state = 'unallocated'` batches **are** on hand but can never be issued. Show them, labelled
  "Unallocated" — do not hide them (the stock total would stop matching the Stock Summary report).

### 1.4 Query shape
- **One grouped query per report page**, then a `Map` in memory. No `findMany` + per-row
  `aggregate` / `findFirst`. `Promise.all` inside `runAsTenant` does not help (one connection).
- Keep `where organization_id = ${organizationId}` in the SQL **and** run inside `runAsTenant` —
  both layers, as `jobOrderLoss.service.ts` does.
- Paginate in SQL (`LIMIT/OFFSET`), and compute `total` with a separate `COUNT(*)` over the same
  `FROM ... WHERE`.
- Every read filters `is_deleted = false` on every soft-deleted table it joins.

### 1.5 Quantities are not summed across units
Metres, pieces and kg do not add up. Like the job-order-loss report, return a grand total only for
**value**; show quantity totals only when every row shares one UOM (or not at all).

### 1.6 Leave out
- `ownership` / `owner_party_id` columns and filters — customer job work is deferred, every row
  would say "own". (Keep `ownership = 'own'` implicit; do not add a filter UI.)
- `batch_units.parent_batch_unit_id` (genealogy) — nothing writes it yet; the column would be empty.

### 1.7 Wiring (per report)
| Where | What |
|---|---|
| `reports.catalog.ts` | one entry: snake_case `key`, `name`, `category`, kebab-case `path` |
| `backend/src/modules/reports/<name>/` | `.routes` `.controller` `.schemas` `.service` |
| `backend/src/routes/index.ts` | `apiRouter.use('/organizations/:orgId/reports/<path>', router)` — **above** the `/organizations/:orgId/reports` line |
| routes file | `Router({ mergeParams: true })`, `router.use(authenticate, tenantContext)`, `router.get('/', requirePermission('reports:read'), handler)` |
| controller | `safeParse(req.query)` → `ApiError.badRequest` → `sendSuccess(res, await service(req.tenantId!, data))`. No try/catch. |
| `web/src/api/endpoints.ts` | path under `reports` |
| `web/src/features/reports/reports.api.ts` | query + row types, fetch fn |
| `web/src/features/reports/<Name>ReportPage.tsx` | page, calls `useRecordReportVisit(orgId, '<key>')` |
| `web/src/app/router.tsx` | `lazyPage` import + route `/organizations/:orgId/reports/<path>` |

`reports:read` already exists in the permission catalog — **no new permission resource**.

Query keys: `['reports', orgId, '<path>', query]` — `orgId` must be in the key.

Response shape — copy `PaginatedJobOrderLossResponse`:
`{ results, total, page, perPage, totalPages, grandTotalValue? }`.

---

## 2. Taka Report — "Where is each taka now, and how much is left in it?"

`key: taka_report` · `path: taka` · `category: Inventory`

**Grain: one row per (batch_unit × location) with a non-zero balance.** This is a _stock_ report,
not a movement history.

### Columns
| Key | Label | Default | Source |
|---|---|---|---|
| `label` | TAKA NO. | locked | `batch_units.label` |
| `itemName` | ITEM | locked | `items.name` + UOM in grey, linked to the item |
| `batch` | BATCH / LOT | ✅ | `batches.supplier_batch_ref`, fallback `batch_number` |
| `locationName` | LOCATION | ✅ | `locations.name` of the balance row |
| `qty` | QTY ON HAND | locked | `SUM(qty_in − qty_out)` |
| `receivedOn` | RECEIVED ON | ✅ | `MIN(posted_at)` of the unit's inward rows (`qty_in > 0`) |
| `daysAtLocation` | DAYS AT LOCATION | ✅ | today − `MAX(posted_at)` of inward rows **at this location** |
| `sourceDoc` | SOURCE | ✅ | `batch_units.source_doc_type` + document number, linked |
| `receivedQty` | RECEIVED QTY | hidden | first inward qty of the unit — vs `qty` shows shrinkage |
| `challanNumber` | CHALLAN# | hidden | open challan holding it, only when `isExternalLocation(location.type)` |
| `value` | VALUE | hidden | `SUM(value_in − value_out)` |

### Untagged remainder
A batch may be partly tagged (`SUM(units) ≤ batch qty`). Ledger rows with `batch_unit_id IS NULL`
for a batch that **has** units are the loose remainder — emit one row per (batch × location) with
`label = '(untagged)'` so the report total matches stock on hand. Items with no unit level at all
(no `batch_units` for the batch) are **not** in this report.

### Filters
Item, Location, Batch, "Only at job workers" (location type is external), As-on date (default
today), Days-at-location ≥ N.

### SQL shape
```sql
SELECT l.batch_unit_id, l.batch_id, l.location_id,
       SUM(l.qty_in - l.qty_out)   AS qty,
       SUM(l.value_in - l.value_out) AS value,
       MIN(l.posted_at) FILTER (WHERE l.qty_in > 0) AS first_in,
       MAX(l.posted_at) FILTER (WHERE l.qty_in > 0) AS last_in_here
FROM stock_ledger l
WHERE l.organization_id = $org AND l.posted_at <= $asOn
  AND (l.batch_unit_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM batch_units u WHERE u.batch_id = l.batch_id AND NOT u.is_deleted))
GROUP BY l.batch_unit_id, l.batch_id, l.location_id
HAVING SUM(l.qty_in - l.qty_out) <> 0
```
then join `batch_units`, `batches`, `items`, `locations` once. `receivedOn` must be the unit's
first inward **anywhere**, not at this location — compute it in a second grouped CTE by
`batch_unit_id` alone.

---

## 3. Batch Report — "What stock do I hold, batch by batch, and where?"

`key: batch_report` · `path: batch` · `category: Inventory`

**Grain: one row per (batch × location) with a non-zero balance.**

### Columns
| Key | Label | Default | Source |
|---|---|---|---|
| `batch` | BATCH / LOT | locked | `supplier_batch_ref`, fallback `batch_number` |
| `itemName` | ITEM | locked | item + UOM, linked |
| `locationName` | LOCATION | ✅ | balance row's location |
| `qty` | QTY ON HAND | locked | `SUM(qty_in − qty_out)` |
| `takaCount` | TAKAS | ✅ | count of distinct `batch_unit_id` with non-zero balance here; blank when the batch has no units |
| `untaggedQty` | UNTAGGED QTY | ✅ | balance of `batch_unit_id IS NULL` rows, shown only when the batch has units |
| `receivedOn` | RECEIVED ON | ✅ | `MIN(posted_at)` of the batch's inward rows |
| `ageDays` | AGE (DAYS) | ✅ | today − `receivedOn` |
| `sourceDoc` | SOURCE | ✅ | `batches.source_doc_type` + number, linked |
| `state` | STATE | ✅ | `open` → "Open", `unallocated` → "Unallocated" |
| `batchNumber` | INTERNAL BATCH# | hidden | `batch_number` |
| `value` | VALUE | hidden | `SUM(value_in − value_out)` |
| `avgRate` | AVG RATE | hidden | `value / qty` (guard qty = 0) |
| `parentBatches` | FROM BATCH | hidden | `parent_batch_ids` → their labels (dyed lot → grey lot) |

### Filters
Item, Location, Batch text, State, As-on date, Age ≥ N days.

**Cross-check:** for any item, `SUM(qty)` across this report must equal the Stock Summary report's
on-hand for that item and date. Put that in a test.

---

## 4. Job Order Report — "How far along is each order, and what has it cost?"

`key: job_order_report` · `path: job-orders` · `category: Job Work`

**Grain: one row per job order** (`is_deleted = false`; exclude `cancelled` unless the Status
filter asks for it).

### Columns
| Key | Label | Default | Source |
|---|---|---|---|
| `jobOrderNumber` | JOB ORDER# | locked | linked to the order |
| `orderDate` | ORDER DATE | locked | `order_date` |
| `targetDate` | TARGET DATE | ✅ | `target_date` |
| `inputItem` | INPUT ITEM | ✅ | `input_item_id` → item + UOM |
| `inputQty` | PLANNED QTY | ✅ | `input_qty` |
| `routeName` | ROUTE | ✅ | `route_name_snapshot` |
| `status` | STATUS | locked | `status` (draft · in progress · completed · closed short · cancelled) |
| `currentStep` | CURRENT STEP | ✅ | lowest-`seq` step with `is_completed = false`: `"{seq}. {process_name_snapshot} — {processor_name_snapshot}"` |
| `stepsDone` | STEPS | ✅ | `"{completed} / {total}"` |
| `issuedQty` | ISSUED | ✅ | **step 1 only**: `SUM(job_issues.total_qty)` over posted issues |
| `acceptedQty` | ACCEPTED | ✅ | **last step only**: `SUM(job_receipts.total_accepted_qty)` over posted receipts |
| `reworkQty` · `scrapQty` | REWORK · SCRAP | ✅ | summed over posted receipts, all steps |
| `pendingQty` | PENDING AT JOB WORKERS | ✅ | Σ outstanding of open challan lines on the order (§5 definition) |
| `overdueDays` | OVERDUE | ✅ | today − `target_date` when status is not completed/closed short/cancelled and > 0 |
| `yieldPct` | YIELD % | hidden | actual accepted ÷ issued per step vs `expected_yield` — show the worst step |
| `cost` | COST SO FAR | hidden | `SUM(consumed_value + process_charge_total)` over posted receipts |
| `remarks` · `createdBy` | REMARKS · CREATED BY | hidden | |

⚠️ **Do not add issued quantities across steps.** Each step issues the previous step's output, often
in a different unit (metres in, pieces out). "Issued" is step 1's input, "Accepted" is the last
step's output; anything else is a per-step figure and belongs in the order's detail page.

### Filters
Date range on `order_date` (default this month), Status, Input item, Processor (any step's
`processor_name_snapshot`), Route, "Overdue only".

### SQL shape
One query over `job_orders` for the page, then **one** grouped query each over `job_order_steps`,
`job_issues`, `job_receipts` with `job_order_id = ANY($pageIds)`, and one `closedQtyByIssueLine`
call over every open issue line of those orders. Four or five round trips per page, not per row.

---

## 5. Jobwork Report (Challan Register) — "What is lying with which job worker, and for how long?"

`key: jobwork_challan_register` · `path: jobwork-challans` · `category: Job Work`

**Grain: one row per issue challan** (`job_issues`, posted only — `POSTED_DOC_STATUS`).

### Outstanding — the one definition
Per issue line: `outstanding = job_issue_lines.qty − closedQtyByIssueLine(line)`.
Per challan: `pendingQty = Σ outstanding` over its lines. A challan whose status is `closed` has
`pendingQty = 0` by construction (closing books the short quantity as shrinkage/write-off) — if the
sum says otherwise, the bug is in your query, not in the display.
**Call `closedQtyByIssueLine` once with every line id on the page.** It already excludes draft and
cancelled receipts and includes completion write-offs.

### Columns
| Key | Label | Default | Source |
|---|---|---|---|
| `challanNumber` | CHALLAN# | locked | linked to the issue |
| `issueDate` | ISSUE DATE | locked | `issue_date` |
| `processorName` | JOB WORKER | locked | `processor_name_snapshot` |
| `process` | PROCESS | ✅ | step `process_name_snapshot` |
| `jobOrderNumber` | JOB ORDER# | ✅ | linked |
| `items` | ITEM | ✅ | the single item + UOM, or "N items" when the challan has several |
| `issuedQty` | ISSUED | locked | `total_qty` |
| `receivedQty` | RECEIVED | ✅ | Σ `job_receipt_lines.received_qty` for this challan, posted receipts only |
| `acceptedQty` · `reworkQty` · `scrapQty` · `returnedQty` | ACCEPTED · REWORK · SCRAP · RETURNED | ✅ | same source |
| `pendingQty` | PENDING | locked | definition above |
| `daysOutstanding` | DAYS | locked | today − `issue_date` while `pendingQty > 0`; else blank |
| `status` | STATUS | ✅ | issued · partially received · closed |
| `processCharge` | PROCESS CHARGE | hidden | Σ `process_charge_total` of the receipts against it |
| `attempt` | ATTEMPT | hidden | `is_rework` → `"Rework #{attempt_no}"` |
| `reason` | REJECTION REASON | hidden | `rejection_reasons.name` of the receipt lines |
| `transporter` | TRANSPORTER | hidden | |

**GST highlight:** `daysOutstanding > 180` shows in the warning colour (inputs must come back within
180 days; capital goods 365). Only a colour on the cell — no banner, no sentence (CLAUDE.md
_Field messages stay short_). Distinguishing capital goods from inputs needs an item attribute that
does not exist yet — use 180 for everything and note it as a follow-up, do not invent the field.

### Filters
Job worker, Process, Job Order#, Item, Issue-date range, **"Open only" — ON by default**,
"Days ≥ N".

⚠️ `received_qty` on a receipt line is in the **output** unit when a process changes the unit
(metres in, pieces out). Pending is computed from `closedQtyByIssueLine` — which is in the issue
unit — **never** from `issued − received`.

---

## 6. Frontend — each page

- Copy `JobOrderLossReportPage.tsx` structure: header ("Inventory" / "Job Work" subtitle + report
  name + date or "As on dd-MM-yyyy"), close button (44px), filter bar, "Run Report", columns
  button, table, `Pagination`.
- `COLUMN_CATALOG` exactly as the tables above (`locked`, `defaultVisible`); `RIGHT_ALIGNED` for
  quantity, value and day columns.
- Dates `dd-MM-yyyy`; money `₹` + `en-IN` grouping (copy the `money` helper); qty `toFixed(2)`.
- Every document number is a `Link` into its screen (item, batch's source doc, job order, challan).
- Table inside `.responsive-table-wrapper`; the table keeps its `min-width`, the wrapper scrolls.
  No fixed pixel widths on layout; `min-width: 0` on flex children.
- Filter placeholders say **"Select …"** (`Select an item…`, `Select a job worker…`).
- Tab walks header → filters → Run Report → columns → table links → pagination, in DOM order.
  No positive `tabIndex`. Dropdowns in filters use the shared `ItemComboBox` / `ComboBox` with
  `portal`.
- Empty state: one line saying nothing matched the filters.
- Walk every page at **390px, 768px and desktop** before calling it done.

---

## 7. Build order

1. **Batch Report** (backend → test → page). It is the simplest ledger grouping and the cross-check
   against Stock Summary proves the query before anything depends on it.
2. **Taka Report** — the Batch query one level deeper, plus the untagged row.
3. **Jobwork Challan Register** — introduces `closedQtyByIssueLine` reuse.
4. **Job Order Report** — reuses the challan outstanding from step 3 for `pendingQty`.

After each: `npm run typecheck` + `npm run lint` (backend), `npx tsc -b` (web — **not**
`tsc --noEmit`), the report's test file, then the 390/768/desktop walk and a keyboard walk.

---

## 8. Tests — one file per report, `<name>.service.test.ts`

Create fixtures with `src/db/testTenant.ts` (never mutate an org you merely found; never an
unfiltered delete in `afterAll`). Suites run in parallel against the shared dev DB. Cover at least:

| Report | Must prove |
|---|---|
| All | a second tenant's rows never appear (tenant isolation) |
| All | a draft issue / draft receipt / draft batch contributes nothing |
| All | a cancelled receipt contributes nothing and re-opens the challan's pending qty |
| Batch | Σ qty per item = Stock Summary on-hand; `unallocated` batch appears labelled |
| Batch / Taka | As-on date before a movement excludes it |
| Taka | partly-tagged batch → tagged rows + one `(untagged)` row, total = batch balance |
| Taka | a taka at a job worker shows the job worker's location and days since it arrived there |
| Challan | partial receipt → pending = issued − consumed; closing the challan → pending 0 |
| Challan | a unit-changing process (metres in, pieces out) still reports pending in metres |
| Job Order | issued = step 1 only, accepted = last step only; overdue only when not finished |

---

## 9. Explicitly out of scope (ask before adding)

- **Job-worker summary** (one row per job worker: total pending, open challans, oldest age).
  Natural next report; not requested.
- **Taka movement history** (one row per ledger entry per taka).
- **ITC-04 export** and the capital-goods 365-day rule (needs an item attribute that does not exist).
- Any new column, table, setting or permission resource.
