# UI/UX Core Principles

> Use this file as a prompt/context for any AI tool. It defines the core principles for producing best-in-class UI/UX. Keep every screen aligned with these rules.

---

## 1. Clarity First

- Don't make users think, wait, or remember.
- One clear **primary action** per screen; everything else is secondary.
- Self-explanatory labels — plain language, no jargon.
- The most important information should be understood in under 5 seconds.

## 2. Visual Hierarchy

- Guide the eye with size, weight, color, and spacing.
- Most important element = most visually dominant.
- Group related items; separate unrelated ones (proximity).

## 3. Consistency

- Same component, same behavior, same term for the same concept — everywhere.
- Follow platform conventions; don't reinvent standard patterns.
- Reuse a shared component library rather than one-off designs.

## 4. Spacing & Layout

- Use an **8-point grid** (4, 8, 16, 24, 32, 48) for consistent rhythm.
- Be generous with whitespace — cramped UIs feel stressful.
- Align everything; misalignment reads as unpolished.

## 5. Typography

- **Project typeface: Zoho Puvi** — the single sans-serif for the whole app (see
  _Brand & Design Tokens_ below). Bundled locally; never a one-off font per screen.
- One clean sans-serif, max 2 families, 2–3 sizes/weights.
- Body text **≥16px**, line-height ~1.5, comfortable line length (45–75 chars).
- Use weight for hierarchy, not many sizes.

## 6. Color

- **Brand primary: petrol blue `#1c7c8c`** (OCTFIS) — reserved for the primary action
  and active/selected state. Paired with a deep-navy family for headers/hero surfaces.
  Full palette in _Brand & Design Tokens_ below.
- Neutral-first UI; reserve color for **meaning** and the primary action.
- Consistent semantic palette: green = success, red = error, amber = warning, blue = info/active.
- **Never rely on color alone** — pair it with icon and/or text (color-blind safe).
- Meet WCAG AA contrast (4.5:1 body text).

## 7. Feedback & States

- Every action gets an immediate reaction (≤100ms visual response).
- Design **all states** for each view: default, loading, empty, error, no-results, success.
- Empty states should guide the user to the next action, not just say "nothing here."

## 8. Forms & Input

- Ask for the minimum needed; provide sensible defaults and autofocus.
- Use correct input types (numeric keypad for numbers, steppers for counts).
- **Inline, specific validation** — "Quantity can't exceed 500," not "Invalid value."
- Real labels, not placeholder-only (placeholders disappear).

## 9. Error Prevention & Recovery

- Make mistakes hard to make, easy to recover from.
- **Confirm or offer Undo** for destructive actions (prefer Undo).
- Autosave drafts; warn before losing unsaved work.
- Error messages: say what happened **and** how to fix it.

## 10. Accessibility (build in, don't bolt on)

- Touch targets **≥48×48px**.
- Full keyboard navigation with visible focus states — see _Tab navigation_ below.
- Screen-reader labels (ARIA) on all controls.
- Sufficient contrast; support text scaling and light/dark themes.

### 10.1 Tab navigation — mandatory, and it has to be perfect

**A control that Tab cannot reach is broken, no matter how it looks.** This is not a
nice-to-have or a later pass: data-entry users work these forms all day and many of them never
touch the mouse. A screen is not finished until you have completed it start to end using only
the keyboard.

The rules, in order of how often they're broken:

1. **Use the real element.** `<button>`, `<input>`, `<select>`, `<textarea>`, `<a href>` are
   focusable for free. A `<div onClick>` is invisible to Tab — the user lands on the field above,
   presses Tab, and arrives at the field below, with no way to know a control was skipped.
   If a div genuinely must stay, it needs `tabIndex={0}`, `role`, **and** Enter/Space handlers —
   three things the real element gives you for nothing.
2. **Tab order follows the DOM, not the layout.** In a multi-column grid the two drift apart and
   focus zig-zags across the form. Read your form aloud in DOM order; if that isn't the order a
   person would fill it in, reorder the markup.
3. **Never use a positive `tabIndex`.** `tabIndex={1}` doesn't mean "first" — it lifts that
   element above the entire document's natural order, and a single one breaks tab order for the
   whole page. Only `0` (in the natural order) and `-1` (skipped by Tab, focusable from code).
4. **Dropdowns and comboboxes are keyboard-operable**: Tab to focus, Enter/Space or ↓ to open,
   ↑↓ to move, Enter to choose, Esc to close and return focus to the trigger, active option
   scrolled into view.
5. **Modals own focus.** Focus moves into the dialog on open (first field or primary action),
   is trapped inside while open, Esc closes, and focus returns to whatever opened it. An
   untrapped dialog lets Tab wander into the page behind it, which is disorienting and lets
   users edit things they can't see.
6. **Focus must be visible.** A focus ring is how a keyboard user knows where they are;
   `outline: none` with nothing in its place is the same defect as an unreachable control, only
   harder to notice.
7. **Enter submits.** Inside a `<form>`, Enter should trigger the primary action — which comes
   free from `<form onSubmit>` plus a `type="submit"` button, and breaks the moment a submit
   button is a div.

Skipping this creates work rather than saving it: unreachable controls are found by users, not
by review, typecheck, or screenshots, and by then the pattern has been copy-pasted into a dozen
screens.

## 11. Performance & Perceived Speed

- Skeleton loaders, not blank screens; optimistic UI where safe.
- Respond to interaction <100ms; meaningful content <1s.
- Virtualize long lists; lazy-load heavy views.

## 12. Responsive Design

- Design for the primary device first (mobile/tablet or desktop, as fits the user).
- Keep primary actions within thumb reach on touch devices.
- Tables collapse to cards on narrow screens; keep the key columns.
- Test on real devices.

## 13. Microcopy

- Use verbs on buttons ("Save changes," "Start job"), not vague "OK/Submit."
- Keep terminology consistent across the whole app.

---

## Brand & Design Tokens (project-wide standard)

> The **one** font and color theme every screen in this project uses. Shared with the
> companion **`Tally_Tool_React_UI`** app so the whole OCTFIS suite looks like one product.
> Implemented as CSS custom properties in **`web/src/index.css`** — always consume the
> tokens (`var(--…)`), never hard-code a hex or font name in a component.

### Typeface — Zoho Puvi

The app typeface is **Zoho Puvi**, bundled locally (`web/src/assets/fonts/*.otf`) and declared
via `@font-face`, so it renders offline with no web-font request. Ship only the weights the UI
uses; use **weight** (not many sizes) for hierarchy.

| Weight    | Value | Typical use                         |
| --------- | ----- | ----------------------------------- |
| Regular   | 400   | Body text                           |
| Medium    | 500   | Labels, emphasised body             |
| Semibold  | 600   | Buttons, field labels, sub-headings |
| Bold      | 700   | Headings                            |
| Extrabold | 800   | Page titles, hero headlines         |

```css
--font-sans: 'Zoho Puvi', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif;
```

Form controls don't inherit `font-family` by default — force `button, input, select, textarea
{ font-family: inherit; }` so inputs match the rest of the app.

### Color theme — petrol blue + navy (OCTFIS)

The palette is **sampled from the OCTFIS hummingbird mark** — a gradient from deep teal
(`#023a4e`) through petrol blues up to sky blue. Neutral-first surfaces; **petrol blue is the
only accent** used for the primary action and the active/selected state. The bird's deep-teal
end anchors headers and hero panels. Semantic colors are always paired with an icon/text, never
used alone.

| Token                       | Light                 | Role                                      |
| --------------------------- | --------------------- | ----------------------------------------- |
| `--color-primary`           | `#1c7c8c`             | **Petrol blue** — primary action / active |
| `--color-primary-hover`     | `#176a79`             | Hover on primary                          |
| `--color-primary-active`    | `#11525f`             | Pressed on primary                        |
| `--navy-800` / `--navy-900` | `#06485d` / `#043a4e` | Hero gradients (bird's deep teal)         |
| `--color-teal`              | `#14b8a6`             | "Live" / accent highlights                |
| `--color-bg`                | `#f3f5f9`             | App background                            |
| `--color-surface`           | `#ffffff`             | Cards, panels                             |
| `--color-surface-2`         | `#f7f9fc`             | Inset / subtle fills                      |
| `--color-border`            | `#e3e8ef`             | Dividers, card borders                    |
| `--color-text`              | `#18222e`             | Primary text                              |
| `--color-text-muted`        | `#51607a`             | Secondary text                            |
| `--color-text-subtle`       | `#8a97ab`             | Placeholders, hints                       |
| `--color-success`           | `#16a34a`             | Success                                   |
| `--color-danger`            | `#d14343`             | Error                                     |
| Amber (warn)                | `#b7791f`             | Warning                                   |

The app is **light-only** (`color-scheme: light`), matching the OCTFIS suite — the reference app
has no dark theme, so the petrol-blue/navy look stays consistent regardless of the OS setting.
Radii (`--radius-sm/md/lg`), spacing (8-pt grid, `--space-*`), and shadows (`--shadow-*`) are
tokenised in the same file — reuse them rather than inventing new values.

### Logo

Use the shared **`<Logo>`** component (OCTFIS mark + wordmark), not raw `<img>` tags:
`tone="dark"` on navy/hero surfaces (white wordmark + tiled mark), `tone="light"` on light
surfaces (green wordmark). Favicon: the OCTFIS mark (`web/public/favicon.gif`).

---

## Quick Checklist (before shipping any screen)

- [ ] Is the primary action obvious?
- [ ] Is it consistent with the rest of the app?
- [ ] Does every action give feedback?
- [ ] Are empty, loading, error, and success states designed?
- [ ] Can a first-time user figure it out without help?
- [ ] **Completed the whole screen using only the keyboard** — every control reachable by Tab, in a
      sensible order, focus always visible, Esc closes dialogs? (§10.1 — mandatory)
- [ ] ≥48px targets, WCAG AA contrast, color-blind safe?
- [ ] Works on the target device sizes?
- [ ] Uses Zoho Puvi + the design tokens (`var(--…)`) — no hard-coded fonts or hexes?

---

_Golden rule: **Don't make me think, don't make me wait, don't make me remember.**_
