# Plan: Tag and category suggestions

| | |
|---|---|
| Source | `docs/adr/0006-tag-category-suggestions.md`, `SPEC.md` FR-11, `docs/competitive-analysis.md` §4 P2a |
| Branch | `feat/tag-category-suggestions` |
| Test command | `npm run build && npm run lint && npm test` |
| Coder model | sonnet |

TDD where the target is a pure domain function (Task 1: vitest, red before green). `src/ui/prompt-modal.ts` is Obsidian-API-coupled glue with zero unit-test coverage by repo convention; Tasks 2-4 use scripted manual smoke in a dev vault instead, per the existing testing-boundary convention.

## Tasks

- [x] **Task 1 — Pure scorer domain module (TDD)**
  **Goal:** implement deterministic, case-insensitive keyword-frequency scoring per FR-11.1, as one function reused for both tags and categories.
  **Files:** create `tests/suggestions.test.ts` (write first, confirm it fails), create `src/domain/suggestions.ts` (implement to green). No other file changes in this task.
  **Contract:** `export function suggestValues(draftText: { title: string; useCase: string; body: string }, candidates: string[], selected: string[], limit: number): string[]`.
  Tokenize both the concatenated `draftText` fields and each candidate value with the same approach `src/domain/slug.ts#slugify` already uses: Unicode NFD normalize, strip diacritics, lowercase, split on `[^a-z0-9]+`, drop empty tokens. A candidate's score is the sum, over its own distinct tokens, of that token's frequency in the draft-text token multiset. Drop candidates already present in `selected` (exact string match) before scoring. Drop candidates that tokenize to zero tokens. Keep only candidates with score > 0. Sort survivors by score descending, then by the candidate string ascending (`localeCompare`) for deterministic ties. Return the first `limit` entries. Never throw; empty or duplicate-laden `candidates`/`selected` degrade to an empty or deduplicated result, never an exception (FR-11.4, NFR-8).
  **Test (vitest, exhaustive since this is the only unit-tested module in this feature):**
  - case-insensitive match (`"Review"` in draft text matches candidate `"review"`);
  - frequency ranking (a candidate whose tokens appear more often in the draft ranks above one that appears once);
  - multi-token candidate (`"code-review"` tokenizes to `["code", "review"]` and scores on either sub-token);
  - already-selected values never appear in the output;
  - zero-score candidates (no token overlap at all) are excluded, proving the threshold;
  - `limit` truncates a larger eligible pool to the requested count;
  - deterministic alphabetical tie-break when two candidates score equally;
  - empty `title`/`useCase`/`body` (all empty strings) returns `[]`;
  - empty `candidates` array returns `[]`;
  - duplicate entries in `candidates` never produce duplicate entries in the output.

- [x] **Task 2 — Tag suggestion chip row in the prompt modal**
  **Goal:** a "suggested tags" chip row under the tags chips box, recomputed as the user types, click-to-apply, hidden when empty (FR-11.2, FR-11.4).
  **Files:** modify `src/ui/prompt-modal.ts`; modify `styles.css` (add one layout class for the suggestion row, e.g. mirroring `.promptbox-filters__group` + `.promptbox-filters__label`; reuse the existing `.promptbox-chip` class, unselected/neutral variant, for the pills themselves — no new chip-color CSS needed).
  **Behavior contract:**
  - one container `HTMLElement`, created once per `display()` call, placed directly under the existing tags chips box;
  - a scoped render function (call it `renderTagSuggestions()`, matching the existing `renderChips()` naming) calls `suggestValues({ title: draft.title, useCase: draft.useCase, body: draft.body }, deps.tagPool, draft.tags, 5)` and rewrites only that one container's children; empty result empties the container and returns early (mirror `renderChips`'s empty-collapse idiom exactly, do not add new hide/show CSS);
  - title input, use-case input, and body textarea `onChange` handlers each (re)start one shared 150ms debounce timer (same `window.setTimeout`/`window.clearTimeout` idiom as `filter-bar.ts`'s search debounce; do not extract a shared debounce utility, this repo keeps the idiom inline per call site) whose callback calls `renderTagSuggestions()` only — **never `this.display()`** on these three handlers, since a full redraw would tear down and rebuild `contentEl` and steal focus/cursor position out of the field the user is actively typing in;
  - the existing "Add tag" `commit()` function and the tag "×" remove handler each call `renderTagSuggestions()` immediately (no debounce) right after their existing `renderChips()` call, since these are discrete actions, not per-keystroke;
  - clicking a suggestion chip: guard against a duplicate, push the value into `draft.tags`, then call the existing `renderChips()` and `renderTagSuggestions()`, exactly mirroring what `commit()` already does for manually typed tags;
  - `display()` renders the suggestion row once at the end of its normal pass (using current draft state), covering the initial paint.
  **Test (manual smoke, dev vault, no vitest — glue-layer convention):**
  1. Open "New prompt". Type a title/use-case/body sharing a keyword with an existing library tag (or a tag in `deps.tagPool`). Confirm the chip row appears, the more-frequent keyword match ranks first, and clicking a chip adds the tag to the field and removes it from the suggestion row.
  2. Clear all three text fields. Confirm the suggestion row disappears entirely (not merely empty-but-visible).
  3. Type rapidly across several keystrokes in title, use-case, and the body textarea. Confirm the input never loses focus, the cursor position never jumps, and no visible flicker of the whole form occurs, only the suggestion row updates.
  4. Repeat step 1 on "Edit prompt metadata" for an existing prompt that already has tags. Confirm suggestions still compute from title and use-case (body is unavailable in edit mode by existing design, per ADR-0006) and that already-present tags never reappear as suggestions.
  5. Resize the window to a mobile-width viewport (or use Obsidian's mobile emulation). Confirm suggestion chips meet the same 44px touch target already defined for `.promptbox-chip` under `.is-mobile`.

- [x] **Task 3 — Category suggestion chip row in the prompt modal**
  **Goal:** a "suggested category" chip row under the category dropdown, click-to-apply, hidden when empty (FR-11.2, FR-11.4). Continues the same file edit as Task 2.
  **Files:** modify `src/ui/prompt-modal.ts` only (reuses the `.promptbox-suggestions`-style CSS class added in Task 2).
  **Behavior contract:**
  - one container under the category `taxonomyRow`, created once per `display()`;
  - a scoped `renderCategorySuggestions()` calls `suggestValues({ title: draft.title, useCase: draft.useCase, body: draft.body }, deps.settings.categoryValues, draft.category ? [draft.category] : [], 3)`;
  - the same 150ms debounce timer wired in Task 2 also calls `renderCategorySuggestions()` on every title/use-case/body keystroke (one shared timer driving both scoped refreshes, not two separate timers);
  - the category `<select>`'s existing plain-selection `onChange` branch (the one that just does `this.draft[key] = v` today, distinct from the `NEW_VALUE` branch) additionally calls `renderCategorySuggestions()` immediately, no debounce, since a dropdown selection is a discrete event;
  - clicking a category suggestion chip sets `draft.category = value` and calls the existing `this.display()` (the same full-rebuild path the `NEW_VALUE` "New category..." flow already uses). A full rebuild is acceptable here specifically because the triggering event is a discrete click, not typing in progress, so there is no cursor position at risk, and `display()`'s normal render path already updates the dropdown's visible selection via `dropdownValues()`/`setValue()` with no need to retain a `DropdownComponent` reference as a new class field.
  **Test (manual smoke, dev vault):**
  1. With at least one configured category value that shares a keyword with a draft's use-case or title, confirm the category suggestion chip appears and ranks correctly.
  2. Click it. Confirm the dropdown's visible selection updates to that category and the suggestion chip disappears (now excluded as "already selected").
  3. Manually change the dropdown to a different configured value (not via a suggestion click). Confirm the suggestion row's exclusion updates to the newly selected value without needing a full-page reload to look right, and confirm this one discrete action is the only path that may briefly redraw the form (typing must never trigger this).
  4. Confirm a category dropdown with zero configured values, or a draft with no keyword overlap with any configured category, shows no suggestion row.

- [x] **Task 4 — Acceptance-criteria verification pass**
  **Goal:** confirm the four acceptance criteria from `SPEC.md` §3 pass literally, across create and edit modes, desktop and a mobile-width emulation, with explicit attention to the focus-preservation contract from Tasks 2-3 (the one non-obvious regression risk in this feature).
  **Files:** none (verification only).
  **Test (manual smoke, scripted):**
  - (a) draft body "review the pull request diff" with an existing tag `code-review` in the pool: tags chip row shows `code-review`; clicking it adds the tag chip to the field; nothing is written to the note until Save/Create is pressed;
  - (b) category `writing` configured in settings, draft use-case about email drafting: `writing` surfaces under the category dropdown; clicking it selects it;
  - (c) a tag already added to the draft never reappears in its own suggestion row;
  - (d) empty title, use-case, and body together: both suggestion rows are fully absent, not empty-but-rendered;
  - additionally: type continuously across all three free-text fields for several seconds and confirm no loss of focus, cursor position, or scroll offset at any point (the debounced-scoped-render contract is the thing most likely to regress silently).

- [x] **Task 5 — Full regression and closeout**
  **Goal:** confirm the change is contract-neutral and the full suite is green; close out the roadmap entry.
  **Files:** modify `PROJECT.md` (check off "tag and category suggestions" under Phase 1.5 with a completion date, matching the existing convention used for the favorites and context-variables entries).
  **Test:** run `npm run build && npm run lint && npm test` (typecheck, production build, eslint, and the *entire* vitest suite, not only `tests/suggestions.test.ts`). Confirm `tests/draft.test.ts`, `tests/prompt.test.ts`, `tests/query.test.ts`, `tests/indexer.test.ts`, `tests/slug.test.ts`, `tests/transfer.test.ts`, `tests/placeholders.test.ts`, and the new `tests/suggestions.test.ts` all pass, since `PromptDraft` and `PromptModalDeps` are shared types this change sits next to. No call-site updates are expected: grep confirms `new PromptModal(` has exactly two call sites (`src/main.ts`, create and edit paths), both via the unchanged `modalDeps()` builder, and no exported signature changed.

## Out of scope (per `SPEC.md` §5)

AI/semantic tagging, auto-tagging on import, suggestions outside the create/edit modal, new settings, type-field suggestions (FR-11.1 covers tags and category only).
