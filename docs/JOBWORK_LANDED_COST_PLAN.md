# Landed cost — rate per output, derived consumption, loss at completion

**Status: planned 2026-09-14, reviewed the same day. Phase 1 (§6.0, both bugs) built 2026-09-14 —
`jobwork.posting.ts`, guarded by `jobwork.postingGuards.test.ts`; everything after it is not built.** Agreed over 2026-09-12 → 14. This
replaces the step-level `rate` / `rateBasis` cost model described in `JOBWORK_DOMAIN_AND_MODULE_MAP.md`
§9.1–§9.2.1, and moves tolerance from the process and step onto the item. Those sections,
`JOBWORK_CORE_WALKTHROUGH.md` and `JOBWORK_UI_FIELD_SOURCES.md` are edited in place **after** the code
ships, not before.

---

## 1. What changes, in one paragraph

A step no longer carries one rate and a basis. **Each produced row carries its own rate**, charged on
the **accepted** quantity only. A receipt no longer settles its challans in full: it **works out how
much material the returned goods used**, from the ratio the job order's own plan already states —
**planned input against expected output** (through the recipe, where the output is a composite) — and
**pre-fills it per input item, editable** for when the processor reports a different figure. Nobody
types a loss percentage or a conversion. Each receipt's cost is final the moment it is posted, however
many receipts a job takes. Whatever is still at the processor when a human **completes the step** is
written off, and its value is reported as **job order loss**. Separately, **tolerance becomes a property
of the item**, copied onto the step's input row. Two existing bugs this depends on are fixed first (§6.0).

## 2. Decisions this plan rests on

| #   | Decision                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Rate lives on each **produced row** (route step output → job order step output → receipt output). `rateBasis` is removed everywhere.                                                                                                                 |
| D2  | The rate is charged on **accepted qty**. Lost or unreturned material is never charged; a rework piece is charged once, on the receipt where it is finally accepted.                                                                                  |
| D3  | **No "made from" column.** A step with **more than one input item** may only produce **composite items**, and every component of each recipe must be one of the step's inputs.                                                                       |
| D4  | Composites **may contain composites**, so a multi-step order works (Red Cotton is a composite; Shirt's recipe lists Red Cotton).                                                                                                                     |
| D5  | **Material used is calculated and pre-filled per input item on the receipt, and editable** (as SAP subcontracting allows at goods receipt). Left alone, the calculation (R3) is used.                                                                |
| D6  | **No percentage and no conversion is typed.** Expected loss — and, across a unit change, the conversion — is **implied by the plan**: each input row's planned quantity against the expected output quantities. It is worked out **per input item**. |
| D7  | Loss exists **only when the step is completed** (manually, as today). Until then the remainder is "still at processor".                                                                                                                              |
| D8  | Unreturned material at completion is **job order loss**. It is never reloaded onto batches that may already have moved on.                                                                                                                           |
| D9  | **A unit change does not need a composite.** A single-input step turning metres into pieces is costed by the same planned ÷ expected ratio.                                                                                                          |
| D10 | **Tolerance is item-wise.** An item carries a default tolerance %; picking the item on a step's input row **copies** it, editable. The Process-level and step-level tolerances are removed.                                                          |
| D11 | **The plan must be complete before material leaves.** Every input row needs a planned quantity and every output row an expected quantity before the step's first (non-rework) challan is posted.                                                     |
| D12 | **One fabric is never cut into more than one piece type in one step** (confirmed 2026-09-14), so a single-input step with an output in a different unit has that output only.                                                                        |
| D13 | **Scope held deliberately small** (review, 2026-09-14): only what changes the calculated cost or the stock figures is in this plan. Everything else is listed in §10.                                                                                |

Consistent with ERP practice: a processed item with a bill of materials, component consumption proposed
from it at goods receipt and adjustable there, is how SAP subcontracting (movement 543) and Tally job work
model "what the processor was given"; normal loss inside product cost and abnormal loss written off at
order completion is IAS 2 / Ind AS 2 ¶16(a); an over-delivery tolerance on the material master (SAP) is
the same shape as D10.

## 3. The rules (the engine)

These are the rules the code comments should cite as `landed-cost R1…R9`.

- **R1 — Weight of an input in an output, `w(o, i)`.**

  | The step                                 | `w(o, i)`                                                |
  | ---------------------------------------- | -------------------------------------------------------- |
  | Output is a composite                    | its recipe qty, from the job order's **snapshot** (§5.2) |
  | One input, any output (same unit or not) | `1`                                                      |
  | Receipt closes **rework** challans       | `1`, against the output item itself                      |

  Offcuts and waste are **not** recorded as output rows: every output row draws material by these rules,
  so an offcut row would take full fabric cost away from the real product. Unreturned material is loss
  at completion.

- **R2 — The plan ratio, per input item.**
  `k_i = planned_i ÷ Σ_o (expected_o × w(o, i))` over the outputs that draw on `i`.
  It holds the expected loss, and across a unit change it also holds the conversion:
  1,000 m planned for 950 m expected gives `k = 1.0526`; 1,000 m for 1,200 PCS gives `k = 0.8333 m per PCS`.
  Rework receipts use `k = 1` — a rework pass has no plan of its own, and completion writes off the rest.
- **R3 — Need.** For each produced row `o` and each input `i` it draws on:
  `need(o, i) = (accepted_o + rework_o) × w(o, i) × k_i`, to 4 dp.
- **R4 — Used, per input item.**
  - **Typed on the receipt** → that figure. Refused if it exceeds what is outstanding on the selected
    challans, or if no output on the receipt draws on the item (there is nothing to carry its value).
  - **Not typed** → `min(Σ need(·, i), outstanding_i)`. A cap shows a **warning**, never a refusal (the
    processor wasted less than planned, or a challan was not ticked). Differences under 0.001 raise no
    warning.
  - Either way it is allocated FIFO across the selected challans' lines of that item by the existing
    `allocateConsumption`.
- **R5 — Material value.** `consumedValue_i` = what the consume rows posted (batch cost per unit at the
  processor location, running balance — unchanged). Split across the rows that draw on item `i` **in
  proportion to their need**, through `splitByQty` so no paisa goes missing — the same split whether the
  used figure was typed or calculated. Legitimate: one item, one unit.
- **R6 — Charge.** `charge_o = (rate_o ?? 0) × accepted_o`. `NULL` rate = not agreed = ₹0; `0` = free.
- **R7 — Row value.** `material_o = Σ_i share(o, i)`. Accepted and rework split `material_o` by quantity;
  **the charge goes to the accepted side only.** Conservation is asserted:
  `Σ_o (material_o + charge_o) = Σ_i consumedValue_i + Σ_o charge_o`, to the paisa.
- **R8 — Completion write-off.** On Complete step (and on Close short, per step): for every line of every
  posted challan of the step, `outstanding = qty − closed by posted receipts − already written off`;
  post a `scrap` for **all of it, however small**, at the challan's destination, same batch and package,
  valued at that batch's running cost per unit there — so a completed step leaves exactly nothing at the
  processor. Customer-owned stock is zero-valued by `postMovement`, as everywhere.
- **R9 — A completed step is closed.** No issue, receipt, receipt cancellation or issue cancellation
  against it. Completion is refused while the step has draft issues or receipts. There is no reopen.

**Validation of a step's shape** (job order create, and the rewritten tail of an update; locked steps are
not re-validated):

- V1: more than one distinct input item → every output item is `item_structure = 'composite'`.
- V2: every component of an output composite is one of the step's input items; a composite with an empty
  recipe is refused.
- V3: one input, and an output in a different unit from it → that output is the step's **only** output
  (D12). `Σ expected × w` cannot add pieces to metres.

**Validation of the plan (D11)** — at **issue post**, not at job order save, because a half-planned order
must still save, and a step cannot be re-planned once a challan exists:

- V4: every input row of the step has `planned_qty > 0` and every output row `expected_qty > 0`.
  Refused per row, naming the step and item. Drafts and rework challans are exempt.

**Warnings, never refusals** — shown on the steps grid, and on the Issue screen before posting:

- An output expected to exceed its input (`k_i < 1` on a same-unit step, or planned below the recipe's
  need): fabric does stretch, so it saves.
- Expected left **equal to planned** on a same-unit step: "no loss is expected, so any shrinkage will be
  job order loss rather than part of landed cost".
- An input no output draws on: it will never be consumed and will be written off at completion.

**Tolerance (D10)** is not part of the cost engine. It keeps its one job — the over-issue ceiling
`planned × (1 + tolerance %)` in `assertWithinTolerance` (`jobIssues.service.ts:241`) — and only its
source changes: the input row's own value, and nothing else.

## 4. Worked examples (verified by hand; each becomes a test in §8)

Cotton ₹10/m. Dyeing rate ₹12 per accepted metre.

**A. Partial receipts, loss as planned.** Planned 1,000 m, expected 950 m → `k = 1.052632`.

```
Receipt 1  500 m accepted → needs 526.3158 m   ₹5,263.16 + ₹6,000 = ₹11,263.16 → ₹22.53/m
Receipt 2  450 m accepted → needs 473.6842 m   ₹4,736.84 + ₹5,400 = ₹10,136.84 → ₹22.53/m
Complete   1,000 − 1,000 = 0 left              → no loss
```

Same as a single receipt of 950 m: `(₹10,000 + ₹11,400) ÷ 950 = ₹22.53`.

**B. More loss than planned (8% actual).** Same plan; receipts of 500 m and 420 m.

```
Receipt 1  500 m → 526.3158 m → ₹22.53/m
Receipt 2  420 m → 442.1053 m → ₹4,421.05 + ₹5,040 = ₹9,461.05 → ₹22.53/m
Complete   1,000 − 968.4211 = 31.5789 m left → scrap at processor → job order loss ₹315.79
```

**C. Less loss than planned — the cap.** Same plan; receipts of 500 m and 460 m.

```
Receipt 2  460 m → needs 484.2105 m, only 473.6842 m outstanding → capped, warning shown
           ₹4,736.84 + ₹5,520 = ₹10,256.84 → ₹22.30/m
```

**D. Several inputs, several outputs.** Cotton ₹10 and Silk ₹20, **planned 1,000 m each**. Composites Red
Cotton (1 m cotton), Red Silk (1 m silk), Green Cotton (1 m cotton), **expected 712.5 / 950 / 237.5 m**.
Red ₹12, Green ₹25.

```
k_cotton = 1,000 ÷ (712.5 + 237.5) = 1.052632        k_silk = 1,000 ÷ 950 = 1.052632

One receipt: Red Cotton 300 m, Red Silk 200 m, Green Cotton 100 m

Cotton   needs 315.7895 (Red) + 105.2632 (Green) = 421.0526 m  → ₹4,210.53
Silk     needs 210.5263 (Red Silk)                               → ₹4,210.53

Red Cotton    ₹3,157.89 + 300 × ₹12 = ₹6,757.89  → ₹22.53/m
Red Silk      ₹4,210.53 + 200 × ₹12 = ₹6,610.53  → ₹33.05/m
Green Cotton  ₹1,052.63 + 100 × ₹25 = ₹3,552.63  → ₹35.53/m
                                     ──────────
              ₹16,921.05 = ₹8,421.05 material + ₹8,500 charges   ✓
```

**E. A composite of a composite, with a different loss per input.** Step 2: Shirt = 1.5 m Red Cotton +
6 buttons (₹1). **Planned 150 m Red Cotton and 588 buttons for 98 shirts.** Rate ₹40. Red Cotton from A
at ₹22.5263/m.

```
k_fabric  = 150 ÷ (98 × 1.5) = 1.020408   (2% fabric loss planned)
k_buttons = 588 ÷ (98 × 6)   = 1           (no button loss planned)

98 shirts accepted → Red Cotton 98 × 1.5 × 1.020408 = 150 m  → ₹3,378.95
                     Buttons    98 × 6   × 1        = 588    →   ₹588.00
                     Charge     98 × ₹40                     → ₹3,920.00
                                                               ₹7,886.95 → ₹80.48/shirt
```

**F. A unit change without a composite.** Fabric ₹10/m. Panels are a plain item. **Planned 1,000 m,
expected 1,200 PCS** → `k = 0.833333 m per panel`. Rate ₹2 per panel.

```
Receipt 1  600 panels → 600 × 0.833333 = 500.0000 m   ₹5,000.00 + ₹1,200 = ₹6,200.00 → ₹10.33/panel
Receipt 2  580 panels → 580 × 0.833333 = 483.3333 m   ₹4,833.33 + ₹1,160 = ₹5,993.33 → ₹10.33/panel
Complete   1,000 − 983.3333 = 16.6667 m left → job order loss ₹166.67
```

**G. The processor reports what it used.** Plan as in A. The dyer's delivery note says 540 m went into
the first 500 m.

```
Receipt 1  500 m, Used typed 540 m (calculated 526.3158)   ₹5,400 + ₹6,000 = ₹11,400 → ₹22.80/m
Receipt 2  450 m, Used left alone → needs 473.6842 m, only 460 m outstanding → capped, warning
           ₹4,600 + ₹5,400 = ₹10,000 → ₹22.22/m
Complete   0 left → no loss
```

## 5. Schema

### 5.1 Columns

```prisma
// ADD
Item.defaultTolerancePct          Decimal? @map("default_tolerance_pct") @db.Decimal(6, 3)

RouteStepOutput.rate              Decimal? @db.Decimal(18, 4)   // template suggestion
JobOrderStepOutput.rate           Decimal? @db.Decimal(18, 4)   // the agreed number (snapshot, §2.4)
JobReceiptOutput.rate             Decimal? @db.Decimal(18, 4)   // what was billed; defaults from the step
JobReceiptOutput.materialValue    Decimal  @default(0) @map("material_value") @db.Decimal(18, 4)
JobReceiptOutput.processCharge    Decimal  @default(0) @map("process_charge") @db.Decimal(18, 4)
JobReceipt.consumedValue          Decimal  @default(0) @map("consumed_value") @db.Decimal(18, 4)
JobReceipt.processChargeTotal     Decimal  @default(0) @map("process_charge_total") @db.Decimal(18, 4)

// DROP — second migration, §7
Process.rateBasis · Process.defaultTolerancePct
RouteStep.rate · RouteStep.rateBasis · RouteStep.tolerancePct
JobOrderStep.rate · JobOrderStep.rateBasis · JobOrderStep.tolerancePct
```

- **The ratio needs no column.** `JobOrderStepInput.plannedQty` and `JobOrderStepOutput.expectedQty`
  already exist, and a locked step's rows are never rewritten (`assertLockedStepsUnchanged`,
  `jobOrders.service.ts:1433`) — exactly the snapshot the cost engine needs.
- **Used needs no column either.** `job_receipt_lines.issued_qty` already stores what each challan line
  gave up to the receipt.
- **`expected_yield` is untouched.** It stays a planning helper that fills the primary output's Expected
  box (`derivedExpectedQty`); the cost engine never reads it.
- **The Process master keeps no cost field at all** once `rate_basis` and `default_tolerance_pct` go.
- **Tolerance is Item → job order step input row.** `JobOrderStepInput.tolerancePct` already exists and
  stays. Route step inputs carry no tolerance (a template holds none today either); a job order created
  from a route fills each row from its item.
- **`JobReceiptOutput.valueShare` and `isPrimary` stay** but stop driving cost. `isPrimary` still names
  the row the header totals and the rework shortcut describe. Nothing new writes `valueShare`.
- The receipt snapshots exist because today a posted receipt **cannot explain its own cost** — the charge
  was never stored, and the step rate it came from is still editable.

### 5.2 New table — recipe snapshot

```prisma
/// The recipe of a composite output, frozen when the job order step is written — the same snapshot
/// rule as every other step field (§2.4). Editing the composite afterwards must not change what a
/// running job order consumes.
model JobOrderStepOutputComponent {
  id                   String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId       String  @map("organization_id") @db.Uuid
  jobOrderStepOutputId String  @map("job_order_step_output_id") @db.Uuid
  componentItemId      String  @map("component_item_id") @db.Uuid
  qtyPerUnit           Decimal @map("qty_per_unit") @db.Decimal(18, 6)
  uomId                String? @map("uom_id") @db.Uuid
  seq                  Int     @default(0)
  // + customFields and the five audit columns (CLAUDE.md), relations incl. the two User back-relations
  @@index([organizationId, jobOrderStepOutputId])
  @@map("job_order_step_output_components")
}
```

🔴 **A new tenant table.** Direct RLS policy (it carries `organization_id`), written **by hand** in the
migration with the guarded `pg_policies` shape from
`migrations/20260911150000_enable_rls_on_purchase_orders_and_item_categories`, and added to
`TENANT_TABLES` in `src/db/rls.test.ts`. `db:draft` will not generate the policy and `db:check-drift`
will never report it missing.

Written in `createJobOrder` / the update tail from **one** `compositeItemComponent.findMany` over every
composite output on the order — never one query per row.

### 5.3 No table for loss

The write-off is **ledger rows**, not a document: `sourceDocType = 'job_order_step'`,
`sourceDocId = step.id`, `sourceDocLineId = job_issue_lines.id`, `movementType = 'scrap'`. Loss per
item and its value are a `groupBy` over those rows. Add `jobOrderStep: 'job_order_step'` to
`SOURCE_DOC_TYPES` (`jobwork.types.ts`).

## 6. Code

### 6.0 Two existing bugs, fixed first (can ship alone, before anything else)

Found in review. Both corrupt stock figures today, and every rule below assumes they are fixed.

**Bug 1 — a challan whose material was already used can be cancelled.**
`cancelJobIssue` refuses only when `job_receipt_lines.received_qty` sums above zero
(`jobIssues.service.ts:1516`), but receipts write `issued_qty` alone on those lines
(`jobReceipts.service.ts:2332`) — so the sum is always zero and the guard never fires. The reversal then
takes stock out of the processor that is no longer there, and `postMovement` has no general balance
check (`stockLedger.service.ts:282` checks only that packages fit), so the balance silently goes negative
and distorts the cost per unit of every later receipt from that batch. No test covers it.

- Refuse when any line of the challan has been closed by a **posted** receipt — the same figure as
  `closedQtyByIssueLine`, plus any written-off quantity once §6.6 lands.
- `closedQtyByIssueLine` moves out of `jobReceipts.service.ts` into a module both services import
  (`jobwork.refs.ts` or a new `jobwork.balances.ts`), so the issue service does not import the receipt
  service.
- Test: cancelling after a posted receipt is refused; after that receipt is itself cancelled, it is allowed.

**Bug 2 — nothing serialises two postings on the same step.** No query in the backend takes a row lock.
Two receipts posted together on the same challans both read the same outstanding quantity and both
consume it; with §6.6, a completion racing a receipt would write off material the receipt is consuming.

- At the start of every **posting** action, lock the step row inside the transaction:
  `SELECT id FROM job_order_steps WHERE id = $1 AND organization_id = $2 FOR UPDATE`
  (keep the `organization_id` filter — RLS is the second layer, not the first).
- Actions: issue post (create and post-draft), receipt post (create and post-draft), `cancelJobIssue`,
  `cancelJobReceipt`, `manuallyCompleteStep`, `shortCloseJobOrder`. Draft saves post nothing and do not lock.
- **Re-read after locking** whatever the action decided on before it — status, outstanding quantities — or
  the lock protects a decision already made on stale data.
- `shortCloseJobOrder` locks its steps **in `seq` order** so it can never deadlock against a single-step action.
- Test: two receipts posted concurrently against one challan — the second sees the first's consumption.

### 6.1 Composites (can ship alone)

- `compositeItems.service.ts:180, 370` — remove "Component cannot be a Composite Item"; add a **cycle
  check** (the composite must not appear anywhere under the component): one `WITH RECURSIVE` query
  inside the tenant transaction, not a walk of one query per level.
- `assemblies.service.ts:479` — lift the same refusal. A composite component is consumed from its
  batches like any item. Disassembly unpacks one level.
- Composite create/edit pages — confirm the component picker offers composites and shows the cycle error.

### 6.2 Item-wise tolerance (can ship alone, after 6.1)

- **Items** — `items.prisma`, `items.schemas.ts` both sides; a "Tolerance %" field (0 ≤ x < 1000,
  optional) on `CreateItemPage` / `EditItemPage` and the composite create/edit pages; shown on
  `ItemDetail`.
- **`jobOrders.service.ts`** — each input row stores `row.tolerancePct ?? item.defaultTolerancePct`, read
  in the item query the row resolution already makes (no new query). `applyStepDefaults` (`:415`) loses
  its tolerance line.
- **`jobIssues.service.ts:270`** — `row?.tolerancePct ?? step.tolerancePct` → `row?.tolerancePct`. An
  item with no row, or a row with no percentage, is unchecked, exactly as a null is today.
- **Process, route, job order schemas and services** — step `tolerancePct` and `defaultTolerancePct` out.
  `listViews.catalog.ts:177` — the Processes "Tolerance %" column goes.
- **Frontend** — `StepsGrid.tsx`: picking an item on an input row sets that row's tolerance to the
  item's default (a real value, not the greyed `stepTolerancePct` placeholder at `:215`, which is removed
  — a copy is right here because editing the item later must not loosen a running order's limit).
  Changing the item re-copies. Tolerance leaves `ProcessForm` / `ProcessDetail` / `ProcessesList`,
  `RouteForm` / `RouteDetail`, `JobOrderForm` / `JobOrderStepDetail`, and any step-level display in
  `IssueForm` / `IssueDetail` / `jobIssues.schemas.ts` / `jobIssues.api.ts` / `jobwork.schemas.ts`.

### 6.3 Process, route, job order — cost fields

- `processes.{schemas,service,types}.ts` — drop `rateBasis`.
- `processRoutes.{schemas,service}.ts` — drop step `rate`/`rateBasis`; add `rate` on outputs.
- `jobOrders.{schemas,service}.ts`
  - `applyStepDefaults` (`:403`) loses `rateBasis`.
  - Step write (`:861`) — `rate`/`rateBasis` out; output rows carry `rate`; write recipe snapshots.
  - V1–V3 in the step resolution path, with field-keyed `ApiError` details so the grid can mark the row.
  - 🔴 **Expected is defaulted only when the step has exactly one output.** `planQuantities` (`:567`)
    fills a blank Expected through `derivedExpectedQty` (`:490`), which gives the primary output the
    **whole** planned input. With two outputs sharing that input — Red Cotton left at the default 1,000,
    Green Cotton typed 250 — `k = 1,000 ÷ 1,250 = 0.8`, a receipt of 300 m Red Cotton would use 240 m
    (₹2,400 instead of ₹3,157.89), the shortfall would appear as false loss at completion, and the next
    step would plan from the inflated figure (`:572`). On a multi-output step every Expected stays blank
    until typed, and V4 insists on it before issue. The client mirror (`jobwork.schemas.ts:400`) follows.
- `listViews.catalog.ts:175` — the `rateBasis` column goes. Check that a saved `list_view_preferences`
  row naming a removed key is ignored rather than breaking the list.

### 6.4 Issue — the plan check (D11)

- `jobIssues.service.ts`, beside the chain guard (`:975`), on post and not on a draft, and not on a rework
  challan: V4 over the step's input and output rows, one read of each list. The message names the
  step, the item and the missing quantity, keyed so `IssueForm` can point at the job order.
- `IssueForm.tsx` — the same check before posting, from the step it already loads, with a link to edit
  the job order while the step is still editable.

### 6.5 Receipt engine — `jobReceipts.service.ts`

- **Remove:** `processCharge` (`:773`), `splitValue` (`:1069`), the charge block (`:1936–1944`),
  the principal-input lookup's role in cost (it stays for `totalIssuedQty`).
- **Request — `lines` keeps its shape and changes its meaning.** A bulk line is `{ itemId, issuedQty }`
  today and means "settle this item in full". It now means **"used"**: the client sends the pre-filled or
  edited figure per input item, and a line whose `issuedQty` is omitted is calculated by the server (R4).
  The server always calculates `need` itself, because R5 splits by it.
- **Allocation** runs through `allocateConsumption` as today and writes `job_receipt_lines` from its
  result, so `closedQtyByIssueLine` keeps working (`:2331` already stores the challan line).
- **Drafts** keep saving their lines, exactly as today, so `postJobReceiptDraft` still finds its challans
  from them (`:2401`). One addition: a ticked challan whose item has nothing used yet still gets a
  **zero-quantity line**, or saving a draft before the outputs are typed would lose the challan selection.
- **Rework:** a receipt whose challans are all `is_rework` uses R1's last row and `k = 1`. Mixing rework
  and first-pass challans on one receipt is refused — the two consume different items by different rules.
- **Value:** R5–R7 replace the pot. `postSide` is unchanged; it receives accepted and rework values.
- **Snapshots:** write `rate`, `materialValue`, `processCharge` per output row and the two header totals.
- **Guards (R9):** refuse create/post when the step is `completed` or `short_closed`; refuse
  `cancelJobReceipt` (`:2569`) when its step is completed — reversing a consume would put material back
  at a processor the step has already written off. Refuse a step that fails V1–V4 (§7, legacy steps).

### 6.6 Completion — `jobOrders.service.ts`, `jobOrders.status.ts`, `jobIssues.service.ts`

- `manuallyCompleteStep` (`:685`) — lock (§6.0), refuse while drafts exist, post R8's write-off in the
  same transaction with **one** grouped balance read (`getBalancesByBatchAndLocation`) and the running
  balance kept in memory as each scrap posts — the pattern `jobReceipts.service.ts:1866` already
  documents — then `recomputeStep`. Move it onto `runAsDocument`: a fifty-line challan writes fifty rows.
- `shortCloseJobOrder` (`:1601`) — run the same write-off for each step it closes.
- `closedQtyByIssueLine` (now shared, §6.0) — also subtract the net written-off quantity per line
  (Σ qtyOut − Σ qtyIn over `job_order_step` rows for that `sourceDocLineId`, so a reversal nets out).
- `ItemFlow` (`jobOrders.status.ts:51`) gains `writtenOffQty`; `getItemFlows` and `getAllStepTotals`
  add one `groupBy` each — no per-step queries (CLAUDE.md, N+1).
- `jobIssues.service.ts:955` — refuse issuing to, or cancelling a challan of, a completed step.

### 6.7 Frontend — cost

- **Process form / list / detail** — drop Rate basis and Tolerance. Nothing replaces them.
- **`StepsGrid.tsx`**
  - Remove the Rate + Rate basis block (`:1100–1135`).
  - Add a **Rate** column to the produces grid, labelled per unit (`₹ / m`).
  - Planned and Expected read as **needed to issue**: a quiet marker, not a save-blocking error (D11).
  - The §3 warnings on the row they concern.
  - When the step has more than one input, the produces picker offers composites with a one-line reason.
  - V1–V3 errors land on the row.
- **`RouteForm` / `RouteDetail` / `JobOrderForm`** — rate moves to output rows; `rateBasis` gone.
- **`ReceiveForm.tsx`**
  - Replace the consumed grid's "settles in full" behaviour (`:577`, `:768–785`) and "this receipt's
    loss" (`:737`) with a **Used** column per input item: pre-filled from R3 as the returned quantities
    are typed, editable, never above what is outstanding. Once edited it stops following the calculation
    and shows the calculated figure beside it; clearing it returns to the calculation.
  - Add a Rate column per returned row, prefilled from the step, editable.
  - A cost preview per row — `material + charge = total → ₹/unit` — with the R4 cap warning. The receipt
    prefill returns, per open challan line, the outstanding qty and the batch's cost per unit at the
    processor.
  - The preview is a client mirror of R1–R7 in `jobwork.schemas.ts`, replacing the dead `stepCharge`
    (`:52`), with the same "keep the two in step" note. The server figure is authoritative.
- **`ReceiptDetail.tsx`** — show the stored breakdown per row; drop `rateBasis`.
- **`JobOrderOverview.tsx`** — per step: accepted, running **landed cost per accepted unit**
  `Σ(material × accepted ÷ (accepted + rework) + charge) ÷ Σ accepted` from the stored snapshots; still
  at processor per input item; after completion, **loss qty and value** per input item. Complete step
  explains that the remainder will be written off, and lists blocking drafts.
- Every new control follows CLAUDE.md: shared controls, Tab order, 44px targets, walked at 390 / 768 /
  desktop.

## 7. Migrations

🔴 Prod, staging and dev share one database. A migration applied from any environment is applied to
all of them. Migrations are not transactional: add before backfill, backfill before drop, `IF EXISTS`
throughout.

**Pre-flight — read-only, run and review before writing any code that refuses legacy steps.**

```sql
-- 1. Open steps that V1 would refuse: several input items, a non-composite output
SELECT jo.job_order_number, s.seq, s.process_name_snapshot
FROM job_order_steps s
JOIN job_orders jo ON jo.id = s.job_order_id AND NOT jo.is_deleted
                  AND jo.status NOT IN ('completed', 'short_closed', 'cancelled')
WHERE NOT s.is_deleted AND s.status NOT IN ('completed', 'short_closed')
  AND (SELECT count(DISTINCT i.item_id) FROM job_order_step_inputs i
       WHERE i.job_order_step_id = s.id AND NOT i.is_deleted) > 1
  AND EXISTS (SELECT 1 FROM job_order_step_outputs o JOIN items it ON it.id = o.item_id
              WHERE o.job_order_step_id = s.id AND NOT o.is_deleted
                AND it.item_structure <> 'composite');

-- Same joins for the rest:
-- 2. V3: one input, an output whose uom_id differs from the input's, and more than one output
-- 3. V4: a step that already has a posted challan, with an input row lacking planned_qty
--    or an output row lacking expected_qty — it can never be costed and can no longer be re-planned
-- 4. rate set and rate_basis = 'per_issued_unit' — the charge changes meaning
-- 5. steps with more than one output whose primary expected_qty equals the planned input — the §6.3
--    default trap, already stored; fix Expected while the step is still editable
-- 6. negative ledger balances at processor locations — the footprint of bug 1 (§6.0); each needs a
--    correcting movement before the new engine values anything from that batch
```

**Decision for rows from 1–3:** complete or close them short **under the current code** before release.
Their steps are locked by their documents, so they cannot be re-planned, and the new receipt path refuses
them with "This step was planned before landed costing — complete it or close it short" rather than
keeping a second cost engine alive.

**Migration 1 — `landed_cost`** (additive): add the §5.1 columns → create
`job_order_step_output_components` + indexes + FKs → enable RLS + guarded policy → backfill:

```sql
-- a. the step's rate moves to its primary output, only where the meaning survives:
--    basis per_received_unit, or input and output in the same unit
UPDATE job_order_step_outputs o SET rate = s.rate
FROM job_order_steps s
WHERE o.job_order_step_id = s.id AND o.is_primary AND NOT o.is_deleted
  AND o.rate IS NULL AND s.rate IS NOT NULL
  AND (s.rate_basis = 'per_received_unit'
       OR o.uom_id IS NOT DISTINCT FROM (SELECT i.uom_id FROM job_order_step_inputs i
                                         WHERE i.job_order_step_id = s.id AND NOT i.is_deleted
                                         ORDER BY i.seq LIMIT 1));
-- same for route_step_outputs ← route_steps. Rows left NULL are listed for re-entry by hand.

-- b. a row that inherited the step's tolerance keeps it once the step column is gone
UPDATE job_order_step_inputs i SET tolerance_pct = s.tolerance_pct
FROM job_order_steps s
WHERE i.job_order_step_id = s.id AND i.tolerance_pct IS NULL AND s.tolerance_pct IS NOT NULL;
```

Items start with no default tolerance — a process-wide percentage says nothing about which item it
suited. No backfill of receipt snapshots: posted receipts keep their ledger values, and their breakdown
was never recorded.

**Migration 2 — `drop_step_rate_tolerance_and_basis`** (separate release, after the code is live and the
backfills checked): **re-run backfills a and b first** — both are idempotent, and they catch rows the old
code wrote between the two releases — then drop the eight §5.1 columns, with
`-- @destructive-ok: rate moved to output rows and tolerance to input rows in <migration 1>`.

Both through `db:draft` → edit → `db:promote` → `db:apply`. Verify by replay, not by drift. §6.0 needs no
migration.

## 8. Tests

**New — the two bugs (§6.0)**, in the issue and receipt suites:

1. Cancelling a challan after a posted receipt consumed it is refused; after that receipt is cancelled, it is allowed.
2. Two receipts posted concurrently against one challan — the second sees what the first consumed.

**New — `jobwork.landedCost.test.ts`**, fixtures from `src/db/testTenant.ts`:

3. Example A — two partial receipts both ₹22.53; completion writes off nothing.
4. Example B — completion scraps 31.5789 m for ₹315.79; the processor balance is exactly 0; the loss groupBy returns it.
5. Example C — the cap; no negative balance.
6. Example D — values follow the fabric; conservation to the paisa.
7. Example E — composite of a composite; fabric and buttons each take their own `k`; plus the cycle refusal.
8. Example F — a unit change through planned ÷ expected, with no yield set.
9. Example G — a typed Used figure wins; above outstanding it is refused; a draft keeps it; a draft saved before any output is typed still posts against its challans.
10. Expected — not defaulted on a multi-output step; defaulted on a single-output step as today.
11. V1–V3 refusals on create and on the update tail; a locked legacy step is not re-validated.
12. V4 — posting a challan against an incomplete plan is refused; a draft challan and a rework challan are not.
13. R9 — receipt, issue, receipt cancel and challan cancel on a completed step refused; completion with drafts refused.
14. Rework — a rework receipt consumes the output item at `k = 1`; charge only on accepted; mixed challans refused.
15. Customer-owned — every ledger value 0, loss quantity still written off.
16. The recipe edited after the order was created does not change consumption.
17. Close short writes off every open step.

**New — tolerance**, in the job order / issue suites:

18. A row picks up its item's tolerance; a typed value wins; a blank row is filled by the server.
19. Editing the item's tolerance afterwards does not change an existing order's row.
20. The over-issue ceiling reads the row alone; a row with no percentage is unchecked.

**Update:** `jobwork.flow.test.ts` (the `rate: 12 / 4 / 3` steps, `tolerancePct: 5` on a step, and both
conservation tests), `jobwork.drafts.test.ts`, `jobReceipts.batches.test.ts`,
`jobReceipts.batchUnits.test.ts`, `jobIssues.value.test.ts`, `jobIssues.batchUnits.test.ts`,
`jobOrders.planBatchUnits.test.ts`, `processes.service.test.ts`, the assemblies ledger tests for composite
components, `rls.test.ts`. Fixtures that issue against a step without planned / expected quantities now
need them (V4).

The suite is nondeterministic under parallel load — re-run a red file alone before blaming a change. The
concurrency test (2) is the one place where that is the point: it must drive two transactions on purpose.

## 9. Order of work

| Phase | Work                                                      | Ships           |
| ----- | --------------------------------------------------------- | --------------- |
| 0     | Pre-flight queries; close legacy open steps               | before anything |
| 1     | The two bugs — cancel guard and step lock (§6.0)          | alone, first    |
| 2     | Multi-level composites + cycle check (§6.1)               | alone           |
| 3     | Migration 1                                               | ─┐              |
| 4     | Item-wise tolerance (§6.2)                                | │               |
| 5     | Process / route / job order cost fields (§6.3)            | │               |
| 6     | The plan check at issue (§6.4)                            | ├ one release   |
| 7     | Receipt engine (§6.5)                                     | │               |
| 8     | Completion write-off + guards (§6.6)                      | │               |
| 9     | Frontend (§6.7) + tests (§8)                              | ─┘              |
| 10    | Migration 2                                               | a later release |
| 11    | Edit §9 of the domain map, the walkthrough, field sources | after 9         |

Item-wise tolerance only needs Migration 1's `items` column and backfill b, so phase 4 can be pulled
forward into its own release if it is wanted sooner.

## 10. Known limits — deliberately out of scope

Reviewed 2026-09-14. None of these changes a calculated cost or a stock quantity; each is a later piece of
work, not a hole in this one.

**Costing and compliance**

- **Freight** to and from the processor is not part of landed cost (IAS 2 ¶10 would include it).
- **The processor's bill is not matched** to the rate. What the receipt capitalised and what is paid can
  differ unnoticed; there is no price-difference handling.
- **Planned vs actual loss is not reported.** Normal loss is whatever each order's Expected says — per
  order, not a standard per item or process as SAP keeps it — so an inflated Expected would move real
  waste into stock value unseen. The report that would catch it is not built.
- **GST job work reporting** (CGST §143, Rule 45, ITC-04) is not built. Written-off goods may need input
  tax credit reversed under §17(5)(h) — confirm with a CA. The write-off rows keep abnormal loss per
  challan line, which that work will need.
- **The accounting policy** — cost per batch, oldest challan first, averaged within a topped-up batch —
  is sound under IAS 2 ¶23–25 but is not written down anywhere yet.

**Behaviour**

- **The cost is only as good as the plan.** Left equal to planned, Expected says "no loss", and real
  shrinkage lands as job order loss at completion instead of inside landed cost. §3's warning is the only guard.
- **Waste with a sale value** (offcuts sold as scrap) is not modelled.
- **No reopening a completed step.** It would reverse the write-off rows.
- **Planned input quantities are still typed**, not derived from recipe × expected output.
- **Loss is not charged back** to the processor. A debit note is its own document.
- **A backdated receipt is valued at today's batch cost**, not the cost on its date. Only matters when the
  batch was topped up in between.

**Controls and display**

- **Completing a step needs only `job_order:update`** (`jobOrders.routes.ts:95`), though it now writes off
  stock value. ERPs usually keep scrapping behind its own permission.
- **No audit of completion** — who, when and why are not recorded on the step (only `is_completed`), and
  the write-off does not appear on the activity timeline.
- **Customer-owned (inward) job work** — the ledger values the goods at zero correctly, but the stored
  processing charge makes the Overview show a landed cost for goods that are not ours, where that charge is
  really an amount to bill.
- **Receipts posted before the release** carry no cost breakdown; the Overview's running landed cost
  averages them in as zero until those orders finish.
- **Ledger and challan balances are not cross-checked** before consuming or writing off. §6.0 removes the
  known way they drift apart.
- **The "challan not ticked" warning** says an item was capped but does not name the unticked challan.
