# Dynamic Custom Fields — Concept & Learning Guide

**Project:** Production Monitoring & Inventory Management (multi-tenant SaaS)
**Audience:** Engineering (all levels), Product Management, Tech Lead, HOD
**Purpose:** Explain — in plain language, assuming zero prior knowledge — how per-organization
custom fields work, how the industry solves this, and which traps kill this feature.
**Status:** Explainer / background reading. **Not** an implementation spec.
**Companion doc:** `DYNAMIC_CUSTOM_FIELDS_IMPLEMENTATION_PROMPT.md` (the buildable plan)
**Last updated:** 2026-07-16

---

## 0. Read this first

This document teaches the **concept**. It answers "what is this and why is it built this way."

It does **not** tell you what to type. When you are ready to build, read the companion doc.

Worked example throughout: the **Purchase Order** module. It has 5 fixed fields that every
organization gets. We want each organization to add their _own_ extra fields — "Truck Number",
"Gate Pass No", "Delivery Terms" — with real data types and rules, without us writing code for each
customer.

> **Note on current state (2026-07-16):** the Purchase Order module **does not exist yet** in this
> repo. There is no model, controller, route, or form component for it. The only backend modules are
> `auth`, `invitations`, `master-data`, and `organizations`. This document therefore describes a
> design to be built, not code to be read. That is a good position to be in — this is far cheaper to
> design correctly now than to retrofit later.

---

## 1. The core idea (the only thing you must understand)

Today you think of a form as **a fixed thing the code decides**. Five fields, hardcoded, identical
for every customer.

We want a form that is **a description stored in the database**, which the code reads and obeys.

The mental shift:

> **Today:** the code says "there are 5 fields."
> **Tomorrow:** the database says "Org A has 8 fields, Org B has 12 fields," and the code renders
> whatever it is told.

Once you make that shift, **adding a field stops being a programming task**. It becomes one row
inserted into a table — done by the customer's own admin, through a settings screen, at 3 AM on a
Sunday, with no deploy from us.

That sentence is the entire goal of this feature. Everything else in this document is the machinery
that makes it safe.

---

## 2. The one distinction that matters: the recipe vs the meal

This is the most important concept here. People new to this always mix these up, and mixing them up
is what makes the feature collapse.

There are **two completely separate things**:

|              | The **recipe** (metadata)                                                                            | The **meal** (data)                    |
| ------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------- |
| What it is   | "This org's PO form has a field called Truck Number, it's text, it's mandatory, it prints, it's 3rd" | "PO-1042's truck number is GJ-01-1234" |
| It describes | The _shape_ of the form                                                                              | The _actual value_ a user typed        |
| How many     | A few dozen **per organization**                                                                     | **Millions** — one set per record      |
| Changes      | A few times a year                                                                                   | Constantly                             |
| Lives in     | Its own table (`custom_field_definitions`)                                                           | A JSONB column on the record           |

The recipe describes the shape. The meal fills the shape.

**Keep them in separate places and this feature stays sane for years. Mix them together and you will
be in pain forever.**

Everything below follows from this split.

---

## 3. Where does the data physically go? (three options, two are traps)

You have a `purchase_orders` table. Org A wants "Delivery Terms". Org B wants "Truck Number" and
"Gate Pass No". The values have to be stored _somewhere_. There are only three real answers.

### 3.1 Option A — Add a real column per field ❌

When Org A adds "Delivery Terms", the app runs `ALTER TABLE purchase_orders ADD COLUMN delivery_terms TEXT`.

| Pros                       | Cons                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Simple to imagine          | **Postgres has a hard limit of 1,600 columns.** 200 orgs × 10 fields = you hit a wall you cannot code around                                     |
| Real SQL types and indexes | Org A's column is dead weight in every one of Org B's rows                                                                                       |
| Real DB constraints        | `ALTER TABLE` takes a **lock** — one admin clicking "Add Field" can freeze the table for every other org                                         |
| —                          | **Prisma generates its client from a static schema file.** It cannot know about columns created at runtime. Your ORM goes blind to your own data |
| —                          | User input generating DDL is a risk category you never want                                                                                      |

**Verdict: never, in a shared multi-tenant database.** (Odoo does this — but Odoo is typically one
database per customer, a completely different situation from ours.)

### 3.2 Option B — EAV, one row per value ❌ for us

"Entity-Attribute-Value": each custom value becomes its own row.

| po_id | field_key      | value_text | value_number | value_date |
| ----- | -------------- | ---------- | ------------ | ---------- |
| PO-1  | delivery_terms | FOB Mumbai | null         | null       |
| PO-1  | truck_no       | GJ-01-1234 | null         | null       |
| PO-2  | delivery_terms | CIF        | null         | null       |

This is the textbook academic answer and it genuinely works — Magento is built on it.

| Pros                            | Cons                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Per-value foreign keys possible | Displaying **one** PO with 10 custom fields = 1 row + 10 rows to fetch, group, and stitch back together |
| Real DB constraints per value   | A list of 50 POs = **500 extra rows**                                                                   |
| No column limit                 | Filtering is brutal: each condition needs its own self-JOIN. Three filters = three JOINs                |
| —                               | Query planners hate it, and so will you                                                                 |

**Verdict: correct, but heavy.** Choose it only if you need hard database constraints on each value.
We don't.

### 3.3 Option C — One JSONB column ✅ **this is our choice**

Add **one single column** to `purchase_orders`:

```
custom_fields  JSONB  NOT NULL  DEFAULT '{}'
```

And inside it, per row:

```json
{
  "delivery_terms": "FOB Mumbai",
  "truck_no": "GJ-01-1234",
  "gate_pass_no": 4471,
  "inspection_done": true,
  "expected_at": "2026-08-01T09:30:00Z"
}
```

Org A's rows carry Org A's keys. Org B's rows carry Org B's keys. **Nobody pays for anybody else's
fields.**

| Pros                                                                                                                                                                   | Cons                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| We are on **PostgreSQL** (`prisma/schema/schema.prisma:14`). JSONB is a first-class type — binary, parsed, **indexable**, queryable. This is not "dumping a text blob" | **The database stops being your validator.** It will happily store `"hello"` where a number belongs |
| **Prisma 7 supports `Json` natively** — no fighting the ORM                                                                                                            | Sorting/filtering needs deliberate handling (§8)                                                    |
| One row = one PO. Reading a PO is still a **single-row read**                                                                                                          | Values are stringly-typed until the app parses them                                                 |
| **Existing list queries do not change at all** (§8)                                                                                                                    | —                                                                                                   |
| Zero schema change when an org adds a field                                                                                                                            | —                                                                                                   |

**Decision: JSONB.** The one thing we give up — database-enforced typing — we were always going to
handle in the app anyway, because we already use **Zod 4** and validation must be metadata-driven
regardless. It is the right trade.

---

## 4. Does the database need to migrate?

**Yes — exactly once. Then never again.** This is the entire payoff of the design.

**The one migration** creates:

1. The `custom_field_definitions` table (the recipe).
2. The `custom_fields JSONB NOT NULL DEFAULT '{}'` column on `purchase_orders` (the meal).
3. A GIN index on that column (§8.2).

**After that, adding a field for an organization is an `INSERT`, not a migration.**

That is the whole point. Org A's admin adds "Truck Number" → one row goes into
`custom_field_definitions`. No `ALTER TABLE`. No deploy. No downtime. No lock. Org B's data is not
touched, not read, not even aware. A thousand orgs adding a thousand fields = a thousand INSERTs into
one table. **The structure of `purchase_orders` never changes again.**

### 4.1 The blocker that used to be here — resolved 2026-07-16 ✅

Until 2026-07-16 there were **no migrations at all**: tables were created by hand in pgAdmin and
`prisma/migrations/` did not exist. Hand-written SQL for a two-table auth system is survivable;
hand-written SQL for a metadata-driven field engine, across environments, is not. So it was fixed
before this feature starts.

The database is now baselined (`prisma/migrations/0_init/`), `_prisma_migrations` exists, and
`prisma/sql/` is gone. **Every schema change now goes through `npm run db:migrate`.** See
`docs/PRISMA.md` §8 for the full account and for how to bootstrap a fresh database.

Two lessons from that exercise are worth carrying into this feature:

- **A baseline records "the database already looks like this."** Baselining a schema that does _not_
  match reality bakes a lie into every future migration. Two drift points had to be fixed first —
  including a live bug where `Invitation.organizationId` was declared TEXT while the column was
  `uuid`. **`prisma validate` passed it**, because Prisma compares only its own types (`String` ==
  `String`) and never sees the native mismatch. Postgres caught it at runtime instead.
- **`migrate dev` is allowed to reset the database** (`docs/PRISMA.md`). On a shared dev database with
  colleagues' data, that is a live grenade. The baseline was generated with `migrate diff`, which is
  entirely offline, and marked applied with `migrate resolve`. Nothing was ever executed against the
  existing database except one bookkeeping row.

---

## 5. How the big companies actually do it

Reassuringly, **every one of them landed on the same shape: a recipe table + value storage separate
from the core columns.** Nobody runs `ALTER TABLE` per customer.

### 5.1 Salesforce — the origin of this pattern

Salesforce's multi-tenant architecture (published in their well-known whitepaper) stores _everything_
in a handful of giant generic tables. There is an `MT_Data` table with columns literally named
`Value0` through `Value500`, all `VARCHAR`. A metadata layer says "for Org 00D5, `Value17` means
Truck Number and it's a Number." They then maintain separate **pivot tables** purely to make indexing
and uniqueness work. It is ugly and brilliant.

**The lesson to steal:** Salesforce splits **Label** (what you see, freely renameable) from
**API Name** (immutable, what code and stored data reference). Rename the label a hundred times; the
API name never moves. → _This is our `key` column._ It is the single most valuable idea in this
document.

### 5.2 Zoho CRM — relevant to us (we deploy on Zoho Catalyst)

Same model: fields defined per-org, plus a **Layout** concept — the same field can appear on one
layout and not another. Also label vs API name.

### 5.3 Shopify — Metafields

`namespace` + `key` + `type` + `value`, attachable to any object. The **namespace** stops an app's
field colliding with a merchant's field. Steal this only if we ever let third parties define fields.

### 5.4 Jira — the most sophisticated model

Jira separates **three** concepts:

- **Custom Field** — the definition.
- **Context** — which projects / issue types it applies to.
- **Screen** — which forms it appears on.

This is why a Jira field can exist but not appear on your form. If we later need "this field applies
to Job Work POs but not Purchase POs," we are re-inventing Jira Contexts — which is why our
definition table has an `entity_type` column from day one.

### 5.5 Stripe / HubSpot — the minimum viable version

A `metadata` object: free-form JSON key/value, capped (Stripe: 50 keys, 500 chars each).
Deliberately dumb — no types, no validation, not queryable. **This is what you ship if you need it
done in a week.** Worth knowing as the fallback.

### 5.6 Airtable / Notion — the maximal version

No fixed fields at all; _everything_ is a definition. Total flexibility, and the price is that they
can barely offer traditional reporting, because nothing is guaranteed to exist.

### 5.7 The universal pattern

| Everybody does this                    | Nobody does this                          |
| -------------------------------------- | ----------------------------------------- |
| A metadata table describing fields     | Per-tenant `ALTER TABLE`                  |
| Immutable internal key ≠ display label | Hard-deleting field data on field removal |
| Values stored apart from core columns  | Trusting the client to validate           |
| Soft-delete / archive                  | Freely changing a field's data type       |
| Hard caps on field count               | Unlimited unindexed filtering             |

---

## 6. The design in shape

### 6.1 The recipe table

Conceptually (exact Prisma in the companion doc):

```
custom_field_definitions
  id                (uuid, PK)
  organization_id   → which org owns this field
  entity_type       → "purchase_order" (reusable for invoices, etc. later)

  key               → "truck_no"  — IMMUTABLE, never changes, never reused
  label             → "Truck Number" — freely renameable
  data_type         → TEXT | NUMBER | DECIMAL | CHECKBOX | DATE | ...
  config            → JSON: options list, min/max, precision, regex...

  is_required       → mandatory?
  show_in_print     → appears on the printed PO?
  show_in_list      → appears as a list column?
  is_filterable     → allowed in filters? (§8.2 — this is a cost control)
  display_order     → position on the form

  status            → active | hidden | archived  (never DELETE — §7.2)
  created_at, archived_at
```

The `config` column is deliberately loose JSON, because each data type needs different settings and
we don't want 20 nullable columns:

```json
// DECIMAL
{ "precision": 2, "min": 0, "max": 999999 }

// TEXT
{ "maxLength": 100, "regex": "^GJ-\\d{2}-\\d{4}$" }

// SELECT / MULTI_SELECT
{ "options": [
    { "id": "opt_a1", "label": "Urgent",   "order": 1 },
    { "id": "opt_b2", "label": "Standard", "order": 2 }
] }

// ATTACHMENT
{ "maxSizeMb": 10, "allowedTypes": ["pdf", "jpg", "png"], "maxCount": 3 }
```

Note the dropdown options have **`id`s, not just labels**. §7.3 explains why this matters enormously.

### 6.2 The meal

```
purchase_orders
  id, organization_id

  po_number      ─┐
  vendor_id       │  the 5 fixed fields — real, typed, indexed columns
  order_date      │
  status          │
  total_amount   ─┘

  custom_fields  JSONB DEFAULT '{}'   ← everything custom lives here

  created_at, updated_at
```

**Keep the 5 fixed fields as real columns. Do not get clever and make everything dynamic.**

Fields that _every_ org has, that our business logic actually reads — status transitions, totals, PO
number uniqueness — belong in real typed columns with real indexes. JSONB is for the **long tail that
varies by customer**. Every serious product draws this line: Salesforce has a real column for Account
Name and custom fields for the rest.

---

## 7. What happens to the data — the questions that decide success or failure

This section is where this feature either works or turns into a permanent support disaster.

### 7.1 A field is ADDED — what about the 5,000 old purchase orders?

An org has 5,000 POs from the last two years. Today an admin adds "Truck Number", **mandatory**.

Those 5,000 old POs have no truck number. **They never will.** The truck left two years ago. Nobody
remembers. The data does not exist in the universe.

> **Adding a field changes the recipe. It does not change the meals already cooked.**

The `custom_fields` column on all 5,000 old rows still holds `{}`. Nothing is written to them.

**Do not backfill.** There is nothing truthful to backfill _with_. Writing `""` or `0` into 5,000
rows is us **inventing data nobody entered** — which is worse than having no data, because now it
looks real.

Three consequences to handle deliberately:

#### (a) "Mandatory" only means mandatory _going forward_

A required field cannot apply retroactively. Validation runs on save; old records aren't being saved,
so they're never validated. They are grandfathered. This is correct, and it's what every product does.

#### (b) The trap: what happens when someone EDITS an old PO?

A user opens PO-0042 from 2024 to fix a typo in the vendor name. The form now has a mandatory Truck
Number that is empty. **Save is dead. The user is stuck and cannot fix the typo.** They file a ticket.
We have no good answer.

Pick a policy consciously and write it down:

| Policy                                                                 | Effect                                                                                 | Verdict                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| **(a)** Enforce on any save                                            | Forces the user to invent a truck number → they type **"N/A"** → data polluted forever | ❌ Feels rigorous, produces the worst data |
| **(b)** Enforce on create; on edit only if already filled              | Old records stay editable                                                              | ✅ **Recommended**                         |
| **(c)** Store `required_since`; enforce only for records created after | Cleanest semantically                                                                  | ⚠️ More code — do it if compliance demands |

**Go with (b)** unless there is a compliance reason not to.

#### (c) Missing ≠ empty. This is not pedantry.

| Stored     | Means                                               | Show as                 |
| ---------- | --------------------------------------------------- | ----------------------- |
| key absent | The field didn't exist when this record was created | `—`                     |
| `null`     | Field existed, user left it blank                   | `—` (or "Not provided") |
| `""`       | User typed nothing into a text box                  | `—`                     |
| `0`        | User genuinely entered zero                         | `0`                     |
| `false`    | User genuinely unchecked the box                    | `No`                    |

If you render `0` for a missing number, or `No` for a missing checkbox, **you are lying to the user.**
A PO from 2024 will display "Inspection Done: No" — and someone will act on that. The inspection did
not fail; the _concept_ of inspection did not exist yet. That distinction can matter legally.

> **Rule for the code:** check `key in obj`, never `if (obj[key])`. In JavaScript `0`, `""`, and
> `false` are all falsy — and all three are real answers a user gave.

### 7.2 A field is REMOVED — the big one

**Never hard-delete. Not the definition, not the data.**

If we `DELETE` the definition and strip the key from 5,000 JSONB rows:

- Every historical PO silently loses data that appeared on a **legally issued commercial document**.
  We may be obliged to reproduce it years later.
- It is **irreversible**. Twenty seconds later the admin says "wrong field, undo" — and we have nothing.
- Reprinting a 2024 PO now produces a document that **does not match the paper copy the vendor has in
  their file**. That is a genuine commercial dispute waiting to happen.

**Use three states instead:**

| Status     | On the form? | Old values kept? | Visible on old records? | Reversible?  |
| ---------- | ------------ | ---------------- | ----------------------- | ------------ |
| `active`   | ✅           | ✅               | ✅                      | —            |
| `hidden`   | ❌           | ✅               | ✅                      | ✅ instantly |
| `archived` | ❌           | ✅ (in DB)       | ❌                      | ✅ by admin  |

**`hidden` is the honest answer to "remove this field."** Stop collecting it; keep showing what was
already collected. The JSONB data is never touched — we just stop rendering the input.

Two UX rules that prevent the worst tickets:

- **Confirm with a count:** _"This field has data on 4,812 purchase orders. Those values will be
  hidden from all records including printed documents. Continue?"_ The **count** is what makes an
  admin stop and think.
- **Offer a CSV export before archiving.** Costs an afternoon; saves the worst support ticket we will
  ever get.

### 7.3 The single nastiest bug in this whole feature 🔥

Read this twice.

1. Org archives "Truck Number" (`key = truck_no`). 5,000 POs still hold `{"truck_no": "GJ-01-1234"}`.
2. Six months later a **different** admin adds a new field, also labelled "Truck Number". The slug
   generator produces… `truck_no`.
3. **5,000 old POs instantly appear to have the new field already filled in** — with data from a
   deleted field, that nobody entered into this field. Worse: if the new "Truck Number" is a NUMBER
   type and the old values are text like `"GJ-01-1234"`, **every read of those rows now throws.**

Ghost data resurrects. It looks completely legitimate. Nothing in the logs explains it.

**Three defenses — use all three:**

1. **The uniqueness check must include archived fields.** A unique constraint on
   `(organization_id, entity_type, key)` does this automatically _as long as we never delete the
   archived row_. This alone blocks the bug — the second field is forced to `truck_no_2`.
2. **Never allow key reuse. Ever.** Not even years later.
3. **Never allow a data-type change on an existing field.** Text → Number sounds harmless until you
   meet the 5,000 rows containing `"GJ-01-1234"`. Force "archive it, create a new one." Salesforce
   permits _some_ type conversions and it is among the most feared operations on the platform. We
   just say no.

#### Design question this raises: should the JSONB be keyed by `key` or by `id`?

| Approach                     | Pros                                                  | Cons                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyed by **`id`** (uuid)     | Renames and reuse are _structurally_ impossible       | Data reads `{"a3f2b8c1-…": "GJ-01-1234"}` — unreadable in pgAdmin, undebuggable at 2 AM; every read needs a definition lookup to mean anything |
| Keyed by immutable **`key`** | Readable (`{"truck_no": "…"}`), debuggable, greppable | Safe **only** if rules 1–3 above are enforced                                                                                                  |

**Decision: immutable `key`.** It is what Salesforce and Zoho do (API Name). The safety comes from a
unique constraint the code cannot forget, and we get readable data for free. **Just never let the key
change or be reused.**

### 7.4 The same rule, one level down: dropdown options

This is why §6.1 put `id`s on options.

Store `{"priority": "Urgent"}` and the admin renames the option "Urgent" → "High Priority" — now every
old record holds a value matching no option. It renders blank or crashes the select.

Store `{"priority": "opt_a1"}` and resolve the label at render time. Rename freely; old data survives.

Same principle as label-vs-key, applied to options. **This bug is guaranteed to happen if skipped.**

---

## 8. Will this break our existing queries?

Short answer for today: **no — because we don't have any shared query helpers yet.**

Confirmed: there are no shared list/filter/pagination/search helpers anywhere in `backend/src`.
Nothing is paginated — there is no `take`/`skip` in the entire backend. The only shared query logic is
five inline `orderBy` clauses (`organizations.controller.ts:56`, `invitations.service.ts:144`,
`master-data.controller.ts:10,20,23`).

So we are not breaking anything. But here is what matters when we _do_ write those helpers.

### 8.1 The good news: JSONB is invisible to normal queries

```ts
// This is the list query. Custom fields change NOTHING about it.
await prisma.purchaseOrder.findMany({
  where: { organizationId },
  orderBy: { orderDate: 'desc' },
  take: 50,
});
```

Org A has 8 custom fields. Org B has 30. **This query is byte-for-byte identical for both.** The
`custom_fields` column rides along like any other column; `SELECT *` picks it up automatically.

**This is the core reason JSONB beats EAV for us.** With EAV this query needs a JOIN whose _shape
depends on the org_. With JSONB there is no JOIN. **The generic helper stays generic.**

### 8.2 The bad news: filtering and sorting by a custom field

Prisma supports JSON path filters on Postgres:

```ts
await prisma.purchaseOrder.findMany({
  where: {
    organizationId,
    customFields: { path: ['truck_no'], equals: 'GJ-01-1234' },
  },
});
```

It works. But **without an index this is a full table scan.** Fine at 10,000 rows. At 5 million rows
it is a 30-second query pinning a CPU core — and because we are on a **shared database**, that scan
degrades performance **for every other organization at the same moment**. One org's ad-hoc filter
becomes everyone's outage. This is the multi-tenant tax.

The fix is a **GIN index**, one index covering containment queries across all keys for all orgs:

```sql
CREATE INDEX idx_po_custom_fields
  ON purchase_orders USING GIN (custom_fields jsonb_path_ops);
```

For a specific hot field, an expression index is even better — but note it is **per-org and
per-field**:

```sql
CREATE INDEX idx_po_truck_no
  ON purchase_orders ((custom_fields->>'truck_no'))
  WHERE organization_id = 'org_abc';
```

We cannot auto-create these for every field an admin invents without landing back in "DDL at runtime"
(§3.1). **This is exactly why `is_filterable` exists on the definition:** let orgs mark a handful of
fields as filterable, cap it (~5), and treat index creation as a deliberate ops action.

### 8.3 The sorting trap

`custom_fields->>'amount'` returns **text**. Sorting text gives you `"100", "20", "3"` — because
alphabetically `"1" < "2" < "3"`. Correct numeric sorting needs a cast, and the cast **explodes** the
moment one row holds non-numeric junk:

```sql
ORDER BY (custom_fields->>'amount')::numeric   -- ERROR if any row has "N/A"
```

And a row _can_ hold `"N/A"` — from before validation was tightened, or from a type change. Which is
precisely why §7.3 rule 3 exists.

> **Never build `ORDER BY` from a raw user string.** Look up the definition, confirm it exists and
> belongs to _this_ org, read its `data_type`, emit the cast that type dictates, reject anything else.
> Building SQL from user input is how SQL injection happens, and dynamic sorting is the classic place
> it sneaks in.

### 8.4 The thing that will actually bite us — and it isn't custom fields

`docs/ARCHITECTURE_AND_TECH_STACK.md:201-217` commits to **shared database + `organization_id` column

- Postgres Row-Level Security** as two layers of defense. Schema-per-tenant and DB-per-tenant were
  both evaluated and rejected.

**Only the app layer exists. RLS is not built.**

- There is **no `tenantContext` middleware and no `req.tenantId`**. `backend/src/types/express.d.ts:8`
  has only `user?: { id, sid }` — and the comment on line 3 ("`tenantId` joins it once organizations
  and memberships exist") is now **stale**, because they do exist.
- **`runAsTenant()` does not exist.** It is referenced as future work at `backend/src/db/prisma.ts:14-17`
  and `docs/PRISMA.md:515-524`.
- **There is no base query or repository layer.** Controllers call `prisma` directly.

**So tenant isolation today is discipline-only, with no database safety net.** Every query must carry
`organizationId` in its `where` by hand. One forgotten `WHERE` leaks one org's purchase orders into
another org's screen, and nothing in the stack will catch it.

The invitations module already demonstrates the required discipline —
`invitations.service.ts:170-173` scopes an update with `where: { id: invitationId, organizationId }`
and the comment says exactly why: _"Scope the update to this org so an admin can't revoke another
org's invite by guessing an id."_ That is the standard.

**Custom fields raise the stakes**, because a leak then exposes not just data but _the shape of
another company's business process_.

#### A concrete leak this feature makes possible

Load definitions for **Org A**, then use them to parse a PO belonging to **Org B**. Same `key`,
different meaning — and we render Org B's data under Org A's labels, **with no error**, because JSONB
has no schema to complain.

> **Rule:** always fetch definitions and records scoped to the same org, in the same request, from the
> same `organizationId` variable.

---

## 9. The global flow, end to end

### Step A — An org admin defines a field (rare: a few times a year)

```
Settings → Purchase Orders → Manage Fields → [+ Add Field]

  Label:          Truck Number
  Type:           Text
  Required:       ☑
  Show in print:  ☑
  Show in list:   ☐
  Position:       after Vendor
```

Backend:

1. **Authorize.** Only owners/admins may reshape an org's forms. A regular member must never be able
   to. (`assertOrgAdmin` already exists — `invitations.service.ts:29-41`.)
2. **Generate the `key`** from the label: `"Truck Number"` → `truck_no`. **Generated once, at
   creation, frozen forever.**
3. **Check the key is free — _including against archived fields_** (§7.3).
4. **Enforce a cap** (~50 active fields per org per entity). Pick a number and enforce it on day one.
   Retrofitting a limit onto a customer who already made 300 fields is a support nightmare.
5. **INSERT one row.** Done. **No migration. No deploy.**

### Step B — A user opens the PO form (constant: all day, every day)

```
GET /api/organizations/:orgId/purchase-orders/field-definitions
```

Returns `active` definitions ordered by `display_order`. The frontend renders:

- the **5 fixed fields** (hardcoded in React — they always exist), then
- a loop over the definitions, one component per `data_type`.

```tsx
{
  definitions.map((def) => {
    switch (def.dataType) {
      case 'TEXT':
        return <TextInput key={def.id} def={def} />;
      case 'DECIMAL':
        return <DecimalInput key={def.id} def={def} />;
      case 'CHECKBOX':
        return <Checkbox key={def.id} def={def} />;
      case 'MULTI_SELECT':
        return <MultiSelect key={def.id} def={def} options={def.config.options} />;
      case 'ATTACHMENT':
        return <FileUpload key={def.id} def={def} />;
      // ...
    }
  });
}
```

> **This is the leverage.** You write **one component per data type — ~14 components, once.** Not one
> per field. Not one per org. Those 14 components serve every custom field for every organization
> forever.

Cache the definitions hard (TanStack Query with a long `staleTime` — we already use TanStack Query 5).
They change monthly at most. **But invalidate the moment an admin edits a definition**, or users will
fill in a form that no longer exists.

### Step C — The user submits (the critical step)

```json
{
  "poNumber": "PO-1042",
  "vendorId": "…",
  "orderDate": "2026-07-16",
  "status": "draft",
  "totalAmount": "15000.00",
  "customFields": {
    "truck_no": "GJ-01-1234",
    "delivery_terms": "FOB Mumbai"
  }
}
```

**The server must re-load the definitions from the database and validate against them.**

Never trust what the client sends about shape. **The client is a suggestion; the database is the
truth.** Skip this and a user can POST `{"customFields": {"anything": "at all"}}` and poison the
column with garbage the form will later choke on.

We already use **Zod 4**, so we build the validator at runtime from the definitions:

```ts
function buildCustomFieldsSchema(defs: CustomFieldDefinition[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const def of defs) {
    let s: z.ZodTypeAny;

    switch (def.dataType) {
      case 'TEXT':
        s = z.string().max(def.config.maxLength ?? 255);
        break;
      case 'EMAIL':
        s = z.email();
        break;
      case 'URL':
        s = z.url();
        break;
      case 'NUMBER':
        s = z.number().int();
        break;
      case 'DECIMAL':
        s = z.string().regex(/^-?\d+(\.\d+)?$/);
        break; // string! see below
      case 'CHECKBOX':
        s = z.boolean();
        break;
      case 'DATE':
        s = z.iso.date();
        break;
      case 'DATETIME':
        s = z.iso.datetime();
        break;
      case 'SELECT':
        s = z.enum(def.config.options.map((o) => o.id));
        break;
      // ...
    }

    shape[def.key] = def.isRequired ? s : s.optional().nullable();
  }

  // .strict() rejects unknown keys — the guard against clients smuggling in
  // fields the org never defined.
  return z.object(shape).strict();
}
```

Then strip anything not in the definitions and write the clean object to `custom_fields`. One INSERT.

#### Two storage rules that are not optional

**Money must be a string in JSON.** `15000.10` in JavaScript is a float. Round-trip enough of them and
you get `15000.099999999999`. Postgres JSONB itself stores numbers as `numeric` and is safe — but
**`JSON.parse()` in Node is not**, and that is where the money silently corrupts. Store `"15000.10"`
(a string); parse with a decimal library when computing. _This is the kind of bug that surfaces six
months later in an invoice total and takes a week to find._

**Dates must be ISO 8601, UTC.** `"2026-08-01T09:30:00Z"`. Not a locale string, not a timestamp
integer. Store UTC, render in the user's timezone. For a pure `DATE`, store `"2026-08-01"` with **no
timezone** — a delivery date is not a moment in time, it is a calendar day, and converting it to UTC
will shift it by a day for half our users.

### Step D — Print / PDF

Loop `definitions.filter((d) => d.showInPrint)`; for each, read `po.customFields[def.key]`. If the key
is missing, print `—` (§7.1c). **The template never hardcodes a field name.**

---

## 10. Summary — the whole feature in one paragraph

> Store the **shape** of the form in a definitions table (one row per field per org). Store the
> **values** in a single JSONB column on the record. Keep the internal **key immutable and never
> reused**, split from a freely-renameable label. **Archive, never delete.** Validate on the server by
> building a Zod schema at runtime from the definitions. And treat _"this field didn't exist yet"_ as
> a real and different thing from _"the user left it blank."_

### The five rules you must never break

1. **The database is the recipe, not the code.** Adding a field is an INSERT, never a migration.
2. **The key is immutable and never reused.** Label renames freely; the key never moves.
3. **Never hard-delete.** `hidden` and `archived` exist because purchase orders are legal records.
4. **The server validates from the definitions.** The client's payload is a suggestion.
5. **Missing ≠ empty ≠ zero.** Rendering `0` for absent data is lying to the user.

---

## 11. Where to go next

- **To build it:** `DYNAMIC_CUSTOM_FIELDS_IMPLEMENTATION_PROMPT.md` — the ordered, buildable plan
  with the exact schema, files, and acceptance criteria.
- **Migration baselining (the blocker):** `PRISMA.md:383-398`.
- **Multi-tenancy decision record:** `ARCHITECTURE_AND_TECH_STACK.md:201-217`.
- **Module conventions to copy:** `backend/src/modules/invitations/` — the module that matches our
  documented architecture (validateBody middleware + ApiError + a service layer). Note that
  `organizations/` does **not** follow it (inline `safeParse`, raw `error.issues` returned to the
  client, inline membership checks, no service file at all). **Copy invitations, not organizations.**
