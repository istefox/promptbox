# Plan: Related prompts

| | |
|---|---|
| ADR | [0012-related-prompts.md](../adr/0012-related-prompts.md) |
| Spec | `SPEC.md` (repo root, topic `related-prompts`) |
| Scope | FR-18 (similarity scorer), FR-19 (edit-modal surface) |
| Test command | `npm run build && npm run lint && npm test` (`.claude/test-cmd`, authoritative — do not change it) |
| Out of scope | Body-content similarity, a library-view "related" panel, embeddings/semantic scoring, any new settings or frontmatter |

Tasks are ordered by dependency: 1 (domain) unblocks 2 (deps wiring), which unblocks 3 (UI render), which is proven by 4 (verification).

## Tasks

- [ ] **1. Domain scorer and ranking — `similarityScore` and `relatedPrompts`**
  - **Goal:** implement FR-18.1 (weighted-sum scorer) and FR-18.2 (`relatedPrompts` ranking) as pure functions, TDD (write the failing tests first, from the list below, then implement).
  - **Files:** create `src/domain/related.ts` (no Obsidian imports), create `tests/related.test.ts`.
  - **Test (`tests/related.test.ts`, vitest):** reuse the `p(path, fm)` fixture-building idiom already used in `tests/query.test.ts` (wraps `normalizePrompt`). Cover:
    - `similarityScore`: returns `0` for two prompts sharing nothing.
    - `similarityScore`: `+3` per shared tag; tags compared as deduplicated sets (a tag repeated within one prompt's own `tags` array must not inflate the count beyond the number of distinct shared tags).
    - `similarityScore`: `+2` only when both `category` values are non-empty and equal; two prompts that are both `category: ""` score `0` for category.
    - `similarityScore`: `+1` per distinct shared token from `title` + `use_case` combined, case-insensitive and diacritics-insensitive (e.g. `"Città"` vs `"citta"`, `"RESUME"` vs `"resume"`); a token repeated across `title` and `use_case` within the same prompt counts once.
    - `similarityScore`: additive combination of all three components in one case (e.g. 2 shared tags + same category + 1 shared token = `6 + 2 + 1 = 9`).
    - `similarityScore`: symmetric — `similarityScore(a, b) === similarityScore(b, a)` for a representative pair.
    - `similarityScore`: tags are matched case-sensitively — a prompt tagged `"Code"` does not match one tagged `"code"` (documents the ADR-0012 accepted trade-off).
    - `relatedPrompts`: acceptance criterion 1 verbatim — a prompt sharing 2 tags and the same category outranks a prompt sharing 1 title token.
    - `relatedPrompts`: acceptance criterion 2 verbatim — a prompt with fully unique tags, category, and title scores zero against everything else and is excluded (empty result).
    - `relatedPrompts`: excludes `target` itself even when present in `all`.
    - `relatedPrompts`: excludes zero-score prompts; only strictly positive matches are returned.
    - `relatedPrompts`: tie-break — equal score, newest `updated` first.
    - `relatedPrompts`: tie-break — equal score and equal `updated`, `path` ascending.
    - `relatedPrompts`: `limit` defaults to 5 when omitted; an explicit smaller `limit` truncates to the top-N by score.

- [ ] **2. Thread `allPrompts` through the modal deps**
  - **Goal:** make a full `Prompt[]` snapshot available to `PromptModal` via the existing narrow-deps pattern, with no behavior change for current callers.
  - **Files:** modify `src/ui/prompt-modal.ts` (add `allPrompts: Prompt[]` to the `PromptModalDeps` interface only — do not consume it yet, that is Task 3); modify `src/main.ts` (`modalDeps()` adds `allPrompts: this.index.getAll()` next to the existing `tagPool: this.buildTagPool()`).
  - **Contract change:** `PromptModalDeps` gains one required field. Grep already run for this plan, full result: the interface is declared once (`src/ui/prompt-modal.ts:10`) and consumed as a constructor parameter type once (`src/ui/prompt-modal.ts:63`); the only production call-site building this shape is `main.ts`'s `modalDeps()` (`src/main.ts:150`), used by exactly two callers (`src/main.ts:172` `openCreateModal`, `src/main.ts:182` `openEditModal`), both of which need no change themselves since they consume `modalDeps()`'s return value. No test file constructs a `PromptModalDeps` literal (no `prompt-modal.test.ts` exists). This is a fully additive, backward-compatible widening.
  - **Test:** no new automated test at this step (no new observable behavior yet). Run `npm run build` (`tsc -noEmit`) to confirm the widened interface still type-checks against its one producer; run the full `npm test` afterward anyway since this is a shared-interface change (see Task 4).

- [ ] **3. Render the read-only Related section in the edit modal, plus styles**
  - **Goal:** implement FR-19.1/19.2 — compute the related list once (edit mode only), render it read-only, hide it when empty or in create mode, wire the "open as note" action.
  - **Files:** modify `src/ui/prompt-modal.ts` (import `relatedPrompts` from `../domain/related`; add `private readonly related: Prompt[]`, set once in the constructor: `mode.kind === "edit" ? relatedPrompts(mode.prompt, deps.allPrompts, 5) : []`; add a `renderRelated()` method called from `display()`, guarded by `this.related.length > 0`, placed after the Version/Body fields and before the final Save/Cancel `Setting` row); modify `styles.css` (new block, BEM-named, following the file's existing convention):
    ```
    .promptbox-related { margin-top: var(--size-4-3); padding-top: var(--size-4-2); border-top: 1px solid var(--background-modifier-border); }
    .promptbox-related__heading { font-size: var(--font-ui-smaller); color: var(--text-muted); margin-bottom: var(--size-2-2); }
    .promptbox-related__item { display: flex; align-items: center; gap: var(--size-2-2); padding: var(--size-2-2) 0; }
    .promptbox-related__title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .is-mobile .promptbox-related__action { min-height: 44px; min-width: 44px; }
    ```
    (illustrative — spacing/values may be adjusted; the class names and the mobile touch-target rule are the binding part). Reuse `.promptbox-pill.promptbox-pill--type` unchanged for the type badge; do not duplicate pill styling under a new class.
  - **Behavior detail:** each row's "open as note" button resolves `this.app.vault.getFileByPath(relatedPrompt.path)` (no new deps method needed — the modal already has `this.app`), calls `deps.openFile?.(file)` **before** `this.close()` (same order as this file's existing "Open note to edit body" button), and on a missing file shows `new Notice("Note not found — the index may be stale.")` (same wording as `library-view.ts`'s `openAsNote`) without closing the modal.
  - **Test:** no automated test (matches the established project convention: only `src/domain/*`-shaped code gets vitest coverage; `PromptModal` has no test file today). Manual smoke, mapped 1:1 to `SPEC.md` §3 acceptance criteria:
    - edit a prompt with ≥1 related match → section visible, at most 5 rows, each showing title + type pill + one "open as note" icon button, no score visible anywhere.
    - edit a prompt with zero related matches → section entirely absent (no heading, no empty-state placeholder).
    - open "New prompt" (create mode) → section absent.
    - click "open as note" on a related row → modal closes, the correct note opens in the active leaf; no console errors.
    - on a touch/mobile layout → the action button meets the 44px touch target, consistent with existing item actions.

- [ ] **4. Full verification pass**
  - **Goal:** confirm the change is safe project-wide, not just for the new module, before it is considered done.
  - **Files:** none (verification only).
  - **Test:** run `npm run build && npm run lint && npm test` — the **full** suite, not filtered to `tests/related.test.ts`, because Task 2 widens the shared `PromptModalDeps` interface and a contract change can break assumptions in unrelated tests even when it looks purely additive. Then, in a live vault: re-walk all four `SPEC.md` §3 acceptance criteria end-to-end (listed under Task 3); confirm `.claude/test-cmd` is unchanged; confirm no new settings, frontmatter fields, or network calls were introduced (FR-19.3 self-check); confirm the plugin still loads and unloads cleanly with no console errors.

## Notes for the coder

- `docs/adr/README.md` already has its ADR-0012 index row added by the architecture step; no action needed there.
- Do not touch `PROJECT.md` or the chain manifest (`docs/manifests/2026-07-03-related-prompts.manifest.yml`) — both are orchestrator-owned.
- If `similarityScore`'s tokenizer needs a name, keep it private/unexported (module-internal); only `similarityScore` and `relatedPrompts` are the module's public surface, matching how `src/domain/slug.ts` and `src/domain/prompt.ts` keep their internal helpers unexported.
