# Plan: Prompt linter (2026-07-03)

Source: `SPEC.md`, ADR-0010. Branch: `feat/prompt-linter`.
Test command (authoritative, `.claude/test-cmd`, must not change): `npm run build && npm run lint && npm test`.
Style: TDD — write/extend the test file first in each task, then the minimal implementation to pass it.

- [x] **Task 1 — Placeholder-level malformed/conflict detection (L1, L2 foundations)**

  **Goal:** two additive-only exports on `src/domain/placeholders.ts`, zero change to the existing `parsePlaceholders`/`resolvePlaceholders` signatures, behavior, or tests.
  - `hasMalformedPlaceholders(body: string): boolean` — true when (a) any well-formed-brace match's inner content fails `parseSegments` (empty name after trim, or >3 pipe segments), or (b) after removing every well-formed matched span from the body, the remaining text still contains a literal `{{` (unclosed opening, or the dangling brace left behind by a nested construct like `{{a{{b}}}}`).
  - `findConflictingVariableNames(body: string): string[]` — collect every occurrence (not deduplicated to first-wins) grouped by variable name; return the names, in first-appearance order, where ≥2 occurrences disagree on `defaultValue`, `hint`, or `options`.

  **Files:**
  - `src/domain/placeholders.ts` (modify — additive only; reuse the existing private `PLACEHOLDER_RE`/`parseSegments`, do not touch `parsePlaceholders`/`resolvePlaceholders`)
  - `tests/placeholders.test.ts` (modify — append two new `describe` blocks)

  **Test cases (vitest):**
  - `hasMalformedPlaceholders`: `"Hello {{name"` → `true`; `"{{}}"`, `"{{ }}"`, `"{{|def}}"` → `true`; `"{{a|b|c|d}}"` → `true`; `"{{a{{b}}}}"` → `true`; a body with only well-formed placeholders (or none) → `false`.
  - `findConflictingVariableNames`: `"{{a|x}} … {{a|y}}"` → `["a"]`; same value repeated (`"{{a|x}} {{a|x}}"`) → `[]`; two independently-conflicting names → both, in first-appearance order; a conflict where one occurrence has an option list and another has a plain default for the same name → counted as conflicting.
  - Full existing `tests/placeholders.test.ts` suite (12 pre-existing cases) still green, unmodified.

- [x] **Task 2 — Domain lint module: single-prompt rules, L6, orchestration**

  **Goal:** new pure module `src/domain/lint.ts`:
  - `LintFinding { ruleId: "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7"; severity: "warning" | "info"; message: string }`
  - `PromptLintResult { path: string; title: string; findings: LintFinding[] }`
  - `lintPrompt(prompt: Prompt, body: string): LintFinding[]` — L1 (`hasMalformedPlaceholders`, warning), L2 (`findConflictingVariableNames`, one finding per name, warning), L3 (`body.trim() === ""`, warning), L4 (`prompt.useCase.trim() === ""`, info), L5 (`prompt.category.trim() === ""`, info), L7 (one finding per string in `prompt.warnings`, warning).
  - `findDuplicateTitleFindings(prompts: Prompt[]): Map<string, LintFinding[]>` — L6, groups by (a) trimmed lower-cased title and (b) `slugify(title)` (import from `./slug`); any group of size ≥2 under either key adds a warning finding to every path in that group.
  - `lintLibrary(prompts: Prompt[], getBody: (path: string) => string): PromptLintResult[]` — one result per prompt, **unfiltered** (findings may be `[]`); merges `lintPrompt` output with `findDuplicateTitleFindings` by path.

  **Files:**
  - `src/domain/lint.ts` (new)
  - `tests/lint.test.ts` (new — follow the `p(path, fm)` + `BODIES: Record<string,string>` fixture convention already used in `tests/query.test.ts`)

  **Test cases (vitest, mapping directly to SPEC §3 acceptance criteria):**
  - Body `"Hello {{name"` → `lintPrompt` includes an `L1` warning.
  - Body `"{{a|x}} … {{a|y}}"` → `lintPrompt` includes an `L2` warning naming `a`.
  - Empty body → `L3` warning; whitespace-only body → `L3` warning.
  - Missing `use_case` → `L4` info; missing `category` → `L5` info.
  - A prompt with `warnings: ["invalid quality: expected integer 1-5"]` → `lintPrompt` includes an `L7` warning carrying that exact message.
  - Two prompts titled `"draft email"` and `"Draft Email"` → `findDuplicateTitleFindings` returns an entry for both paths (`L6`, warning).
  - Two prompts whose titles differ only by accent/case such that `slugify()` collides (e.g. `"Café Idea"` vs `"cafe idea"`) → both flagged under `L6` via the slug key even though the trimmed-lowercase titles differ.
  - A fully well-formed prompt (non-empty body, no placeholders, `use_case` and `category` set, no `warnings`, unique title) → `lintPrompt` returns `[]` and it is absent from `findDuplicateTitleFindings`.
  - `lintLibrary([], () => "")` → `[]`, no throw (empty-library acceptance criterion).
  - `lintLibrary` on a small mixed library → returns one `PromptLintResult` per input prompt, in the same order, well-formed ones with `findings: []`.

- [x] **Task 3 — Report modal and shared "open as note" helper**

  **Goal:**
  - `src/ui/open-note.ts`: `openNote(app: App, path: string): Promise<void>` — resolve the file via `app.vault.getFileByPath`, `new Notice("Note not found — the index may be stale.")` if missing, otherwise `await app.workspace.getLeaf(false).openFile(file)`. Extracted verbatim from `library-view.ts`'s existing private `openAsNote`.
  - `src/ui/lint-modal.ts`: `LintModal extends Modal` (follow the `ConfirmModal`/`ImportModal` construction pattern: `contentEl.addClass(...)`, `this.setTitle(...)`). Constructor takes `app: App`, the full `PromptLintResult[]` (already computed by the caller — this modal never calls `lintLibrary` itself), and an optional `scopedToPath?: string`. On open: filter to `scopedToPath` if set, then to `findings.length > 0`; if the visible set is empty, render "No issues found."; otherwise render a summary line with warning/info counts, then one section per prompt (title, one line per finding showing `ruleId`, severity, message, and an "open as note" button per FR-16.4 wired to `openNote`).
  - `src/ui/library-view.ts` (modify): replace the body of the private `openAsNote` method with a call to the new shared `openNote` helper (mechanical, no behavior change — same file, same call sites).

  **Files:**
  - `src/ui/open-note.ts` (new)
  - `src/ui/lint-modal.ts` (new)
  - `src/ui/library-view.ts` (modify — `openAsNote` delegates to `openNote`; no other change in this task)

  **Test:** UI glue per SPEC §4 (report modal and command wiring are not vitest-covered) — verify by manual smoke:
  - Run "Lint library" on an empty vault folder → modal shows "No issues found.", no error in the console.
  - Run it on a small library with a mix of well-formed and problem prompts → grouped sections appear only for prompts with findings, severity counts match, "open as note" opens the correct file.

- [x] **Task 4 — Badge unification in the library view + command registration**

  **Goal:**
  - `src/ui/library-view.ts`: in `render()`, compute `const lintByPath = new Map(lintLibrary(index.getAll(), (p) => index.getBody(p)).map((r) => [r.path, r]));` once, and pass the relevant `PromptLintResult | undefined` into `renderItem`. Inside `renderItem`, replace the current badge block (`if (prompt.warnings.length > 0) { … }`, lines 104-108) with: show the same `promptbox-item__warning` badge (same icon, `alert-triangle`) when `result.findings.some(f => f.severity === "warning")`, aria-label summarizing the warning-severity messages, and a click handler opening `new LintModal(this.app, allResults, { scopedToPath: prompt.path }).open()` (reuse the single `lintLibrary()` call already made in `render()`, do not recompute per card).
  - `src/main.ts`: register `addCommand({ id: "lint-library", name: "Lint library", callback: () => new LintModal(this.app, lintLibrary(this.index.getAll(), (p) => this.index.getBody(p))).open() })`.
  - `styles.css`: add `cursor: pointer;` to the existing `.promptbox-item__warning` rule (it is now always clickable).

  **Files:**
  - `src/ui/library-view.ts` (modify)
  - `src/main.ts` (modify)
  - `styles.css` (modify — one-line addition)

  **Observable-contract change — call-sites checked:** this replaces the trigger condition, aria-label text, and click behavior of the existing badge (previously `prompt.warnings.length > 0`, static tooltip, no click). Grep across the repo for `promptbox-item__warning`, `Frontmatter issues`, `alert-triangle`, and `.warnings` (run before this plan was written) found the condition/label used only inside `library-view.ts` itself; the sole test file touching this data, `tests/prompt.test.ts`, asserts on the raw `prompt.warnings` array (domain output of `normalizePrompt`), never on how the UI renders it — that file needs no change. No automated call-site needs updating; verify the new condition/label/click by manual smoke instead (empty-findings prompt → no badge; warning-severity findings → badge with click opening the scoped modal; info-only findings, e.g. only L4/L5 → no badge, consistent with FR-16.2's "at least one warning-severity finding").
  **Test:** manual smoke as above, plus — since this task touches a shared render path — re-run the **full** test suite (not just `lint.test.ts`/`placeholders.test.ts`) to catch any incidental regression from the `library-view.ts`/`main.ts` changes.

- [x] **Task 5 — Full verification**

  **Goal:** confirm the whole change set is green end-to-end, not just the two new/modified test files.

  **Files:** none (verification only).

  **Test:** `npm run build && npm run lint && npm test` — must be fully green (typecheck, production build, ESLint, the entire vitest suite including `tests/lint.test.ts`, `tests/placeholders.test.ts`, and every pre-existing test file). This is the repo's CI-equivalent gate (`main` is branch-protected) and the check this plan's SPEC constraint (`.claude/test-cmd` is authoritative and must not change) points to.
