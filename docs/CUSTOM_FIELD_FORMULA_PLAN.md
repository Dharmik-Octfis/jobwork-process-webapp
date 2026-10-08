# Formula custom fields — Item module

**Status: planned 2026-10-08. Nothing is built.** Every decision in §2 was made with the user in
the planning session. Do not re-open them. Line numbers were taken on 2026-10-08 from `dev` @
`f023b0eb`, so re-grep before editing.

Reference: the Zoho Books screens this copies are Settings → Preferences → Items → Custom Fields →
New Field with Data Type = Formula (Output Data Type, Formula box, Insert → Functions / Fields /
Operators, Check Syntax, Show when creating transactions, Include in Modules, Add to existing items).

## 0. Picking this up

- **Branch.** Ask the user which branch to build on. Do not create one unasked, and never commit to
  `dev` directly.
- **Read first, in this order:**
  1. `backend/src/modules/settings/customization/custom-fields/customFields.constants.ts`: the type
     catalog.
  2. `backend/src/modules/settings/customization/custom-fields/customFields.engine.ts`:
     `validateCustomFields` is the one place every module's custom values pass through on save.
  3. `backend/src/modules/settings/customization/custom-fields/custom-fields.service.ts`: the
     definition create/update/archive API.
  4. `web/src/features/custom-fields/FieldForm.tsx`: the admin form this extends.
  5. `docs/DYNAMIC_CUSTOM_FIELDS_EXPLAINED.md`: how definitions and values relate.
- **No migration.** Everything fits in columns that already exist (§4). If you find yourself writing
  a migration, stop and re-read §4.
- **Build order** is §10. Backend first, with tests, then the admin screen, then the item form, then
  the four transactions.

## 1. What it is

An org admin defines an **Item** custom field whose value is calculated from other fields on the
same item, e.g. `GST Price = selling_price * 1.18`. Users never type it. The formula is stored
**once** (on the definition). The result is stored **per item** (in that item's `custom_fields`).

**How other products do it.** Formula fields come in two designs:

- **Calculated on read and never stored:** Salesforce, Airtable.
- **Calculated on save and stored:** Zoho Books, Zoho CRM, Odoo `store=True`, NetSuite stored
  formulas.

We follow Zoho Books, so the value is **stored**. Lists, filters, print, approval criteria and
transaction lines then read it like any other field.

## 2. Decisions (made with the user, 2026-10-08)

| #   | Decision                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Item module only.** Formula is not offered, and is refused by the API, for every other module.                                                                                                            |
| D2  | **A formula cannot reference another formula field.** This keeps evaluation order-free and removes cycles.                                                                                                  |
| D3  | **Fields a formula may use** = the fields on the Item New/Edit form (§5.2) plus the item's non-formula custom fields.                                                                                       |
| D4  | **Recalculation is "only on next item save."** Editing a formula does **not** touch existing items. Each item gets the new result the next time it is saved.                                                |
| D5  | **"Add to existing items" checkbox is kept, on CREATE only.** Ticked = every existing item is calculated once, in the same save. One-time and not editable later. It is an action, not stored on the field. |
| D6  | **Transaction lines copy the item's _stored_ value** (option a). They do not calculate fresh, so the document always matches what the item page shows.                                                      |
| D7  | **Transaction lines are a snapshot taken when the document is saved.** Re-saving the document refreshes it. Later item changes never rewrite old documents.                                                 |
| D8  | **Decimal output is fixed at 2 places** (same as `selling_price` / `cost_price`). No per-field setting.                                                                                                     |
| D9  | **Transaction column sits right after "Item Details"** in the line table.                                                                                                                                   |
| D10 | **Function list** is §5.3. Accepted as is for v1.                                                                                                                                                           |
| D11 | **"Show when creating transactions" and "Include in Modules" appear only for Item + Formula.**                                                                                                              |

## 3. Behaviour, end to end

| Event                                                       | What happens                                                                                                                                                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin clicks **Check Syntax**                               | Server parses + type-checks the formula against this org's Item fields and the chosen output type. Returns valid, or a message plus a character position. Writes nothing.                            |
| Admin saves a **new** formula field                         | Same check again (a broken formula can never be stored). The definition row is written. If **Add to existing items** is ticked, every non-deleted item is calculated in the same transaction (§6.5). |
| Admin **edits** the formula / output type                   | Re-checked and saved. **Existing items keep their old value** (D4).                                                                                                                                  |
| Item **created** (Item form or Composite Item form)         | Formula fields are calculated from the saved values. Anything the client sent for a formula key is ignored.                                                                                          |
| Item **edited and saved** (any change, even just the price) | All formula fields are recalculated with the **current** formula.                                                                                                                                    |
| SO / Invoice / PO / Bill **saved** (create or edit)         | Each line copies the item's stored value of every formula field whose `includeInModules` contains this module into `line.custom_fields.itemFields` (D6, D7).                                         |
| Archive or hide a field that a formula references           | **Refused** (409): "Used in formula field <label>. Edit or archive that formula first." Otherwise the formula would silently start returning blank.                                                  |
| Divide by zero, √ of a negative, a referenced field empty   | The result is stored as **null** (blank). Saving the item is never blocked by a formula.                                                                                                             |

Writes that do **not** recalculate, by design under D4: image upload (`items.service.ts` ~1651),
opening-stock clear (~2635), approval action setting `isActive`
(`approvalAction.service.ts:248`). None of them change a field a formula can read.

## 4. Storage (no migration)

| What                        | Where                                                                                                 | Example                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field definition            | `custom_field_definitions` row: `data_type = 'formula'` (`varchar(30)`), settings in `config` (JSONB) | `config = { "formula": "selling_price * 1.18", "outputType": "decimal", "showInTransactions": true, "includeInModules": ["invoice"], "helpText": "…" }` |
| Value per item              | `items.custom_fields` (JSONB), under the field `key`                                                  | `{ "gst_price": "118.00", "truck_no": "GJ05…" }`                                                                                                        |
| Value on a transaction line | `<line>.custom_fields` (JSONB) under the **reserved** key `itemFields`                                | `{ "itemFields": { "gst_price": "118.00" } }`                                                                                                           |

- Line tables: `sales_order_items`, `invoice_items`, `purchase_order_items`, `bill_items`. All four
  already have `custom_fields Json @default("{}")`.
- `itemFields` is reserved because Bill lines already keep `description` in `custom_fields`
  (`CreateBill.tsx` ~464, ~793), so do not put formula keys at the top level.
- `isRequired` is always `false` for a formula field, and `config.defaultValue` / `config.options` are
  always stripped.
- The **values** are shaped like the plain type named by `outputType` (§5.5). So for display,
  filtering and print, a formula field is treated as its `outputType`.

## 5. The formula language

### 5.1 Lexical

- **Numbers:** `12`, `1.18`, `.5`. **Text:** `"PCS"` or `'PCS'` (backslash escapes the next
  character). **Booleans:** `true`, `false` (case-insensitive).
- **Field references:** identifiers `[A-Za-z_][A-Za-z0-9_]*`, case-sensitive.
- **Function names:** case-insensitive (`trim(` = `TRIM(`), followed by `(`.
- A lone `=` is an error: "Use == to compare two values."
- Max formula length **1000** characters, max nesting depth **40**.

### 5.2 Fields (Insert → Fields)

Built-ins, i.e. the Item New/Edit form (`web/src/features/items/CreateItemPage.tsx`):

| Ref                    | Label                | Item column (Prisma)  | Type    |
| ---------------------- | -------------------- | --------------------- | ------- |
| `name`                 | Name                 | `name`                | text    |
| `item_type`            | Type                 | `itemType`            | text    |
| `sku`                  | SKU                  | `sku`                 | text    |
| `category`             | Category             | `category`            | text    |
| `unit`                 | Unit                 | `unit`                | text    |
| `hsn_code`             | HSN Code             | `hsnCode`             | text    |
| `selling_price`        | Selling Price        | `sellingPrice`        | number  |
| `sales_description`    | Sales Description    | `salesDescription`    | text    |
| `cost_price`           | Cost Price           | `costPrice`           | number  |
| `purchase_description` | Purchase Description | `purchaseDescription` | text    |
| `track_inventory`      | Track Inventory      | `trackInventory`      | boolean |
| `inventory_tracking`   | Inventory Tracking   | `inventoryTracking`   | text    |

Custom fields are referenced as **`cf_<key>`** (Zoho's convention), so they can never shadow a
built-in. Only **active** item definitions that are not formulas are listed. Their type as a formula
sees it:

| Custom `dataType`                                               | Formula type | Value read                        |
| --------------------------------------------------------------- | ------------ | --------------------------------- |
| `number`, `decimal`                                             | number       | the number                        |
| `checkbox`                                                      | boolean      | true/false                        |
| `date`                                                          | date         | `YYYY-MM-DD`                      |
| `select`                                                        | text         | the option **label** (not its id) |
| `multi_select`                                                  | text         | labels joined with `", "`         |
| `text`, `textarea`, `email`, `url`, `phone`, `datetime`, `time` | text         | the stored string                 |
| `formula`                                                       | —            | not referenceable (D2)            |

Images, ids and audit columns are deliberately excluded.

### 5.3 Functions (Insert → Functions)

Each carries a name, description, syntax and example for the menu's detail panel (as in the Zoho
screenshot). **`TODAY()` is deliberately absent**: a stored value that depends on the date is
stale the next day.

| Function      | Syntax                             | Args → returns                                              | Example                                  |
| ------------- | ---------------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `TRIM`        | `TRIM(text)`                       | text → text                                                 | `TRIM("  Cotton  ")` → `Cotton`          |
| `UPPER`       | `UPPER(text)`                      | text → text                                                 | `UPPER("roll")` → `ROLL`                 |
| `LOWER`       | `LOWER(text)`                      | text → text                                                 | `LOWER("ROLL")` → `roll`                 |
| `LEN`         | `LEN(text)`                        | text → number                                               | `LEN("Cotton")` → 6                      |
| `LEFT`        | `LEFT(text, n)`                    | text, number → text                                         | `LEFT("Cotton", 3)` → `Cot`              |
| `RIGHT`       | `RIGHT(text, n)`                   | text, number → text                                         | `RIGHT("Cotton", 3)` → `ton`             |
| `REPLACE`     | `REPLACE(text, find, replaceWith)` | text ×3 → text (all occurrences)                            | `REPLACE("A-B-C", "-", "/")` → `A/B/C`   |
| `CONCATENATE` | `CONCATENATE(v1, v2, …)`           | any… → text (empty values skipped)                          | `CONCATENATE(sku, "-", unit)`            |
| `VALUE`       | `VALUE(text)`                      | text → number (non-numeric → empty)                         | `VALUE("12.5")` → 12.5                   |
| `SQRT`        | `SQRT(number)`                     | number → number (negative → empty)                          | `SQRT(16)` → 4                           |
| `ABS`         | `ABS(number)`                      | number → number                                             | `ABS(-5)` → 5                            |
| `FLOOR`       | `FLOOR(number)`                    | number → number                                             | `FLOOR(4.7)` → 4                         |
| `CEIL`        | `CEIL(number)`                     | number → number                                             | `CEIL(4.2)` → 5                          |
| `ROUND`       | `ROUND(number, places)`            | number, [number] → number (half-up, places 0–10, default 0) | `ROUND(4.567, 2)` → 4.57                 |
| `PRODUCT`     | `PRODUCT(n1, n2, …)`               | number… → number                                            | `PRODUCT(2, 3, 4)` → 24                  |
| `MIN` / `MAX` | `MIN(n1, n2, …)`                   | number… → number                                            | `MAX(4, 9, 2)` → 9                       |
| `IF`          | `IF(condition, ifTrue, ifFalse)`   | boolean, T, T → T (both branches same type)                 | `IF(selling_price > 100, "High", "Low")` |
| `ISBLANK`     | `ISBLANK(value)`                   | any → boolean                                               | `ISBLANK(hsn_code)`                      |
| `ADDDAYS`     | `ADDDAYS(date, days)`              | date, number → date                                         | `ADDDAYS(cf_expiry_date, 30)`            |
| `ADDMONTHS`   | `ADDMONTHS(date, months)`          | date, number → date (clamps 31 Jan + 1 → 28/29 Feb)         | `ADDMONTHS(cf_expiry_date, 6)`           |

### 5.4 Operators (Insert → Operators), lowest precedence first

| Level | Operators                | Operand types → result                                  |
| ----- | ------------------------ | ------------------------------------------------------- |
| 1     | `\|\|` (Or)              | boolean, boolean → boolean                              |
| 2     | `&&` (And)               | boolean, boolean → boolean                              |
| 3     | `==` `!=`                | same type both sides → boolean                          |
| 4     | `<` `<=` `>` `>=`        | same type (number, text or date; not boolean) → boolean |
| 5     | `+` `-`                  | number, number → number                                 |
| 6     | `*` `/` `%`              | number, number → number                                 |
| 7     | unary `-` `!`            | number → number; boolean → boolean                      |
| 8     | `^` (Power, right-assoc) | number, number → number                                 |
| —     | `( )`                    | grouping                                                |

`+` on text is a type error with the hint "Use CONCATENATE to join text." The menu also lists
`()` as "Parenthesis", as in Zoho.

### 5.5 Output type → what is stored

| `outputType` | Formula must produce | Stored as                                                                                                       |
| ------------ | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `text`       | anything             | text (number → plain string, date → `YYYY-MM-DD`, boolean → `true`/`false`), capped at 255 chars; empty → null  |
| `number`     | number               | JS number, rounded half-up to a whole number                                                                    |
| `decimal`    | number               | **string** with exactly 2 places, e.g. `"118.00"` (D8; same reason the engine stores every decimal as a string) |
| `date`       | date                 | `YYYY-MM-DD`                                                                                                    |
| `checkbox`   | boolean              | `true` / `false`                                                                                                |

### 5.6 Empty values and runtime failures

- A field with no value reads as **empty** (null).
- Arithmetic and `< <= > >=` with an empty operand → empty. `==` / `!=` compare normally
  (`empty == empty` is true).
- `&&`, `||`, `!` and `IF` treat empty as false. Only the chosen `IF` branch is evaluated.
- Every function except `CONCATENATE`, `IF` and `ISBLANK` returns empty if any argument is empty.
- `/` or `%` by zero, `SQRT` of a negative, non-finite results, invalid dates → empty.
- Evaluation **never throws** to the caller. Any failure stores null.

### 5.7 Implementation rules

- 🔴 **Never `eval` / `new Function`.** The formula is written by an org admin and runs on a server
  shared by every tenant. Write a tokenizer + recursive-descent parser producing an AST, a type
  checker over the AST, and an evaluator over the AST.
- **Decimal math only:** `Prisma.Decimal` (decimal.js) for every number. A JS float gets money
  wrong. Import as `items.service.ts` does (`import { Prisma } from '…/generated/prisma/client.ts'`).
- **The server is the only parser.** The browser never parses, so Check Syntax and Save cannot
  disagree. The function/field/operator lists the menus show come from the server (§7.1).
- Errors are a `FormulaError(message, position)`, where position is a character offset into the
  formula so the UI can put the cursor there.

**Check Syntax error examples** (the messages the user should see):

| Formula                             | Message                                                                |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `TRIM(sales_rate != description)`   | Unknown field "sales_rate".                                            |
| `TRIM(selling_price != cost_price)` | Argument 1 of TRIM must be text, not boolean.                          |
| `selling_price = 10`                | Use == to compare two values.                                          |
| `ROUND(1, 2, 3)`                    | ROUND is used like ROUND(number, places).                              |
| `name + sku`                        | "+" works on numbers, not text and text. Use CONCATENATE to join text. |
| `(selling_price * 2`                | A "(" is never closed.                                                 |
| `name` with output Decimal          | This formula gives a text, which cannot be stored as decimal.          |
| `IF(track_inventory, 1, "x")`       | IF must return the same type either way, but got number and text.      |

## 6. Backend

All paths are under `backend/src/modules/settings/customization/custom-fields/` unless stated.

### 6.1 `customFields.constants.ts`

- Add `'formula'` to `DATA_TYPES` (line 58).
- Add `FORMULA_ENTITY_TYPES = ['item']`, `FORMULA_OUTPUT_TYPES = ['text','number','decimal','date','checkbox']`,
  `FORMULA_TRANSACTION_MODULES = ['sales_order','invoice','purchase_order','bill']`. Either here or
  in the new formula file, but import them from one place.

### 6.2 New `customFields.formula.ts` (pure, no DB)

Exports:

- `ITEM_BUILTIN_FIELDS` (§5.2 table, including the `column`), `CUSTOM_REF_PREFIX = 'cf_'`,
  `formulaTypeOf(dataType)`.
- `FUNCTIONS` (§5.3, with metadata) and `OPERATOR_LIST` (§5.4, for the menu).
- `compileFormula(source, outputType, fields) → { ast, type, refs }`, which throws `FormulaError`.
  `refs` is the list of field refs used, needed by the archive guard (§6.4).
- `evaluateFormula(compiled, outputType, values) → stored value | null`, which never throws.
- `buildItemValues(record, customFields, defs) → Map<ref, value>`: built-in columns from `record`
  (camelCase Prisma row), custom values from `customFields`, select ids → labels.
- `formulaFieldsFor(defs) → FormulaField[]`: built-ins + non-formula custom defs. This is the Fields
  menu and the check's field catalog.
- `readFormulaConfig(config)`, and `computeItemFormulas(defs, record, customFields) → { [key]: value }`.

### 6.3 `custom-fields.schemas.ts`

- `configSchema` (line 28): add `formula: z.string().max(1000).optional()`,
  `outputType: z.enum(FORMULA_OUTPUT_TYPES).optional()`, `showInTransactions: z.boolean().optional()`,
  `includeInModules: z.array(z.enum(FORMULA_TRANSACTION_MODULES)).optional()`.
- `createDefinitionSchema`: add `applyToExisting: z.boolean().optional().default(false)`. This is
  **not** part of `config` and is never stored. `refineConfig` (line 46) additionally requires:
  - `dataType === 'formula'` → `entityType ∈ FORMULA_ENTITY_TYPES` (else issue on `dataType`:
    "Formula fields are available for Items only.")
  - `config.formula` non-empty and `config.outputType` present.
  - `applyToExisting` only allowed with `dataType === 'formula'`.
- `updateDefinitionSchema`: no new top-level keys. `config` already carries the formula fields.
- New `checkFormulaSchema = { entityType, formula, outputType }`.
- ⚠️ Zod 4 `.partial()` keeps `.default()`s (see memory / earlier bug), so do not derive the update
  schema from the create one.

### 6.4 `custom-fields.service.ts`

- `normalizeConfig` (line 34): for `formula`, keep only `formula`, `outputType`, `showInTransactions`
  (default `true`), `includeInModules` (default `[]`) and `helpText`. Drop `options` and
  `defaultValue`.
- **`createDefinition`** (line 86), formula branch, inside the existing `runAsTenant`:
  1. Load the org's active item definitions (direct `findMany`, not the cache).
  2. `compileFormula(config.formula, config.outputType, formulaFieldsFor(defs))`. On
     `FormulaError` → `ApiError.badRequest('Please check the formula.', { 'config.formula': msg })`.
  3. Force `isRequired: false`.
  4. Create the row.
  5. If `applyToExisting` → `backfillItemFormula(tx, organizationId, [...defs, created])` (§6.5).
- **`updateDefinition`** (line 138): if the existing row is `formula` and `input.config` is present,
  re-compile exactly as on create, then save. **Do not recalculate items** (D4). `isRequired` stays
  false even if sent.
- **Archive / hide guard** (`archiveDefinition` line 204, and `updateDefinition` when
  `input.status === 'hidden'`): if the field is an **item** field, load active item formula
  definitions, compile each, and if any `refs` contains `cf_<this key>` → `ApiError.conflict('Used
in formula field "<label>". Edit or archive that formula first.')`.
- **`checkFormula(organizationId, input)`**: load active item defs, compile, and return
  `{ valid: true, resultType }` or `{ valid: false, message, position }`. It returns **200 with
  `valid: false`** rather than 400, because a failed check is an answer, not an error.
- **`getFormulaMeta(organizationId, entityType)`**: returns `{ fields: formulaFieldsFor(activeDefs),
functions: [{name, description, syntax, example}], operators: OPERATOR_LIST }`.
- Keep calling `invalidateDefinitions` after commit, as the existing functions do.

### 6.5 Backfill (only for "Add to existing items")

`backfillItemFormula(tx, organizationId, defs)`:

- Page through `tx.item.findMany({ where: { organizationId, isDeleted: false }, select: { id, customFields, …the 12 built-in columns }, orderBy: { id: 'asc' }, take: 500, cursor })`.
- For each row: `computeItemFormulas(defs, row, row.customFields)` → patch `{ [newKey]: value }`.
- Write each page in **one statement**, never one update per item (CLAUDE.md N+1 rule; `Promise.all`
  does not help inside the transaction):
  ```sql
  UPDATE items AS i
     SET custom_fields = i.custom_fields || u.patch
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS u(id uuid, patch jsonb)
   WHERE i.id = u.id AND i.organization_id = ${organizationId}::uuid
  ```
  Use `tx.$executeRaw` tagged template (precedent: `approvalProcess.service.ts:180`). The `||` merge
  touches only the new key.
- All of it runs in the definition's transaction, so it is all-or-nothing. A few thousand items is a
  handful of round trips. A very large catalogue can hit the default 5 s interactive-transaction
  limit, which surfaces as an error and creates nothing. **Do not raise the timeout** (CLAUDE.md). If
  it becomes real, discuss a background job with the user.

### 6.6 `customFields.engine.ts` — `validateCustomFields` (line 191)

- Add an optional param `record?: Record<string, unknown>` (the item's built-in columns **as they
  will be after this write**).
- In the main loop (line 206): `if (def.dataType === 'formula') continue;` **before** reading input.
  Input for a formula key is ignored, and required never applies.
- After the merge (line 250): if any def is a formula, `record` is **required**. Throw a plain
  `Error` (500) if missing, so a forgotten caller fails loudly in tests. Then overwrite each formula
  key with `computeItemFormulas(defs, record, merged)`.
- `buildValueSchema` stays as is. A formula never reaches it.

### 6.7 Item save paths — always recalculate

Under D4 every item save must recalculate, **even when the client sends no custom fields** (a
price-only edit must refresh `gst_price`).

| File                                                                      | Path                                   | Change                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/modules/items/items.service.ts`                              | `create` ~1218, engine call ~1227      | Pass `record = { ...rest, unit: uom.unitName, sku: rest.sku ?? '' }`.                                                                                                                                                                                                                                                      |
| same                                                                      | `update` ~1390, engine call ~1424–1433 | Today it runs the engine only when `rawCustomFields !== undefined`. Load defs first, and run when **either** custom fields were sent **or** any def is a formula. Use `input: rawCustomFields ?? {}`, `existing: item.customFields`, `record = { ...item, ...definedOnly(rest) }` (after `rest.unit` is set from the uom). |
| `backend/src/modules/inventory/composite-items/compositeItems.service.ts` | create ~163                            | Same as item create (uses `'item'` defs).                                                                                                                                                                                                                                                                                  |
| same                                                                      | update ~452–461                        | Same as item update.                                                                                                                                                                                                                                                                                                       |

`definedOnly` drops `undefined` keys so an omitted field keeps the stored column value.

### 6.8 Transaction lines — stamp `itemFields`

New helper (e.g. `custom-fields/itemFormulaLines.ts`):

```ts
stampItemFormulaFields(tx, organizationId, module: FormulaTransactionModule,
                       lines: Array<{ itemId: string; customFields?: unknown }>)
```

1. `loadActiveDefinitions(tx, organizationId, 'item')` → keep `dataType === 'formula'` whose
   `config.includeInModules` contains `module`. If none, delete any client-sent `itemFields` and return.
2. **One** query: `tx.item.findMany({ where: { id: { in: uniqueItemIds }, organizationId }, select: { id: true, customFields: true } })` → `Map`.
3. For each line: `customFields = { ...clientCustomFields, itemFields: { [key]: item.customFields[key] ?? null } }`.
   This **overwrites** any client-sent `itemFields`. It uses the **stored** value, never a fresh
   calculation (D6).

Call it before the lines are written, in create **and** update of:

| Module         | File                                                                       | Create                  | Update                 |
| -------------- | -------------------------------------------------------------------------- | ----------------------- | ---------------------- |
| Sales Order    | `backend/src/modules/sales/sales-orders/sales-orders.service.ts`           | ~80, lines ~137–144     | ~163, loop ~215–226    |
| Invoice        | `backend/src/modules/sales/invoices/invoices.service.ts`                   | ~82, lines ~139–146     | ~232, loop ~286–297    |
| Purchase Order | `backend/src/modules/purchases/purchase-orders/purchase-orders.service.ts` | ~90, lines ~147–154     | ~188, loop ~242–255    |
| Bill           | `backend/src/modules/purchases/bills/bills.service.ts`                     | ~1683, lines ~1775–1789 | ~1881, loop ~2034–2052 |

None of these functions currently loads the items' `customFields`. Bill's `writeBillLines` (~974)
and `assertReceiptLines` (~1385) do load items, but with other selects and at the wrong moment, so
use the helper's own single query.

Note: SO / Invoice / PO save header and line `custom_fields` **without validation** today. That
gap is pre-existing and out of scope. The helper only guarantees that `itemFields` is
server-written.

### 6.9 Routes / controller

`custom-fields.routes.ts`. Add before `/definitions/:id` and keep the router's `authenticate,
tenantContext`:

```ts
router.get('/formula-meta', requirePermission('custom_field:read'), controller.getFormulaMeta);
router.post(
  '/formula/check',
  requirePermission('custom_field:read'),
  validateBody(checkFormulaSchema),
  controller.checkFormula,
);
```

`custom_field:read` is enough. Both write nothing, and `read` is implied by create/update. The
controller has **no try/catch** and uses `sendSuccess` (CLAUDE.md envelope rule).

**Contracts** (inside the `{ statusCode, message, data }` envelope):

```
GET  /organizations/:orgId/custom-fields/formula-meta?entityType=item
→ data: { fields:    [{ ref: "selling_price", label: "Selling Price", type: "number", group: "Item" },
                      { ref: "cf_truck_number", label: "Truck Number", type: "text", group: "Custom Fields" }],
          functions: [{ name: "SQRT", description: "Returns the square root of the given number",
                        syntax: "SQRT(number)", example: "SQRT(16) gives 4" }, …],
          operators: [{ symbol: "*", label: "Multiply" }, …] }

POST /organizations/:orgId/custom-fields/formula/check
body { entityType: "item", formula: "selling_price * 1.18", outputType: "decimal" }
→ data: { valid: true,  resultType: "number" }
→ data: { valid: false, message: "Unknown field \"sales_rate\".", position: 5 }

POST /organizations/:orgId/custom-fields/definitions      (existing route, new fields)
body { entityType: "item", label: "GST Price", dataType: "formula", isRequired: false, showInPrint: true,
       applyToExisting: true,
       config: { formula: "selling_price * 1.18", outputType: "decimal",
                 showInTransactions: true, includeInModules: ["invoice", "bill"], helpText: "…" } }
→ 201 data: { field }        | 400 details: { "config.formula": "…" }
```

### 6.10 Approval processes

- `backend/src/modules/automation/approval-processes/moduleMetadata.service.ts:665` maps a custom
  field's `dataType` straight through. For `formula`, map from `config.outputType`: text → `text`,
  number → `number`, decimal → `number` (or `currency`, matching how price columns map at ~389),
  date → `date`, checkbox → `boolean`. A number formula then gets `>` `<` in criteria.
- `approvalProcess.constants.ts:260` (`OPERATORS_BY_DATA_TYPE['formula'] = text`) becomes unreachable
  for custom fields once the above lands. Leave it, or remove it if nothing else emits `formula`.
- Formula fields must not be offered as a target in the approval **"update field"** action
  (`web/.../ActionConfigurationModal.tsx`). Verify how that list is built and exclude them, since
  the value is computed.

## 7. Frontend

All under `web/src/` unless stated. Every new control follows CLAUDE.md:

- Keyboard: Tab reaches it, ↑↓ / Enter / Esc in menus, visible focus.
- Phone width: 390 px works, 44 px touch targets.
- Portalled `fixed` menus inside scroll containers.
- "Select …" placeholders.
- Errors = red border + toast, no sentences under fields.

### 7.1 `features/custom-fields/customFields.schemas.ts` and `customFields.api.ts`

- `DataType` (line 4): add `'formula'`. `DATA_TYPE_OPTIONS` (line 57): add
  `{ value: 'formula', label: 'Formula' }`, but **filter it out** of the picker unless
  `entityType === 'item'` (add `FORMULA_ENTITY_TYPES = ['item']`).
- `CustomFieldConfig` (line 25): add `formula?`, `outputType?`, `showInTransactions?`,
  `includeInModules?`.
- `FORMULA_OUTPUT_OPTIONS` (labels: Text, Number, Decimal, Date, Checkbox) and
  `FORMULA_TRANSACTION_MODULES` (Sales Order, Invoice, Purchase Order, Bill). Keep them in sync with
  the backend, as the file's header comment says.
- `CreateFieldPayload` (api line 22): add `applyToExisting?: boolean`.
- `useFormulaMeta(orgId, entityType)`: `useQuery`, key `['custom-fields','formula-meta',orgId,entityType]`
  (orgId in the key). Invalidate it in `invalidateModule` (line 65), because new custom fields change
  the Fields menu.
- `useCheckFormula(orgId)`: `useMutation` → `POST …/formula/check`.

### 7.2 `features/custom-fields/FieldForm.tsx`

When `dataType === 'formula'` (only selectable for Item):

| Row                                 | Control                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field Name*, Data Type*, Help Text  | unchanged                                                                                                                                                                                                                                                                                                 |
| **Show when creating transactions** | existing `YesNo` (default Yes)                                                                                                                                                                                                                                                                            |
| **Include in Modules***             | multi-select of the 4 modules. "None" = empty array. Reuse the `multi_select` control `CustomFieldInput` already renders                                                                                                                                                                                  |
| Show in Print                       | unchanged (only shown for printable modules today; the per-line PDF column uses it too, see §7.5)                                                                                                                                                                                                         |
| **Output Data Type***               | `Select` from `FORMULA_OUTPUT_OPTIONS`                                                                                                                                                                                                                                                                    |
| **Formula***                        | new `FormulaEditor` (§7.3)                                                                                                                                                                                                                                                                                |
| **Add to existing items**           | **create only** (`!isEdit`). The checkbox with Zoho's text "Add this custom field to all the existing items and auto-calculate the value using the formula in all of them." plus the note "This is a one-time setup and you cannot edit this setting later." Sent as `applyToExisting`, never in `config` |
| Default Value, Is Mandatory         | **hidden** for formula                                                                                                                                                                                                                                                                                    |

- On edit, an **info icon** beside the Formula label explains "Existing items update when they are
  next saved." (D4). CLAUDE.md forbids a sentence under the field. There is no shared info-icon
  component yet, so build it once in `components/ui/` (a focusable `<button>`) and reuse it.
- `buildConfig` (line 115): for formula, send `{ formula, outputType, showInTransactions,
includeInModules, helpText }`.
- Client-side guard before submit: formula and output type are present. The server does the real
  check. On a 400 with `details['config.formula']`, red-border the editor and `toast.error`.
- Today `handleSubmit` writes a sentence via `setErrorMsg`. Follow the current file's pattern for
  the rest, but the formula error is border + toast.

### 7.3 New `features/custom-fields/FormulaEditor.tsx`

- A `<textarea>` (placeholder "Enter the formula here or insert it using the options below"), plus
  an **INSERT** row of three menu buttons and a **Check Syntax** button, as in the screenshots.
- **Insert at the cursor:** remember `selectionStart/End`, splice the text in, then restore focus
  and put the caret after the insert. Functions insert `NAME()` with the caret inside the brackets.
  Fields insert the `ref`. Operators insert the symbol with spaces (`()` inserts a pair with the
  caret inside).
- **Functions menu:** search box + list, and on the right a detail panel (Name / Description /
  Syntax / Example) for the highlighted item. **Fields menu:** search + list grouped "Item" /
  "Custom Fields", showing labels and inserting refs. **Operators menu:** "`*` Multiply"-style rows.
- Menus come from `useFormulaMeta`. They are `useCombobox` (downshift) like `ComboBox.tsx`,
  portalled to `document.body` and positioned `fixed`, following `issues/BatchPicker.tsx`:
  measure in `useLayoutEffect`, re-measure on resize and capture-phase scroll, flip upward, clamp
  width to the viewport.
- **Check Syntax:** call `useCheckFormula` with the current formula + output type. Valid →
  `toast.success('Formula is valid.')`. Invalid → `toast.error(message)`, red border on the
  textarea, and `setSelectionRange(position, position)` + focus so the caret lands on the problem.
  Editing the text clears the red border.
- On a phone the INSERT row wraps. The detail panel stacks under the list below 768 px.

### 7.4 Item form — showing the value

- `features/custom-fields/CustomFieldsSection.tsx`: for `dataType === 'formula'` render a
  **read-only** display (not an input), using `formatCustomFieldValue`. On a new item, show `-`
  with `title="Calculated when saved"`. Skip formula defs in the default-value effect (~68–87) so
  nothing is pre-filled. Formula keys must not be sent as editable values. The server ignores them
  anyway, but do not render them as inputs.
- `features/custom-fields/CustomFieldInput.tsx` (line 54): add a `formula` case that renders the
  read-only display (it also backs FieldForm's Default Value preview, which is hidden for formula
  anyway).
- `features/custom-fields/formatCustomFieldValue.ts` (line 13): `case 'formula':` → re-call itself
  with `{ ...def, dataType: def.config.outputType ?? 'text' }`, so a decimal reads `118.00`, a
  checkbox `Yes/No` and a date `DD-MM-YYYY`.
- `features/items/ItemsList.tsx` `renderItemCell` (~31–60) has its own select/date logic and would
  print a checkbox formula as `true`. Route `formula` through `formatCustomFieldValue`.
- Advanced filters (`components/ui/AdvancedFilter/filterUtils.ts`, `AdvancedFilter.tsx`) choose
  operators by `dataType`. Treat `formula` as its `outputType` there. Verify how custom-field
  filters reach the backend list query and apply the same mapping server-side if a type switch
  exists.

### 7.5 Transactions — the column

Applies to Sales Order, Invoice, Purchase Order, Bill. Each has **its own copy** of the line table
(no shared component), so it is 4 forms + 4 on-screen detail tables + 4 PDF tables.

**Which columns:** `useActiveCustomFields(orgId, 'item')` → defs with `dataType === 'formula'` and
`config.includeInModules` containing the module.

- **Form:** additionally `config.showInTransactions !== false`.
- **Detail on-screen:** all included defs.
- **PDF:** included defs with `showInPrint`.

**Where (D9): right after "Item Details".** The tables are `tableLayout: 'fixed'` with widths that
add up to 100% (Item Details 35%), so take the new columns' width out of Item Details.

| Module  | Form (file · wrapper · thead · row map)                                                | Detail on-screen (wrapper · thead · rows)    | PDF (wrapper · thead · rows)   |
| ------- | -------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------ |
| SO      | `features/sales/sales-orders/CreateSalesOrder.tsx` · 1011 · 1020–1094 · 1096           | `SalesOrderDetail.tsx` 990 · 992 · 1063      | 1502 · 1512 · 1569             |
| Invoice | `features/sales/invoices/CreateInvoice.tsx` · 1023 · 1032–1106 · 1108                  | `InvoiceDetail.tsx` 835 · 837 · 908          | (plain div) 1345 · 1355 · 1402 |
| PO      | `features/purchases/purchase-orders/CreatePurchaseOrder.tsx` · 1267 · 1276–1350 · 1352 | `PurchaseOrderDetail.tsx` 1093 · 1095 · 1166 | 1616 · 1626 · 1695             |
| Bill    | `features/purchases/bills/CreateBill.tsx` · 1158 · 1167–1241 · 1243                    | `BillDetail.tsx` 870 · 872 · 943             | 1562 · 1572 · 1639             |

**Cell values:**

- **Form** (before save, D6): `selectedItem?.customFields?.[def.key]`. Each row already has
  `const selectedItem = curItem?.item` (SO ~1098, Invoice ~1110, PO ~1354, Bill ~1245). The item
  object comes from `ItemComboBox` → `GET /items`, which returns `customFields`. In edit mode the
  rows get `item` from the detail endpoint, which also includes it.
- **Detail / PDF** (after save, D7): `line.customFields?.itemFields?.[def.key]`, i.e. the
  **snapshot**, **not** `line.item.customFields`, which is the item's current value.
- Format with `formatCustomFieldValue(value, def)`. Read-only, never an input. A missing value
  shows `-`.
- Bill lines created from a job receipt start with no item, so the cell is `-` until one is picked.
- Every one of these tables except the Invoice PDF already sits in `.responsive-table-wrapper`. Keep
  it so the extra column scrolls on a phone instead of squashing.

## 8. Edge cases

| Case                                                      | Result                                                                                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formula created without "Add to existing items"           | Existing items show `-` until each is saved.                                                                                                                                      |
| Formula edited                                            | Items show the old value until saved (D4). Two items with the same price can disagree until both are saved. This is the accepted trade-off, and the info icon says so.            |
| Referenced custom field archived/hidden                   | Refused while a formula uses it (§6.4).                                                                                                                                           |
| Referenced dropdown's option renamed                      | The item keeps the old label in its result until its next save (D4).                                                                                                              |
| Formula field itself archived                             | Same as any field: values stay in JSONB and the key stays reserved. Transaction columns stop showing because the def is no longer active. Old `itemFields` stay in the line JSON. |
| Formula field hidden                                      | Same as any hidden field: the stored value is preserved by the engine and the field is not calculated (it is not in the active defs) until it is shown again.                     |
| `includeInModules` changed                                | Affects documents saved **after** the change only (D7).                                                                                                                           |
| Composite item                                            | Uses the `'item'` defs, so it is calculated on composite create/edit (§6.7).                                                                                                      |
| Client sends a value for a formula key / for `itemFields` | Ignored / overwritten by the server.                                                                                                                                              |
| Another org's formula                                     | Definitions and items are tenant-scoped (`runAsTenant` + `organizationId` in every `where`). The formula catalog is built per org.                                                |

## 9. Tests

Create your own fixtures with `src/db/testTenant.ts` (see memory: the suite runs in parallel on a
shared DB, and an unfiltered cleanup once deleted every organization).

- **`customFields.formula.test.ts`** (pure, no DB):
  - every §5.7 error message and its position
  - precedence (`2 + 3 * 4 ^ 2`, `-2 ^ 2`)
  - each function including empty-argument behaviour
  - divide by zero → null
  - decimal output `"118.00"`
  - number output rounding
  - text cap
  - `ADDMONTHS` month-end clamp
  - IF evaluates only its branch
  - select → label
  - `cf_` refs
  - formula-referencing-formula rejected as unknown field
- **`customFields.engine.test.ts`** (extend):
  - a formula key in input is ignored
  - a formula is never required
  - `record` missing with a formula def throws
  - hidden/archived values preserved
- **Service tests:**
  - formula refused for a non-item entityType
  - invalid formula → 400 `details['config.formula']`
  - check endpoint valid/invalid
  - `applyToExisting` fills all items in one save
  - without it, items stay empty
  - editing the formula does **not** change existing items
  - item price-only edit recalculates
  - archive/hide of a referenced field → 409
- **Transaction test** (one module is enough for the helper; then smoke the other three):
  - `itemFields` is stamped from the stored value
  - client-sent `itemFields` is overwritten
  - a later item change does not alter the saved line

## 10. Build order

1. §6.1 + §6.2 + `customFields.formula.test.ts` (pure, quickest feedback).
2. §6.6 engine + tests.
3. §6.7 item and composite save paths.
4. §6.3 / §6.4 / §6.5 / §6.9 definition API + check + meta + backfill + service tests.
5. `npm run typecheck`, `npm run lint`, `npx vitest run` (re-run a red file alone before blaming the
   change: the suite is nondeterministic).
6. §7.1–§7.3 admin screen. §7.4 item form/list/filter display.
7. §6.8 + §7.5 transactions, one module end to end first (Invoice), then the other three.
8. §6.10 approval metadata.
9. `npx tsc -b` in `web/` (**not** `tsc --noEmit`, which checks zero files).
10. Browser walk: create a formula with and without "Add to existing items", edit it and confirm
    items keep the old value until saved, Check Syntax with each §5.7 example, then an Invoice with
    the column, its detail and PDF. Do it at 390 px / 768 px / desktop and by keyboard only.
11. After it is built: update `docs/DYNAMIC_CUSTOM_FIELDS_EXPLAINED.md` in place to describe the
    built behaviour, and set this file's status line.

## 11. Out of scope

- Formula for any module other than Item.
- Formulas referencing other formulas, or `TODAY()`.
- Recalculating existing items when a formula is edited (D4). Only the one-time create backfill.
- A per-field decimal-places setting (D8).
- Validating the SO / Invoice / PO header and line `custom_fields` (pre-existing gap, §6.8).
- Background-job backfill for very large catalogues (§6.5). Raise it with the user if needed.
