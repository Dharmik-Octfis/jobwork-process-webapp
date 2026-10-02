# Stock Adjustment, round 2 — many items, drafts, approval

**Status: planned and BUILT 2026-10-02. Not committed, not deployed.**

Still owed:

- 🔴 **No screen has been walked in a browser** — the new form page, the reworked list and detail,
  the approval banner on the detail, and the item-page panel. Keyboard order, 390px and 768px are
  unchecked.
- Migration `20261002063459_stock_adjustment_lines` is applied to `jobwork_local` only.
- Existing permission templates do not gain `stock_adjustment:update`; an owner ticks it on.
- §7 step 7 (reports) needed no change: the reports read the ledger and the adjustment number,
  neither of which moved. `adjustments.reports.test.ts` still passes.

**Where the build differs from the text below:**

- **A failed "save and adjust" on a NEW adjustment leaves nothing behind.** The document is written
  first and adjusted second, so a refusal would have left a stray draft; it is discarded instead.
  (On an edit the changes stay saved as a draft.) The number it took is not reused.
- **The detail response carries `draftLabels`** — what the batches and packages a draft points at
  are called — because a draft stores ids.
- **"Quantity available" on the form page** comes from the stock-by-location endpoint (one request
  for every row); on the item-page panel it is the item page's stock-on-hand figure. Both are
  display only.
- **The approval history timeline is shown only when a request exists**, so an organization with no
  approval process sees no approval UI at all.
- A contract test (`adjustments.contract.test.ts`) parses real responses with the web client's
  own schemas, since the two sides share no types.

Round 1 (`STOCK_ADJUSTMENT_PLAN.md`) built one item per adjustment, posted on save. This round
reshapes it into Zoho's Inventory → New Adjustment page. Decided with the user on 2026-10-02:

| Question                  | Decision                                                            |
| ------------------------- | ------------------------------------------------------------------- |
| Many items                | One form, one API call, one transaction, one adjustment number      |
| Save as Draft             | In this round                                                       |
| Approval                  | The shared approval engine, but **stock moves only after approval** |
| Value Adjustment, Account | Still out                                                           |

## 1. What changes, in one paragraph

An adjustment becomes a header (date, location, reason, reference, description) and **lines**, one
per item, each with its own signed quantity, cost price and batches. Lines may go in different
directions on one document — a stock count corrects some items up and some down. It can be **saved
as a draft**, which holds no stock and can be edited or deleted. **Adjust** posts it — unless an
approval process is configured for Stock Adjustments, in which case it waits as _pending approval_
and posts when the last approver approves. The Adjust Stock button on the item page stays, and
creates a one-line adjustment through the same API.

## 2. Statuses

| Status             | Stock posted? | What can be done                                          |
| ------------------ | ------------- | --------------------------------------------------------- |
| `draft`            | no            | edit, delete, Adjust                                      |
| `pending_approval` | no            | approve / reject (the shared approval banner)             |
| `approved`         | no            | Adjust (no second approval), edit (back to draft), delete |
| `rejected`         | no            | edit, delete, Adjust (asks for approval again)            |
| `adjusted`         | **yes**       | Cancel (reverses the stock)                               |
| `cancelled`        | reversed      | nothing                                                   |

`approved` normally lasts an instant: approval posts the stock straight away. It is a resting state
only when that posting fails — the stock an approved decrease wanted is no longer there — so the
approval is not lost and the user sees why.

## 3. The rules that change or are added

- **B1 — One location per adjustment; one line per item.** The same item twice is refused.
- **B2 — A draft is validated lightly**: the items, the location and the date must be real. Batches
  that do not add up and a missing cost price are allowed in a draft and refused at Adjust.
- **B3 — Adjust is all or nothing.** Every line posts in one transaction or none does.
- **B4 — The approval gate fails closed.** If the approval engine errors while deciding, Adjust
  fails; it never posts unapproved. (Other modules call the engine fire-and-forget after saving,
  which is right for them and wrong for a gate.)
- **B5 — A process admin's own adjustment needs no approval** — the engine's existing rule.
- **B6 — Editing an `approved` or `rejected` adjustment returns it to `draft`**, so a changed
  document is approved again.
- **B7 — Only a posted adjustment has a quantity-before and a value.** Both are read at posting
  time, never when the draft was written.
- Round 1's rules A2–A12 and A14–A15 stand, applied per line. A13 ("no edit") now means: no edit
  **once adjusted**.

## 4. Schema

`stock_adjustments` loses `item_id`, `quantity_adjusted`, `quantity_before`, `cost_price`; they move
to a new **`stock_adjustment_lines`** (`adjustment_id`, `seq`, `item_id`, `quantity_adjusted`,
`quantity_before` nullable, `cost_price`, `value`, `draft_batches` jsonb, the audit columns).
`stock_adjustment_batches` gains `line_id`.

**Batches while unposted live as JSON on the line** (`draft_batches`) — exactly what the form sent.
No batch, package or ledger row exists until Adjust, so a draft cannot appear in any picker or
balance, and there is no draft-batch state to clean up. At Adjust the real rows are written and the
JSON is cleared.

The migration backfills a line for every existing adjustment before dropping the old columns
(`-- @destructive-ok`). RLS by hand, direct form; `stock_adjustment_lines` joins `TENANT_TABLES`.

## 5. Backend

| Route               | Permission                | Does                                          |
| ------------------- | ------------------------- | --------------------------------------------- |
| `POST /`            | `stock_adjustment:create` | create; `saveAs: 'draft' \| 'adjust'`         |
| `PUT /:id`          | `stock_adjustment:update` | replace an unposted adjustment; same `saveAs` |
| `POST /:id/adjust`  | `stock_adjustment:create` | Adjust an unposted one as it stands           |
| `DELETE /:id`       | `stock_adjustment:delete` | cancel if adjusted; delete if never posted    |
| `GET /`, `GET /:id` | `stock_adjustment:read`   | as before; `?itemId=` now matches any line    |

`stock_adjustment` gains the `update` action, which now has a meaning.

**The approval hook.** The engine changes a record's status in one place (`updateRecordStatus`),
with raw SQL. A small registry there lets a module take over that moment instead: the adjustment
module registers a handler that moves `draft → pending_approval`, posts on _Approved_, and marks
`rejected` on _Rejected_. Nothing else in the engine changes, and other modules are unaffected.

## 6. Frontend

- **New page** `/inventory/adjustments/new` and `/:id/edit`: the header fields and an item table —
  item, quantity available, new quantity on hand, quantity adjusted, cost price (increase only),
  batches (tracked items). Footer: **Save as Draft**, **Adjust**, **Cancel**.
- **List**: a New button; an Items column (first item, then "+N more").
- **Detail**: the lines; buttons by status (§2); the shared `RecordApprovalBanner` and history
  timeline, which appear only when an approval request exists.
- **Item page**: Adjust Stock opens as a PANEL in place of the item overview (the item list stays
  beside it), not as a dialog — changed on the user's request the same day. It gains Save as Draft.
- **Buttons** follow the rest of the app: blue Save-style primary and white secondary in a form
  footer, bordered buttons in a detail header (`adjustmentButtons.ts`).

## 7. Build order

1. Schema, migration with backfill, RLS, `TENANT_TABLES`.
2. Service rewrite + tests (lines, draft, edit, delete, Adjust).
3. Approval hook + tests (pending, approve posts, reject, approve-then-fail).
4. Routes, permission, HTTP tests.
5. The form page; item-page panel on the new API.
6. List and detail.
7. Reports check; docs.

## 8. Known limits

- If an approver withdraws or the request is cancelled in the approvals screen, the engine does not
  tell the record. The adjustment then treats "pending with no live request" as a draft.
- The engine approves in its own transaction and posts the stock in another. If the approving
  transaction fails after the stock posted, the two disagree. This ordering is the engine's, shared
  by every module.
