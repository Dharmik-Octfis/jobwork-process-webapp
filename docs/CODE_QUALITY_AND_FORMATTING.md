# Code Quality & Formatting (whole repo)

> **Purpose.** How this repo enforces **consistent formatting** and **code quality** across every
> developer and every machine — automatically. Covers Prettier, ESLint, EditorConfig, line-ending
> normalization, and the pre-commit hook (Husky + lint-staged). Applies repo-wide (`web/` now,
> `backend/` later).

_Last updated: 2026-07-07._

---

## 1. Goals (why this exists)

| Requirement | How it's met |
| --- | --- |
| No unused variables allowed | ESLint rule `@typescript-eslint/no-unused-vars` set to **error** |
| Format code before every commit, automatically | Husky **pre-commit** hook runs Prettier + ESLint on staged files |
| Identical formatting for every developer | One shared **Prettier** config + committed **VS Code settings** |
| Saving in one IDE never reformats another dev's lines (clean `git blame`) | Same Prettier config everywhere + **LF** line endings enforced at 3 layers |

---

## 2. The tools

| Tool | Job | Config file | Installed in |
| --- | --- | --- | --- |
| **Prettier** | Formatting (spacing, quotes, semicolons) | `.prettierrc.json`, `.prettierignore` | root |
| **ESLint** | Code quality (unused vars, bad patterns) | `web/eslint.config.js` | `web/` |
| **eslint-config-prettier** | Turns off ESLint formatting rules that clash with Prettier | (in `eslint.config.js`, last) | `web/` |
| **EditorConfig** | Base editor rules (indent, charset, EOL) | `.editorconfig` | — |
| **Git attributes** | Normalize line endings in the repo | `.gitattributes` | — |
| **Husky** | Runs git hooks | `.husky/pre-commit` | root |
| **lint-staged** | Runs tools on **staged** files only | `web/.lintstagedrc.json` | root |
| **VS Code (shared)** | Format-on-save, recommend extensions | `.vscode/settings.json`, `.vscode/extensions.json` | — |

> **Division of labor:** **Prettier formats, ESLint finds problems.** They never overlap because
> `eslint-config-prettier` disables ESLint's formatting rules.

---

## 3. Formatting rules (`.prettierrc.json`)

```json
{
  "semi": true,
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "trailingComma": "all",
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

`trailingComma: "all"` and `endOfLine: "lf"` are the two choices that most reduce noisy diffs.
Prettier also **auto-respects `.gitignore`** (verified), so `node_modules`/`dist` are skipped without
listing them; `.prettierignore` only needs the committed-but-unformatted `package-lock.json`.

---

## 4. The "no unused variables" rule (`web/eslint.config.js`)

```js
'@typescript-eslint/no-unused-vars': [
  'error',
  { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
],
```

- **error**, not warning → it **blocks commits** (unused vars are not auto-fixable, so `eslint --fix`
  can't silently remove them).
- **Escape hatch:** name an intentionally-unused binding with a leading underscore (e.g. `(_req, res)`)
  to allow it.

`eslint-config-prettier` is imported **last** in the config array so it wins over any formatting rules.

---

## 5. Line-ending consistency (the `git blame` fix)

LF is enforced at **three layers** so it can never drift (the usual cause of "whole file shows as
edited by someone else" on Windows vs macOS):

| Layer | File | Setting |
| --- | --- | --- |
| Editor | `.editorconfig` | `end_of_line = lf` |
| Git | `.gitattributes` | `* text=auto eol=lf` |
| Formatter | `.prettierrc.json` | `"endOfLine": "lf"` |

`.editorconfig` also sets 2-space indent, UTF-8, final newline, and trim-trailing-whitespace (with an
exception for `*.md`, where trailing spaces are meaningful).

---

## 6. Git hooks (pre-commit + commit-msg)

**`.husky/pre-commit`:**

```sh
cd web && npx lint-staged
```

> ⚠️ **The `cd web` matters.** Husky runs the hook from the **repo root**, but ESLint is installed in
> `web/`. Running `lint-staged` from `web/` makes ESLint resolve (and Prettier still resolves from the
> root, since Node searches up the folder tree). Verified: without `cd web`, the hook fails with
> `'eslint' is not recognized`.

**`web/.lintstagedrc.json`:**

```json
{
  "*.{ts,tsx,js,jsx}": ["prettier --write", "eslint --fix"],
  "*.{json,css,md,html}": ["prettier --write"]
}
```

**What happens on `git commit`:**
1. lint-staged takes only the **staged** files.
2. Code files → `prettier --write` (auto-format) → `eslint --fix` (auto-fix + report).
3. If any **unfixable error** remains (e.g. an unused variable) → the commit is **blocked** and the
   working tree is restored to its pre-hook state.
4. If all clean → formatting fixes are re-staged and the commit proceeds.

### Adding `backend/` later

Give it its **own** `backend/.lintstagedrc.json` and add one line to `.husky/pre-commit`:

```sh
cd web && npx lint-staged
cd ../backend && npx lint-staged
```

### Commit message rules (commit-msg hook)

Commit messages follow the **Conventional Commits** standard, enforced by **commitlint** via a second
Husky hook.

**`.husky/commit-msg`:**

```sh
npx --no-install commitlint --edit "$1"
```

**`commitlint.config.js`** (repo root):

```js
module.exports = { extends: ['@commitlint/config-conventional'] };
```

Format: `<type>(<optional scope>): <description>` — e.g. `feat(auth): add login page`,
`fix(api): retry on 401`, `docs: update setup`. Allowed types: `feat`, `fix`, `docs`, `style`,
`refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. A non-conforming message **blocks the
commit**. Installed at the **root** (commit messages are a whole-repo concern):
`@commitlint/cli` + `@commitlint/config-conventional`.

---

## 7. Shared VS Code setup

`.vscode/settings.json` (committed) turns on **format-on-save with Prettier** and **ESLint auto-fix on
save**, forces Prettier per-language, and sets 2-space/LF to match. `prettier.requireConfig: true`
means it only formats inside this project.

`.vscode/extensions.json` (committed) recommends the three required extensions — opening the repo
prompts teammates to install them:

| Extension | ID |
| --- | --- |
| Prettier | `esbenp.prettier-vscode` |
| ESLint | `dbaeumer.vscode-eslint` |
| EditorConfig | `editorconfig.editorconfig` |

> `.vscode/` is intentionally **not** git-ignored so these shared settings travel with the repo. (Many
> default `.gitignore` templates exclude `.vscode/`; ours deliberately does not.)

---

## 8. New-developer setup

1. `git clone` the repo.
2. From the **root**: `npm install` — this runs the `prepare` script (`husky`), which **activates the
   git hooks** automatically. No manual hook setup.
3. `cd web && npm install` — install frontend deps (incl. ESLint).
4. Open in VS Code → accept the **recommended extensions** prompt.

That's it — format-on-save and the pre-commit checks now work for them identically.

---

## 9. Useful commands

Run inside `web/`:

| Command | Purpose |
| --- | --- |
| `npm run lint` | Check the whole `web/` for lint errors |
| `npx prettier --write .` | Format every file (one-off, e.g. after changing `.prettierrc`) |
| `npx prettier --check .` | Report unformatted files without changing them |

---

## 10. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Commit blocked: `'eslint' is not recognized` | Hook missing `cd web` — see §6 |
| Format-on-save does nothing | Prettier extension not installed, or `editor.defaultFormatter` not set — see §7 |
| Whole file shows as changed by you | Line-ending drift — confirm `.gitattributes` + `.editorconfig` (§5); run `git add --renormalize .` once |
| Hooks don't run at all | `npm install` not run at root (so `husky` `prepare` never ran) — see §8 |
| Commit blocked: `type may not be empty` | Message isn't Conventional Commits format (`feat: …`, `fix: …`) — see §6 |

---

## 11. Related docs

- `jobwork-process-webapp/docs/FRONTEND_SETUP.md` — frontend project setup.
- `Documents/jobwork-process/ARCHITECTURE_AND_TECH_STACK.md` — overall stack.
