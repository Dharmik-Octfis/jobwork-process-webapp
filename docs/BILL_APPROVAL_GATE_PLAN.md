# Bill approval — make it a gate, and stop it overwriting the bill's status

**Status: built 2026-10-02 on `feat/stockAdjustment`. Tests pass; the screens have not been
walked in a browser yet.** What was found at build time is in §13; the rest of this file is the plan
as it was decided.

- Backend: `bills.service.ts` — `requestOpen` (the awaited gate), `openBill` (the one opening path),
  `writeBillLines`, `assertOpenable`, the G6 / G10 guards, and the registered outcome handler.
  Engine: `approvalExecution.service.ts` `evaluateApprovalRequirement` (read-only), sharing
  `matchProcess` with `evaluateAndTriggerApproval`.
- Migration `20261002074813_bill_approval_status`, applied to `jobwork_local` only.
- Tests: `bills.approval.test.ts` (§9's 1–15, plus a batch-tracked opening and a batch-tracked
  untouched re-save).

## 0. Picking this up

- **Branch.** The hook this plan relies on was committed on `feat/stockAdjustment` (`706ab31`). Build
  on a branch that contains that commit; ask the user which.
- **Read first, in this order:**
  1. `backend/src/modules/automation/approval-processes/approvalOutcome.registry.ts` — the hook.
  2. `backend/src/modules/inventory/adjustments/adjustments.service.ts` — `adjust()` and the
     `registerApprovalOutcomeHandler` call are the worked example of an approval **gate**.
  3. `backend/src/modules/inventory/adjustments/adjustments.approval.test.ts` — the test file to
     copy: it builds its own organization, users and approval process.
  4. `backend/src/modules/purchases/bills/bills.service.ts` — `createBill`, `updateBill`
     (`goingOpen`, `openingFromDocument`, `mustReverse`, `mustPost`), `reconcileBillPostings`.
- **Decided with the user on 2026-10-02:** approval gates the opening of a bill (§2), and edits to
  an Open bill follow **option B** (§4). Do not re-open either.
- **First action:** run §6's query on every database you can reach, before writing code.
- **Lint.** `approvalExecution.service.ts` carries a file-level `eslint-disable` for
  `naming-convention` and `no-explicit-any` (added in `706ab31` so the pre-commit hook would pass).
  New code in that file should still be clean.

## 1. What is wrong today

Approval on a bill is a label put on after the fact, and putting the label on damages the bill.
Found by reading the code on 2026-10-02; none of it has been reproduced by running it — reproduce
#4 and #5 in a test before fixing them, so the fix is proven.

| #   | What happens                                                                                                                                                                                                           | Where                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | **Stock moves before approval.** An Open bill posts inside `createBill`; the approval engine is called afterwards, fire-and-forget.                                                                                    | `bills.service.ts` — post at the `posting` branch, trigger after commit |
| 2   | **Rejection undoes nothing.** The stock stays on the books and can be issued.                                                                                                                                          | the engine has no call back into the bill module                        |
| 3   | **The engine overwrites `bills.status`** with `Pending Approval`, `Approved` or `Rejected` — raw SQL, over `Draft` or `Open`.                                                                                          | `approvalExecution.service.ts` → `updateRecordStatus`                   |
| 4   | **The bill code only understands `Draft` and `Open`**, so after #3 it no longer knows the bill has posted. "An Open bill never goes back to Draft" checks `status === 'open'` and does not fire on an `Approved` bill. | `bills.service.ts` — the Open → Draft guard                             |
| 5   | **An edit saved with any status but `Open` reverses the bill's stock** (`mustReverse = alreadyPosted > 0 && effectiveStatus !== 'open'`). So Save as Draft on an approved bill would take its stock off the books.     | `bills.service.ts` — `mustReverse`                                      |
| 6   | **A Draft bill is sent for approval too**, and comes back `Approved` — a status the "Open Bill" button (shown only for `Draft`) does not recognise.                                                                    | `createBill` triggers whatever the status; `BillDetail.tsx`             |
| 7   | **The bill list's filters depend on the overwrite**: Pending Approval / Approved / Rejected / Draft filter on `status`, and there is no Open filter.                                                                   | `listFilters.catalog.ts` → `bill`                                       |
| 8   | **An engine error is swallowed**, so the bill simply proceeds unapproved.                                                                                                                                              | `approvalTrigger.service.ts`                                            |

**How much data is affected.** In `jobwork_local` on 2026-10-02: no approval request has ever been
raised for a bill; all 87 live bills are `Draft` (13) or `Open` (74); no approval process is active
for any module. So nothing is damaged there. `jobwork_dev` (QC) was **not** checked.

## 2. What it should do

The same rule stock adjustments follow (`STOCK_ADJUSTMENT_ROUND2_PLAN.md`), because a bill is the
other document that brings stock onto the books:

- A bill's **`status` stays `Draft` or `Open`**, always, and means only "has it posted".
- Approval state lives in **its own column**.
- When an approval process applies, **opening a bill waits**: no stock moves until the last
  approver approves. A rejection posts nothing.
- With no process configured, nothing changes for anybody.

## 3. The rules

- **G1 — Two columns, two questions.** `status` (`Draft | Open`) is whether the stock is on the
  books. `approval_status` (`null | pending | approved | rejected`) is where the approval stands.
  Nothing writes an approval word into `status` again.
- **G2 — Approval is asked when a bill is OPENED, not when it is drafted.** Saving a draft asks
  nobody. (Today a draft is sent for approval as well.)
- **G3 — Opening waits.** If a process matches, the bill is stored as `Draft` + `pending` and posts
  nothing. Approved → it is opened, by the existing "open from the stored document" path, which
  already posts a draft's saved lines and batches. Rejected → it stays `Draft` + `rejected`.
- **G4 — The gate fails closed.** The engine is awaited; if it errors, the open is refused. It never
  posts unapproved.
- **G5 — A process admin's own bill needs no approval** — the engine's existing rule, unchanged.
- **G6 — A pending bill cannot be edited or deleted** until the request is decided. A pending bill
  whose request was withdrawn is treated as a plain draft (the engine does not notify the record).
- **G7 — Editing a rejected draft clears `rejected`**; opening it asks again.
- **G8 — Approved but could not post** (for example no receiving location): the approval is kept —
  `Draft` + `approved` — and opening it again posts without a second approval.
- **G9 — Every existing bill rule stands**: an Open bill never goes back to Draft; edits reconcile
  by difference; a used bill's rate cannot change; delete un-posts.
- **G10 — Changing the stock of an Open bill needs a process admin** when the changed bill would
  need approval. §4.

## 4. Editing a bill that is already Open — option B (decided 2026-10-02)

G3 covers the first opening. Without G10 a bill could be opened small, approved, and edited large.
The stock of an Open bill is already posted, so an edit cannot be held without a second copy of the
bill; that was option C and was rejected as too large. Option A (no re-approval at all) was rejected
because it leaves the hole open.

**The rule.** An edit to an **Open** bill that **changes its stock** is allowed only if either:

- no approval process applies to the bill as it would be AFTER the edit, or
- the person saving is a **process admin** of the process that applies.

Otherwise it is refused, nothing is written, and the message names what to do:

> This bill is open and its quantities, rates or location are covered by an approval process. Ask a
> process admin to make this change.

**"Changes its stock" is not a list of fields — it is what the reconcile finds.**
`reconcileBillPostings` already compares what the bill holds on the ledger with what the edit wants
and produces withdrawals, receipts and re-takes (a changed rate or date re-receives the position).
If all three are empty, the edit moves nothing and G10 does not apply: notes, terms, due date,
attachments and reference stay editable by anyone with `bill:update`, exactly as today. Hang the
check there rather than diffing form fields, so it cannot drift from what actually posts.

**"Would need approval" is the engine's own answer, asked without raising a request.** The engine
needs one new read-only method — the matching half of `evaluateAndTriggerApproval` (active
processes for the module, the process-admin check, trigger type, rules and criteria) returning
`{ applies: boolean; actorIsAdmin: boolean }` and writing nothing. Refactor so the existing method
calls it; do not copy the matching logic.

- It is evaluated against the bill **as edited**, so a rule like "total above ₹1,00,000" catches an
  edit that pushes a small bill over the line, and leaves a small bill small.
- A process whose trigger type is `CREATE_ONLY` still counts here: G10 is the guard that makes the
  create-time approval mean something, not a second approval flow.
- It fails closed, like G4: if the engine errors, the edit is refused.

**What it does not do.** It does not raise an approval request, change `approval_status`, or send
the bill back to Draft. An admin's edit reconciles and posts as any edit does today.

**Delete** follows the same rule: deleting an Open bill un-posts its stock, so when a process
applies to the bill it needs a process admin.

**Not built in this plan:** a screen hint that greys the lines out for a non-admin. The server
refusal with its message is the control; a hint can follow once the rule is proven.

How others do it: in Zoho Books an edited approved transaction goes back for approval; SAP and Tally
restrict who may change a posted purchase document. B is the second of those, and fits the rule
already here that an Open bill is corrected in place, never sent back to Draft.

## 5. Schema

One column: `bills.approval_status VARCHAR(20) NULL` — `// pending | approved | rejected`. No new
table, so no new RLS policy; `bills` is already in `TENANT_TABLES`. `db:draft` → trim the draft to
the one statement (this database carries unrelated drift, and `db:draft` will offer to drop it) →
`db:promote <name>` (by name: an older unacknowledged draft sits in `prisma/drafts`) → `db:apply`.

## 6. Data repair — check before, and after the column exists

```sql
-- Any bill whose status is not Draft/Open has been overwritten by the engine.
SELECT organization_id, status, COUNT(*)
FROM bills WHERE is_deleted = false AND status NOT IN ('Draft', 'Open')
GROUP BY 1, 2;
```

`bills` has RLS, so run it as the owner role or inside `runAsTenant` per organization — as the app
role with no tenant set it returns zero rows whatever is there.

Zero rows in `jobwork_local` on 2026-10-02. If another database returns rows, the migration repairs
them in this order, backfill before anything reads the new column:

1. `approval_status` ← the overwritten word (`Pending Approval` → `pending`, and so on).
2. `status` ← `Open` if the bill has live ledger rows (`stock_ledger` where
   `source_doc_type = 'bill'` nets to more than zero), otherwise `Draft`.

A bill that step 2 finds Open but whose approval was `rejected` or still `pending` is stock on the
books that nobody approved. The migration must **list** those, not decide them — whether to keep or
delete each is a business call for the user.

## 7. Backend

- **The outcome hook** (`approvalOutcome.registry.ts`). The bill module registers a handler for
  `bills`: Pending → `approval_status = 'pending'`; Rejected → `'rejected'`; Approved →
  `'approved'`, then open the bill. The engine's raw write to `bills.status` stops, because a
  registered handler replaces it.
- **`openBill`** — one function for "post this draft's stored lines", used by the status-only Open
  Bill route today and by the approval handler. It is the existing `openingFromDocument` path, given
  a name and a compare-and-swap on `status = 'Draft'` so an approval and a click cannot both post.
- **`createBill` / `updateBill` with status `Open`**: write as `Draft`, ask the engine (awaited),
  then either stop at `pending` or call `openBill`. A failed open on a brand-new bill must not leave
  a stray draft the user did not ask for — the same case stock adjustments handle.
- **Trigger sites**: the two fire-and-forget `approvalTriggerService.trigger` calls go. Draft saves
  stop triggering (G2).
- **The read-only engine method** and the G10 check in `reconcileBillPostings` and `deleteBill` (§4).
- **Guards**: `updateBill` and `deleteBill` refuse a `pending` bill with a live request (G6).
- **List filters** (`listFilters.catalog.ts` → `bill`): Pending Approval / Approved / Rejected move
  to `approval_status`; add **Open**.

🔴 `bills.service.ts` is the most complex posting path in the codebase (reconcile-by-difference,
packages, job-receipt lines, purchase-order status). The change is to WHEN `openBill` is called and
WHO may reconcile, not to how anything posts. Nothing inside the posting, reconciling or reversing
functions should need to move beyond the one G10 check.

## 8. Frontend

- `BillDetail.tsx`: the status pill shows `Draft` / `Open`, and a second pill shows the approval
  state when there is one. The approval banner and history are already there.
- "Open Bill" and Save-as-Open say what happened: _Opened_ or _Sent for approval_.
- A pending bill hides Edit and Delete, as now.
- `BillsList.tsx`: the approval state as its own column or pill; the new Open filter.
- Anything reading `bill.status === 'rejected'` (`BillDetail.tsx` does) reads the new field.
- A G10 refusal arrives as an ordinary error and is shown as a toast.

## 9. Tests

Own organization, users and approval process, hard-deleted — copy `adjustments.approval.test.ts`.

1. No process: an Open bill posts on save, exactly as today.
2. Process: Save as Open → `Draft` + `pending`, **no ledger rows**; approve → `Open`, stock posted,
   layers tie.
3. Reject → `Draft` + `rejected`, no ledger rows; edit clears `rejected`; opening asks again.
4. A draft save raises no request.
5. Pending: edit and delete refused; a withdrawn request frees it.
6. Engine throws → the open is refused, nothing posts, no stray draft on a new bill.
7. Process admin's own bill posts with no request.
8. Approved but cannot post → `Draft` + `approved`; opening again posts with no second request.
9. `status` is never anything but `Draft` or `Open` after any approval event.
10. The existing guards on an approved, Open bill: Open → Draft refused; delete un-posts.
11. **G10, a non-admin on an Open bill**: changing a quantity, a rate, the location or the date is
    refused and the ledger is untouched; changing only the notes is saved.
12. **G10, a process admin**: the same quantity change reconciles and posts; no request is raised.
13. **G10 follows the criteria**: with a rule "total above X", a non-admin may change a bill that
    stays under X, and is refused when the edit takes it over X.
14. **G10 with no process**: everyone with `bill:update` edits an Open bill as today.
15. **G10 on delete**: a non-admin cannot delete an Open bill a process applies to; an admin can.
16. Every existing bill suite still passes unchanged.

## 10. Build order

1. Run §6's query on every database.
2. Write the failing tests that reproduce §1's #4 and #5.
3. Column, migration, data repair.
4. `openBill` extracted and named — no behaviour change; existing suites must pass.
5. The outcome handler and the awaited gate in create and update; tests 1–9.
6. G6 guards and list filters; tests 5, 10.
7. The read-only engine method and G10; tests 11–15.
8. Frontend.
9. Update the docs that describe built behaviour: `PURCHASE_RECEIVED_AND_ITEMS_SPEC.md` if it states
   the bill status values, and one line in CLAUDE.md — an approval that must gate stock registers an
   outcome handler and awaits the engine.

## 11. Out of this plan

| Left out                                   | Why                                                                                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Purchase orders, items, vendors, customers | They move no stock. Approval as a label is acceptable there. Their status is still overwritten by the engine — a separate tidy-up. |
| Job issues and receipts                    | Nothing triggers approval for them today. If it is ever switched on, they need this same gate, not the label.                      |
| Assemblies                                 | Same as job issues: not triggered today.                                                                                           |
| Holding an edit until it is approved       | Option C, rejected (§4).                                                                                                           |
| A screen hint for G10                      | The server refusal is the control (§4).                                                                                            |
| The engine's two-transaction ordering      | It approves in one transaction and the module posts in another. Shared by every module; G8 is what catches a failure in between.   |

## 12. Not verified — check at build time

- Whether any screen or report other than the bill list and `BillDetail.tsx` reads an approval word
  out of `bills.status`.
- What `PurchaseOrder` "Billed" should mean for a bill that is pending: it is set when the bill is
  created today, before any of this.
- Whether the status-only Open Bill route and a full edit-save post identically for a bill with
  packages — `openBill` must be the one path both take.
- Whether the bill edit form always sends its line items even when none changed. The G10 check sits
  on the reconcile's result precisely so that this does not matter, but confirm an untouched save
  produces no withdrawals, receipts or re-takes.
- Whether the organization owner should pass G10 without being a process admin. The engine's own
  rule knows only process admins; this plan follows it. Ask the user if it comes up.

## 13. Found at build time (2026-10-02)

- **§1 #4 and #5 reproduced before the fix.** With an active process, an Open bill posted at once,
  the engine wrote `Approved` into `status`, and Save as Draft was accepted and took 200 units off the
  books. The same test (`bills.approval.test.ts` → 10) now passes.
- **§6 on both databases:** zero overwritten bills in `jobwork_local` and `jobwork_dev`, and no bill
  approval request ever raised in either. So the migration has no repair step.
- **Status is now Draft | Open at the schema too.** `bills.schemas.ts` accepts either spelling and
  refuses anything else, so a client can no longer write an approval word into `status`.
- **The read-only engine check runs outside a transaction while it introspects fields.**
  `getModuleFields` reads `information_schema` and outlived the 5 s budget of the transaction around
  it when called from inside a bill edit. `evaluateApprovalRequirement` loads processes, introspects
  and matches in separate steps. `evaluateAndTriggerApproval` keeps its old order.
- **A refused open never leaves a half-saved bill.** `assertOpenable` (location, and batches on
  every batch-tracked line) runs inside the same transaction as the save, before the engine is asked.
  So an approver is never sent a bill that could not post. A brand-new bill whose open is refused
  after that (engine error, posting error) is soft-deleted, and its PO's status is put back.
- **§12, answered:**
  - Other readers of an approval word in `bills.status`: only `BillDetail.tsx` and the list filters,
    both changed. The dashboard's "Pending Approvals" card is a hard-coded number.
  - PO "Billed": still set when the bill is created, pending or not, as before. Not decided here.
  - Status-only Open Bill and Save as Open now both save a draft and then call `openBill`. The
    existing package suites (`bills.batchUnits.test.ts`) pass through it unchanged.
  - An untouched re-save produces no withdrawals, receipts or re-takes. This is tested for untracked
    and batch-tracked lines, **not** for lines with packages.
  - Owner vs G10: not raised. G10 follows the engine, which knows only process admins.
- **Approving from the bill's own banner now also refreshes stock figures**, because approving
  opens the bill.
