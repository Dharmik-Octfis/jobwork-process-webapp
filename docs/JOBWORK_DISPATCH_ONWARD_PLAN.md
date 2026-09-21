# Dispatch onward — goods that go straight to the next jobworker

**Status: built 2026-09-07**, same day as the plan. It reconciles two rules that already existed and
contradicted each other in one case. Kept as written — the reasoning is what a later reader needs;
§5 records what actually shipped.

**One decision taken while building:** the option is offered **whenever the picked challans agree on
where they are**, not only when a next step exists. "Finished, awaiting collection" is the same
physical fact as "going straight on to the printer", and the ledger cannot tell them apart — only the
next document can. Gating on a next step would have refused the truth for the commoner of the two.

---

## 1. The case

Dyeing finishes at Global Inc. The cloth is not collected — it goes straight from Global Inc's shed
to ABC LLP for printing. It never touches our warehouse.

This is ordinary in Indian jobwork, and GST provides for it: under **Rule 45 / §143** goods may move
from one job worker to the next on an **endorsement of the original challan**, without returning to
the principal. So the business case is real and the paperwork exists.

Today the system cannot express it, and the way it was being expressed was wrong.

## 2. What was happening instead, and why it was stopped

`ReceiveForm`'s "Received into" dropdown had lost its filter, so it offered every processor's
location and defaulted to the first one it was handed. JR-00023 (2026-09-07) therefore recorded five
bags of finished cloth **at ABC LLP** — a jobworker who had done no work on them and had received no
challan for them. Nine receipts across two orgs went in this way before it was caught.

Two things were wrong with it, and only the first is about location:

- **No document moved the goods.** The ledger said the cloth was at ABC LLP with nothing recording
  the Global Inc → ABC LLP leg. A movement between two premises is exactly what a challan is for.
- **The receipt spanned two parties.** `consume` posted at Global Inc, `produce` at ABC LLP — one
  document asserting a physical transfer it never documented.

The filter is back (`ReceiveForm.tsx`), and the rule is now on the server too
(`assertReceivableLocation`, `jobwork.refs.ts`), matching what the design already said: _"Where the
goods landed — ours again, so a godown"_ (`jobReceipts.schemas.ts`, and the same words in
`JOBWORK_CORE_WALKTHROUGH.md` §7). That is also what Zoho, Tally and SAP subcontracting do — receipt
into a location you own, vendor-to-vendor as its own transfer document.

## 3. The distinction this plan rests on

Landing goods at **an unrelated processor** is untraceable, and stays refused.

Landing them at **the processor that did the work** is not the same claim. Nothing moved — the goods
are where the challan already put them, and where this very receipt just posted its `consume` rows.
Recording that is more truthful than writing them into a godown they are not in.

The reports agree. `isExternalLocation` (`jobwork.types.ts`) already draws the line the "stock lying
with processors" report is summed from, so output standing at Global Inc counts as still out, and the
180/365-day clock keeps running — which is correct, because the goods have not come back.

## 4. The design

**One rule change, no new state.**

`assertReceivableLocation` gains the challans' own processor location as a permitted value:

```
a receipt's location is legal when it is
  · not external (Business | Warehouse | godown | shopfloor | work_centre)   — the default, unchanged
  · OR exactly the destination of the challans this receipt closes            — "it stayed there"
```

The second value is **not something the client chooses freely**. The service already derives it and
already refuses to mix parties:

```ts
// jobReceipts.service.ts — existing code, no change needed
const processorLocationIds = new Set(issues.map((i) => i.destinationLocationId));
if (processorLocationIds.size > 1)
  throw ApiError.badRequest('These challans are at different locations…');
const processorLocationId = issues[0]?.destinationLocationId ?? null;
```

So the permitted set is one godown list plus one id the server computed. ABC LLP is still refused —
it is nobody's destination on this receipt.

### Why no `keptAtProcessor` column

The location already says it. A stored flag would be a second answer to "did these come back?",
free to disagree with the ledger, and every report would then have to decide which to trust. Same
reasoning as value being derived rather than stored (§5.6): `isExternalLocation(location.type)` is
the answer, computed from the row that is actually true.

### Why the chain guard needs no change

`chainNotReady` asks one question — has a **posted** receipt on the previous step recorded
`totalReceivedQty > 0`. It does not look at where the goods landed. A receipt kept at the processor
records the same received quantity, so step 2 unlocks exactly as it does today. _(Verified against
`jobOrders.status.ts`; my earlier note that this touches the chain guard was wrong.)_

### Why step 2's issue already works

Issuing **from** a processor's location is deliberately supported. `batches.service.ts`: _"processor-
to-processor really is a valid move, so this query does not filter them out. What is never valid is
issuing from a location to the party who is already holding it."_ Step 2's challan therefore reads
Global Inc → ABC LLP, and it is that challan — not the receipt — that documents the leg. Which is
precisely the Rule 45 endorsement, expressed as a document rather than as a location choice.

## 5. Scope

| #   | Change                                                                                                                                                                                                                                      | Where                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | `assertReceivableLocation` takes `processorLocationId` and permits it; every other external location still refused                                                                                                                          | `jobwork.refs.ts`                                   |
| 2   | Call moved below the challan reads, which is where that id is derived                                                                                                                                                                       | `jobReceipts.service.ts`                            |
| 3   | Prefill carries each challan's `processorName` / `destinationLocationId` / `destinationName`                                                                                                                                                | `jobReceipts.service.ts` → `jobReceipts.schemas.ts` |
| 4   | `stayedThere` — **one named option**, never the raw processor list: "Stays with Global Inc — not collected yet", plus the warning under the field. Null when the picked challans disagree, which is the condition the server refuses anyway | `ReceiveForm.tsx`                                   |
| 5   | The document says it: a receipt into an external location carries a **Still out — not returned** badge, off `location.type`                                                                                                                 | `ReceiptDetail.tsx`                                 |
| 6   | Test: allowed at the dyer's own location (output lands there, godown stays at 0, location still reads external), refused at an unrelated jobworker's in both modes                                                                          | `jobwork.flow.test.ts`                              |
| 7   | `JOBWORK_UI_FIELD_SOURCES.md` §2.3 corrected — both location rows were wrong, in opposite directions                                                                                                                                        | `docs/`                                             |

No migration, no new column, no schema change. The default is still a godown: "it never came back"
is a fact somebody states, never one a default states for them.

### Deliberately out of scope

- **Printing the endorsement.** Step 2's challan should cite the challan it endorses ("endorsed from
  JI-00067") for the Rule 45 paper trail. That is a `printChallan` change and a field on the issue,
  worth doing, and independent of everything above.
- **Fixing the nine existing receipts.** Seven are posted, so the only correction is cancel and
  re-receive; two are drafts and will simply re-default. A separate decision.
- **The processor's own sub-contracting.** §12 open question 4 already answers this: not tracked,
  it is another party's ledger.

## 6. The risk worth stating

A receipt kept at a processor never returns the goods, so nothing closes the 180/365-day clock until
step 2's challan moves them or a later receipt brings them in. That is the true position and the
report will show it — but it means a step can read "received" while its output is still out, and the
Overview should not let those two facts blur. Point 4 above is what keeps them apart, and it is not
cosmetic.
