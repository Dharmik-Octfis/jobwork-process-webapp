# Challan closure — normal process loss inside landed cost

**Status: planned 2026-09-16, BUILT 2026-09-17 (phases 1–6).** Agreed over 2026-09-15 → 16, from the
question "what happens when the good quantity that comes back is less or more than Expected?".

🔴 **Migration `20260917043300_add_closes_challan` is applied to `jobwork_local` only**, together with
the previously pending `20260916121656_drop_item_default_tolerance`. Neither is on QC's `jobwork_dev`:
per §7, apply there only once the deployed app runs this code.

**Where the build differs from the text below:**

- `usedByItem` takes `closedFloor` as an optional **fifth** argument, not a fourth — every existing
  caller and test keeps its shape. It also returns `closedUndrawn` (R13) beside `belowFloor`.
- **R10 is also asserted** after allocation, and a posted closure of a challan that consumed nothing
  still writes one zero-quantity line carrying `closes_challan`, so the closure is always recorded (C5).
- **Posting a draft re-expresses typed figures as one bulk line per item a closure touches.** A draft
  parks typed quantities on named challan lines, which are consumed exactly as named; if another receipt
  moved the outstanding in between, they would no longer empty the closed challan.
- **R14 refuses drafts too**, and the prefill returns `closedIssues` so the Receive screen shows
  "Closed · JR-…" rather than dropping the challan like one that merely came out even. A draft that
  names a challan closed since is saved without it.
- **Below the floor is not blocked on the client**: the field is marked red and the server's refusal is
  the toast (CLAUDE.md field-error rule). Undrawn and above-outstanding keep blocking Receive as before.
- `ReceiptDetail`'s "Closes" row, which listed every challan received against, is now **Challans**, with
  the closed ones badged. The step detail joins the states it applies rather than choosing one:
  "500 m still at the processor · 300 m on closed challans".
- Test 23's allocation proof and 26's "above the floor wins" use two challans; two extra tests pin that
  a receipt without a closure still allocates oldest first, and that a draft posted after its challan's
  outstanding moved still empties it.

This is an **addition to** `JOBWORK_LANDED_COST_PLAN.md`, not a replacement. R1–R9 stand exactly as
they are; this plan adds R10–R14 and one boolean column. It fixes one thing that plan got wrong: it
books ordinary process shrinkage as **loss at completion**, when it belongs **inside the cost of the
goods**.

Every decision was settled — §0 was answered 2026-09-16.

---

## 0. Reopening — decided 2026-09-16

**Reopening a closed challan is done by cancelling the receipt that closed it.** There is no
standalone "reopen this challan" action, and none should be added.

This was the one open question when the plan was written, and it was settled in favour of
cancel-and-re-enter. The reasoning is kept because it will look like a missing feature to anyone
reading this cold:

When a challan is closed, its material is consumed and its value goes into that receipt's output
batch — which may already have moved to the next step or been sold. Reopening **without** cancelling
therefore means one of two things, and both are worse than the problem:

- **(a)** re-cost a posted receipt — which contradicts the rule the whole cost model rests on, that
  every receipt's cost is final the moment it posts (`JOBWORK_LANDED_COST_PLAN.md` §1); or
- **(b)** leave the material consumed and let the late lot arrive at **charge-only cost**, carrying no
  material value at all — a batch that silently costs too little, which is a worse bug than the one
  this plan fixes.

Cancelling is real reopening, not a workaround: `cancelJobReceipt` already reverses the consumption,
already refuses when the goods have moved on, and R10/R14 both read **posted** receipts only — so the
challan is open again the moment the receipt is cancelled, with no extra code. What this plan owes the
operator is not a button but a **clear warning at the moment of ticking** (§6.5), so nobody closes a
challan casually.

## 1. What changes, in one paragraph

A receipt may now mark any of the challans it is receiving against as **closed** — "nothing more is
coming back on this one". Closing a challan consumes **everything still outstanding on it**, instead
of only what the plan's ratio asks for. The material therefore lands inside the goods that came back,
which is where normal process loss belongs, and the completion write-off is left holding only material
that is **genuinely missing** — abnormal loss. The tick is **per challan, not per receipt**, because
one receipt routinely covers several challans and the last lot may close only one of them. Nothing
about `k` changes: it stays the plan's ratio and is simply not consulted for an item whose closed
challans ask for more.

## 2. Decisions this plan rests on

| #   | Decision                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **Closure is per challan**, not per receipt. A receipt covering three challans may close one, two or none.                                                                              |
| C2  | **`k` is never recalculated from actuals.** Closing overrides the quantity for that receipt; the plan ratio is untouched. Actuals are not known until the last lot arrives.             |
| C3  | **Closing is a deliberate tick, never a default.** A default-on checkbox would close challans wrongly on every partial receipt.                                                         |
| C4  | **Reopen = cancel the closing receipt** (§0). A closed challan cannot be received against again while that receipt stands.                                                              |
| C5  | **Closure is recorded, not inferred.** A column, even though "outstanding is zero" is derivable — the loss report must tell _deliberately closed_ from _coincidentally fully consumed_. |
| C6  | **The write-off stays.** After this plan it means what it should have meant all along: material genuinely missing. That is the abnormal loss a debit note recovers.                     |
| C7  | **Early receipts of a multi-receipt step stay valued at plan.** Only the closing receipt trues up. No moving-average system avoids this, SAP included.                                  |
| C8  | **No new concept on the job order.** Expected stays a planning estimate. This is entirely a receipt-time decision, made while the goods are physically in front of the operator.        |

Consistent with practice: a per-line "delivery completed" flag is SAP's **ELIKZ** on the PO item, and
SAP's **MB04** subsequent adjustment exists for exactly this — correcting what a subcontractor really
consumed against a BOM proposal that was wrong. Dynamics 365 calls it "Deliver remainder"; Oracle
calls it Final Close. Normal loss absorbed into good output and abnormal loss expensed is CAS-6 and
IAS 2 / Ind AS 2 ¶16(a). ITC-04 is itself challan-wise and carries a **Losses & Wastes** column, so the
GST return already assumes a challan is closed with its wastage declared rather than left open forever.

🔴 **Not verified with a CA.** The claim that booking ordinary shrinkage as a _write-off_ invites a
§17(5)(h) ITC reversal, where absorbing it into cost does not, is the compliance argument for this
work. It is reasoning from principle, not from a circular. **Get it confirmed before citing it to a
customer.**

## 3. The rules — R10 to R14

These continue the landed-cost series; code comments cite them as `landed-cost R10…R14`.

- **R10 — Closing a challan.** A receipt may mark any challan it is receiving against as closed.
  Closed means **every line of that challan is consumed to zero on this receipt**. Recorded on each
  written `job_receipt_lines` row as `closes_challan = true`. Only lines of **posted** receipts count,
  so cancelling the receipt un-closes the challan for free (R14).

- **R11 — Used, with closures.** R4 gains a floor:

  ```
  floor_i  = Σ outstanding over the closed challans' lines of item i
  used_i   = min( max( Σ need(·, i), floor_i ), outstanding_i )
  ```

  A **typed** figure still wins, but may not go below `floor_i` — closing a challan and then typing
  less than it holds is a contradiction, and is refused naming both numbers. The R4 cap warning is
  unchanged and still fires on the `need` side only; a floor is a decision, not a surprise, so it
  raises no warning.

- **R12 — Allocation order.** `allocateConsumption` currently walks open lines **oldest first** within
  one item (`jobReceipts.service.ts:1403`). That is no longer sufficient: closing a _newer_ challan
  while an older one stays open would spend the quantity on the older one and leave the closed challan
  still holding stock. The order becomes:

  1. lines of **closed** challans, each to zero, oldest first among themselves;
  2. then every other open line, oldest first, exactly as today.

  🔴 Without this, ticking Close does not actually close anything. It is the one change in this plan
  that sits in the cost path.

- **R13 — Nothing to carry its value.** Closing a challan whose item **no output on this receipt draws
  on** is refused — the same condition R4 already refuses for a typed Used (`landedCost.ts:147`,
  `undrawn`). There is nowhere for the value to go.

- **R14 — Reopening.** A challan closed by a posted receipt is refused on any later receipt of that
  step, naming the receipt that closed it. Cancelling that receipt reverses its consumption and the
  challan is open again — because `closedQtyByIssueLine` and R10 both read **posted** receipts only.
  There is no standalone reopen (§0, C4).

**Unchanged by this plan:** R1–R9, `k`, the recipe snapshot, the conservation assertion (R7), the
completion write-off (R8) and the completed-step guards (R9). A closed challan simply has nothing
outstanding by the time R8 runs, so the write-off finds nothing to scrap — which is the whole point.

## 4. Worked examples (verified by hand; each becomes a test in §8)

Cotton ₹10/m throughout.

**H. One receipt, closed — the common case.** Sent 1,000 m. Planned 1,000, Expected 950 (`k = 1.052632`).
Rate ₹12. 900 m comes back good, in one receipt, challan closed.

```
Used = all 1,000 m outstanding      ₹10,000.00 material
Charge 900 × ₹12                    ₹10,800.00
                                    ──────────
                                    ₹20,800.00 ÷ 900 = ₹23.1111/m
Complete step  nothing outstanding → no loss
```

Identical to recalculating `k` from the actual 900 m — which is why C2 costs nothing in this case.

**I. Two receipts, the last one closes.** Same plan; 500 m then 400 m.

```
Receipt 1  500 m, not closed  need 526.3158 m  ₹5,263.16 + ₹6,000 = ₹11,263.16 → ₹22.5263/m
Receipt 2  400 m, CLOSED      floor 473.6842 m ₹4,736.84 + ₹4,800 =  ₹9,536.84 → ₹23.8421/m
                                                                     ──────────
                              900 m carrying   ₹20,800.00 → ₹23.1111/m blended
Complete step  nothing outstanding → no loss
```

The blended figure equals example H. The split across receipts differs — C7, and it is unavoidable.

**J. Two challans, only one closed.** JC-1 sent 500 m on 05 Sep, JC-2 sent 300 m on 09 Sep; both
ticked, nothing received before. Planned 800, Expected 760 (`k = 1.052632`). Rate ₹12.
250 m comes back; the processor says JC-2 is finished, JC-1 is not.

```
need  = 250 × 1.052632 = 263.1579 m
floor = JC-2 outstanding = 300 m          → used = 300 m   (R11)
allocation: JC-2's lines first, to zero   → 300 m          (R12)

₹3,000.00 material + 250 × ₹12 = ₹3,000.00 → ₹6,000.00 ÷ 250 = ₹24.00/m
JC-1 still shows 500 m outstanding. JC-2 shows nothing.
```

🔴 The proof that a receipt-level flag would be wrong: FIFO alone would have spent all 300 m on JC-1
— the older challan — and left the challan the operator actually closed still holding 300 m.

**K. Reopening by cancelling.** Cancel the receipt in J. Its consume rows reverse, its lines stop
counting (they are no longer posted), JC-2 shows 300 m outstanding again and may be received against.

**L. Closing something nothing is made from.** A step consuming Cotton and Buttons; this receipt's only
output is made from Cotton alone. Ticking Close on the Buttons challan is refused (R13).

**M. Closed, and still short of the ledger.** A challan closed while the processor location does not
actually hold that much stock is refused by the existing balance check in `postMovement`, before
anything posts — the same disagreement `writeOffStep` refuses at completion
(`jobOrders.writeOff.ts:107`).

## 5. Schema

```prisma
// ADD — one column, on an existing tenant table
JobReceiptLine.closesChallan Boolean @default(false) @map("closes_challan")
```

- **One boolean, no new table.** `job_receipt_lines` already carries `jobIssueId` and `jobIssueLineId`
  (`jobwork.prisma:1161`), so "which challans did this receipt close" is `any()` over its own lines.
- **No RLS work.** The table already has a policy and is already in `TENANT_TABLES`. Adding a column
  changes neither. (Contrast `job_order_step_output_components`, which needed both.)
- **Why a column at all**, when `outstanding = 0` is derivable: C5. A challan that came out exactly
  even by the plan's ratio and a challan somebody deliberately closed are the same state by quantity
  and completely different facts. The loss report's normal-vs-abnormal split depends on telling them
  apart, and so does R14's refusal message.
- **Nothing on the job order, the step, the process or the item changes.**

## 6. Code

### 6.1 Engine — `receipts/landedCost.ts`

- `usedByItem` takes a fourth argument, `closedFloor: ReadonlyMap<string, Prisma.Decimal>`, and applies
  R11. The typed branch gains the below-floor refusal; the calculated branch takes `max` before `min`.
- `UsedResult` gains `belowFloor: string[]` — typed under what closing demands — which the caller
  turns into an `ApiError` naming both quantities.
- Pure arithmetic, no database, as today. It stays the file the tests drive directly.

### 6.2 Allocation — `jobReceipts.service.ts`

- `allocateConsumption` (`:1351`) takes the set of closed `jobIssueId`s and implements R12's two-pass
  order in the bulk branch (`:1402`). The named-line branch is untouched — a named line already says
  which line it consumes.
- The comment at `:1403` is rewritten: oldest-first is no longer the whole rule.
- `closedFloorByItem` is built from `issueLines` filtered to the closed challans — no new query;
  `openIssueLines` has already read them (`:1779`).

### 6.3 Request and validation

- `jobReceipts.schemas.ts` — the create/update payload gains `closedIssueIds: z.array(z.uuid())`,
  defaulting to `[]`. Refused unless every id is also in `issueIds`.
- **Drafts persist it**, like every other draft field, so a parked receipt remembers the tick.
- R13's refusal sits beside the existing `undrawn` refusal (`:1815`) and reuses its message shape.
- R14's refusal: when resolving the ticked challans, refuse any already closed by a **posted** receipt
  of that step, naming it.

### 6.4 Cancel and completion

- `cancelJobReceipt` — **no change**. R10 and `closedQtyByIssueLine` both read posted receipts only, so
  a cancelled receipt stops closing anything by itself.
- `manuallyCompleteStep` / `shortCloseJobOrder` — **no change**. A closed challan has nothing
  outstanding, so `writeOffStep` skips it. Only the **meaning** changes: what it now scraps is
  material genuinely missing, which is what makes a later loss report worth building.

### 6.5 Frontend — `ReceiveForm.tsx`

- **"Received against" (`:1144`)** gains a per-challan **Close** control — a real `<button>` or
  checkbox, keyboard-reachable, 44px, in the row it belongs to. Ticking it shows one line of plain
  English: _"Nothing more can be received on JC-00015 unless this receipt is cancelled."_ (C3, R14).
- A **Close all** action beside the list — a job finishing normally closes every challan, and eight
  hand-ticks is how one gets missed.
- **"Material used" (`:1462`)** shows the floor and why it applies:

  ```
  Item     Still out   Used                     Value
  Cotton     480 m     [      ]  300 m          ₹3,000
                       ↳ plan needs 263.16 m
                       ↳ 300 m required by closing JC-00015
  ```

  Without the second line the figure looks invented. Typing below the floor marks the field and
  toasts the server's message — CLAUDE.md's field-error rule, no sentence under the input.

- The client mirror of R11/R12 goes beside the existing R1–R7 mirror in `jobwork.schemas.ts`, with the
  same "keep the two in step" note. The server figure stays authoritative.
- A closed challan's row reads **Closed** on later visits, not "0 still out".

### 6.6 Frontend — the other three screens

- **`ReceiptDetail.tsx`** — which challans this receipt closed, in the challan list it already renders.
- **`JobOrderStepDetail.tsx`** — the per-input line (`:259`) distinguishes three states, not two:
  still at the processor · closed · written off. Today's two conflate the first and second.
- **`JobOrderOverview.tsx`** — the Complete step warning (`:493`) must stop describing an open
  challan's remainder as certain loss once closing exists.

## 7. Migration

**`add_closes_challan`** — additive, one column, no backfill:

```sql
ALTER TABLE job_receipt_lines
  ADD COLUMN IF NOT EXISTS closes_challan boolean NOT NULL DEFAULT false;
```

`false` is right for every existing row: no receipt posted before this release closed anything
deliberately. Through `db:draft` → edit → `db:promote` → `db:apply`, as always. No RLS statement (§5).

🔴 Prod, staging and dev share one database (`JOBWORK_LANDED_COST_PLAN.md` §7), and Migration 2 of the
landed-cost work is still held back from QC's `jobwork_dev`. **Sequence this behind that release** —
do not add a third migration to the queue while the second is waiting on a deploy.

## 8. Tests

Continuing the numbering in `JOBWORK_LANDED_COST_PLAN.md` §8. New file
`jobReceipts.challanClosure.test.ts`, fixtures from `src/db/testTenant.ts`:

21. Example H — one closed receipt puts the whole ₹10,000 into 900 m at ₹23.1111; completion writes off
    nothing and the processor balance is exactly 0.
22. Example I — two receipts at ₹22.5263 and ₹23.8421, blending to ₹23.1111; no loss.
23. Example J — **the FIFO regression guard.** Closing the newer challan empties _that_ challan; the
    older one still shows its full outstanding. This test fails on today's allocator.
24. Example K — cancelling the closing receipt reopens the challan and a fresh receipt may consume it.
25. Example L — R13 refusal, closing a challan nothing on the receipt draws on.
26. R11 — a typed Used below the floor is refused, naming both quantities; above the floor it wins.
27. R14 — receiving again against a closed challan is refused and names the receipt that closed it.
28. A draft remembers its closures across save and reload, and posts with them.
29. Conservation (R7) still holds to the paisa on a closed receipt.
30. Customer-owned — closing posts every value at 0 and still empties the challan.

**Update:** `jobReceipts.landedCost.test.ts` and `landedCost.test.ts` for the new `usedByItem`
signature; `jobwork.flow.test.ts` where it asserts what is left at a processor.

The suite is nondeterministic under parallel load — re-run a red file alone before blaming a change.

## 9. Order of work

| Phase | Work                                                                                 | Ships         |
| ----- | ------------------------------------------------------------------------------------ | ------------- |
| 0     | ~~Answer §0~~ — decided 2026-09-16, reopen = cancel                                  | done          |
| 1     | Migration (§7), behind landed-cost Migration 2                                       | first         |
| 2     | Engine R11 + allocator R12 (§6.1, §6.2) + tests 21–23                                | ─┐            |
| 3     | Request, validation, R13/R14 guards (§6.3) + tests 24–30                             | ├ one release |
| 4     | `ReceiveForm` (§6.5)                                                                 | │             |
| 5     | The other three screens (§6.6)                                                       | ─┘            |
| 6     | Edit `JOBWORK_LANDED_COST_PLAN.md` §3 and §10, the domain map §9 and the walkthrough | after 5       |

Phase 2 alone changes costing, so it must not ship without phase 3's guards.

## 10. Known limits — deliberately out of scope

- **Early receipts stay at plan cost** (C7). A step received in five lots has four at the planned rate
  and one absorbing the difference. Only lot-level re-costing fixes it, and D8 forbids that.
- **No reason code on a closure.** "Fabric shrank" and "processor kept the offcuts" both read as
  Closed. The loss report will want the distinction; this plan does not add it.
- **No standalone reopen** (§0).
- **The write-off still needs a reason code** to be worth reporting on — carried over from
  `JOBWORK_LANDED_COST_PLAN.md` §10, and now the more valuable half of the pair.
- **Planned vs actual loss report** and the **debit note** are still unbuilt. This plan makes their
  input data honest; it does not build them.
- **ITC-04 / §143** unchanged and still unbuilt.
- **Closing does not check the processor's delivery note.** Nothing reconciles what they say they
  consumed against what closing consumes; the typed Used box remains the only way to record their
  figure.
