# Code Quality & Formatting (whole repo)

> **Purpose.** How this repo enforces **consistent formatting** and **code quality** across every
> developer and every machine — automatically. Covers Prettier, ESLint, EditorConfig, line-ending
> normalization, and the pre-commit hook (Husky + lint-staged). Applies repo-wide (`web/` and
> `backend/`).

_Last updated: 2026-07-10._

---

## 1. Goals (why this exists)

| Requirement                                                               | How it's met                                                               |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| No unused variables allowed                                               | ESLint rule `@typescript-eslint/no-unused-vars` set to **error**           |
| Variable names are camelCase                                              | ESLint rule `@typescript-eslint/naming-convention` set to **error**        |
| Format code before every commit, automatically                            | Husky **pre-commit** hook runs Prettier + ESLint on staged files           |
| Identical formatting for every developer                                  | One shared **Prettier** config + committed **VS Code settings**            |
| Saving in one IDE never reformats another dev's lines (clean `git blame`) | Same Prettier config everywhere + **LF** line endings enforced at 3 layers |

---

## 2. The tools

| Tool                       | Job                                                        | Config file                                        | Installed in       |
| -------------------------- | ---------------------------------------------------------- | -------------------------------------------------- | ------------------ |
| **Prettier**               | Formatting (spacing, quotes, semicolons)                   | `.prettierrc.json`, `.prettierignore`              | root               |
| **ESLint**                 | Code quality (unused vars, bad patterns)                   | `web/eslint.config.js`, `backend/eslint.config.js` | `web/`, `backend/` |
| **eslint-config-prettier** | Turns off ESLint formatting rules that clash with Prettier | (in each `eslint.config.js`, last)                 | `web/`, `backend/` |
| **EditorConfig**           | Base editor rules (indent, charset, EOL)                   | `.editorconfig`                                    | —                  |
| **Git attributes**         | Normalize line endings in the repo                         | `.gitattributes`                                   | —                  |
| **Husky**                  | Runs git hooks                                             | `.husky/pre-commit`                                | root               |
| **lint-staged**            | Runs tools on **staged** files only                        | `.lintstagedrc.json`                               | root               |
| **VS Code (shared)**       | Format-on-save, recommend extensions                       | `.vscode/settings.json`, `.vscode/extensions.json` | —                  |

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

## 4. ESLint rules (`web/eslint.config.js`)

### 4.1 No unused variables

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

### 4.2 camelCase names

`@typescript-eslint/naming-convention` makes camelCase the default for **every** name, then carves out
the exceptions React and TypeScript force on us. A blanket camelCase check is **not** what you want —
it rejects `const Input = forwardRef(...)`, `import { QueryClientProvider }`, `type AuthResponse`, and
the `'Content-Type'` header key, all of which are correct code.

| Selector                                                         | Allowed formats                   | Why                                                                                           |
| ---------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `default`                                                        | camelCase                         | The baseline. Leading `_` allowed, trailing `_` forbidden.                                    |
| `variable`                                                       | camelCase, PascalCase, UPPER_CASE | PascalCase for components (`const Input = forwardRef(...)`); UPPER_CASE for module constants. |
| `parameter`                                                      | camelCase                         | Leading `_` allowed, to pair with §4.1's escape hatch.                                        |
| `function`                                                       | camelCase, PascalCase             | `function Button()`, `function EyeIcon()`.                                                    |
| `import`                                                         | camelCase, PascalCase             | `import styles from './x.module.css'`, `import { RouterProvider }`.                           |
| `typeLike`                                                       | PascalCase                        | Interfaces, type aliases, classes, enums.                                                     |
| `enumMember`                                                     | PascalCase, UPPER_CASE            | —                                                                                             |
| `objectLiteralProperty` / `typeProperty` **that require quotes** | _(unchecked)_                     | Keys like `'Content-Type'` are dictated by the wire format, not by us.                        |

Ordering note: individual selectors always beat the `default` catch-all, so `default` stays first and
the exceptions follow.

`eslint-config-prettier` is imported **last** in the config array so it wins over any formatting rules.

---

## 5. Line-ending consistency (the `git blame` fix)

LF is enforced at **three layers** so it can never drift (the usual cause of "whole file shows as
edited by someone else" on Windows vs macOS):

| Layer     | File               | Setting              |
| --------- | ------------------ | -------------------- |
| Editor    | `.editorconfig`    | `end_of_line = lf`   |
| Git       | `.gitattributes`   | `* text=auto eol=lf` |
| Formatter | `.prettierrc.json` | `"endOfLine": "lf"`  |

`.editorconfig` also sets 2-space indent, UTF-8, final newline, and trim-trailing-whitespace (with an
exception for `*.md`, where trailing spaces are meaningful).

---

## 6. Git hooks (pre-commit + commit-msg)

**`.husky/pre-commit`:**

```sh
npx --no-install lint-staged
```

**`.lintstagedrc.json`** (repo root):

```json
{
  "web/**/*.{ts,tsx,js,jsx}": [
    "prettier --write",
    "node web/node_modules/eslint/bin/eslint.js --fix"
  ],
  "*.{json,css,md,html}": ["prettier --write"]
}
```

> ⚠️ **Why ESLint is invoked via `node <path>` and not just `eslint`.** lint-staged runs its tasks
> from the **repo root**, but ESLint is installed in `web/node_modules`. Plain `eslint --fix` therefore
> fails with `'eslint' is not recognized`. Spelling out `node web/node_modules/eslint/bin/eslint.js`
> resolves it deterministically, with no dependence on `PATH`.
>
> **Do not "fix" this by prepending `web/node_modules/.bin` to `PATH` in the hook.** That works when
> you test it in Bash but **fails inside the real hook**: Git's `sh` inherits a Windows-style,
> `;`-separated `PATH`, so a `:`-joined POSIX entry corrupts it. (Verified both ways.)
>
> ESLint still finds `web/eslint.config.js` on its own — since v10 it looks the config up from the
> **linted file's** directory upward, not from the cwd.

The config lives at the **root**, not in `web/`, because lint-staged resolves the **nearest** config
file to each staged file. A `web/.lintstagedrc.json` would win for `web/` files and reintroduce the
unresolvable-`eslint` failure above.

**What happens on `git commit`:**

1. lint-staged takes only the **staged** files.
2. Code files → `prettier --write` (auto-format) → `eslint --fix` (auto-fix + report).
3. If any **unfixable error** remains (e.g. an unused variable) → the commit is **blocked** and the
   working tree is restored to its pre-hook state.
4. If all clean → formatting fixes are re-staged and the commit proceeds.

### `backend/` (done)

The hook needed **no change**. `backend/` has its own `eslint.config.js` — the §4.2 naming block,
minus the React carve-outs, plus `UPPER_CASE` allowed on `objectLiteralProperty`/`typeProperty` for
env-var keys. The root `.lintstagedrc.json` gained one entry:

```json
"backend/**/*.{ts,js}": [
  "prettier --write",
  "node backend/node_modules/eslint/bin/eslint.js --fix"
]
```

Prisma's generated client is excluded everywhere it would otherwise be linted or formatted:
`globalIgnores(['dist', 'generated'])` in `backend/eslint.config.js`, and `backend/generated` in
`.prettierignore`. Prettier does not handle `.prisma` files at all — `npx prisma format` does.

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

`.vscode/extensions.json` (committed) recommends the four required extensions — opening the repo
prompts teammates to install them:

| Extension    | ID                          | Needed for                                              |
| ------------ | --------------------------- | ------------------------------------------------------- |
| Prettier     | `esbenp.prettier-vscode`    | Format-on-save                                          |
| ESLint       | `dbaeumer.vscode-eslint`    | Lint-fix-on-save                                        |
| EditorConfig | `editorconfig.editorconfig` | Indent, charset, EOL                                    |
| Prisma       | `Prisma.prisma`             | `.prisma` syntax highlighting, formatting, IntelliSense |

> **Without the Prisma extension, `.prisma` files render as undifferentiated plain text** — VS Code has
> no built-in language association for them. Prettier does not format `.prisma`; the Prisma extension
> does, and `settings.json` wires it up with `"[prisma]": { "editor.defaultFormatter": "Prisma.prisma" }`.
> The CLI equivalent is `npx prisma format`.

> `.vscode/` is intentionally **not** git-ignored so these shared settings travel with the repo. (Many
> default `.gitignore` templates exclude `.vscode/`; ours deliberately does not.)

---

## 8. New-developer setup

1. `git clone` the repo.
2. From the **root**: `npm install` — this runs the `prepare` script (`husky`), which **activates the
   git hooks** automatically. No manual hook setup.
3. `cd web && npm install` — install frontend deps (incl. ESLint).
4. `cd backend && npm install && npm run db:generate` — backend deps + the Prisma client (which is
   git-ignored, so a fresh clone has none and `npm run typecheck` fails until you generate it).
5. Open in VS Code → accept the **recommended extensions** prompt, then **reload the window**.

That's it — format-on-save and the pre-commit checks now work for them identically.

> ⚠️ **`extensions.json` only _recommends_; it never installs.** Dismiss the prompt once and you get a
> workspace where `.prisma` files render as flat white text (no language association) and
> `editor.codeActionsOnSave` silently does nothing (no ESLint extension to run it) — with no error
> anywhere to tell you why. Extensions also only attach on window load, so installing without
> reloading looks identical to not installing. If in doubt, install them explicitly:
>
> ```sh
> code --install-extension esbenp.prettier-vscode
> code --install-extension dbaeumer.vscode-eslint
> code --install-extension editorconfig.editorconfig
> code --install-extension Prisma.prisma
> ```
>
> Verify with `code --list-extensions`. Note the pre-commit hook still catches lint and formatting
> errors without any extension installed — the extensions only move that feedback from commit time to
> save time.

---

## 9. Useful commands

Run inside `web/`:

| Command                  | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `npm run lint`           | Check the whole `web/` for lint errors                         |
| `npx prettier --write .` | Format every file (one-off, e.g. after changing `.prettierrc`) |
| `npx prettier --check .` | Report unformatted files without changing them                 |

---

## 10. Troubleshooting

| Symptom                                                                | Cause / fix                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Commit blocked: `'eslint' is not recognized`                           | A `lint-staged` task calls `eslint` directly instead of `node web/node_modules/eslint/bin/eslint.js` — see §6 |
| Commit blocked: `… must match one of the following formats: camelCase` | A name violates §4.2. Rename it; this is not auto-fixable                                                     |
| Format-on-save does nothing                                            | Prettier extension not installed, or `editor.defaultFormatter` not set — see §7                               |
| Whole file shows as changed by you                                     | Line-ending drift — confirm `.gitattributes` + `.editorconfig` (§5); run `git add --renormalize .` once       |
| Hooks don't run at all                                                 | `npm install` not run at root (so `husky` `prepare` never ran) — see §8                                       |
| Commit blocked: `type may not be empty`                                | Message isn't Conventional Commits format (`feat: …`, `fix: …`) — see §6                                      |

---

## 11. Related docs

- `jobwork-process-webapp/docs/FRONTEND_SETUP.md` — frontend project setup.
- `Documents/jobwork-process/ARCHITECTURE_AND_TECH_STACK.md` — overall stack.
