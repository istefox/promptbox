# Plan: Library statistics (FR-22, ADR-0014)

Source: `SPEC.md` (root), `docs/competitive-analysis.md` §6 N8. Design: `docs/adr/0014-library-statistics.md`. Last scheduled Phase 1.5 feature.

No existing observable contract changes (no function signature, command id, settings field, frontmatter shape, or CSS rule is modified — only additions). Confirmed by grep: no pre-existing use of "stats"/"statistics" anywhere in `src/`, `tests/`, or `styles.css`; `isCustomValue` in `src/domain/prompt.ts` is reused unmodified. No staleness-fix task is required.

Full authoritative test command (run after every task, not just task 1's new file): `npm run build && npm run lint && npm test`.

## Task 1 — Domain aggregator: `computeLibraryStats`

Goal: pure aggregator over `Prompt[]` + settings taxonomy producing totals, per-type/per-category counts, top-10 tags, quality distribution (1-5 plus unset), the 10 oldest prompts by `updated`, and type/category orphans with usage counts (FR-22.1). Write the tests first (TDD): they should fail against a stub, then pass once the aggregator is implemented.

Files:
- `tests/stats.test.ts` (new) — mirror the style of `tests/query.test.ts` (same `p()`/`normalizePrompt` fixture-building helper, `describe` per concern).
- `src/domain/stats.ts` (new) — exports `CountEntry`, `QualityDistribution`, `StaleEntry`, `StatsTaxonomy`, `LibraryStats`, `computeLibraryStats(prompts, taxonomy)`, exact shape per ADR-0014's Decision section.

Test cases to cover (vitest, no Obsidian import needed):
- `total` equals `prompts.length` for a mixed fixture, including a prompt with a normalization warning (still counted).
- `byType`/`byCategory`: distinct values found across the fixture, each with the correct count, uncapped, sorted count-desc then value-asc; empty `category` (`""`) is excluded from `byCategory` (mirrors `library-view.ts`'s `collectOptions()`).
- `topTags`: capped at 10 even with 15+ distinct tags in the fixture; same count-desc/value-asc sort; ties broken alphabetically.
- `quality.ratings` has exactly 5 entries for `"1"`..`"5"` in that ascending order (not sorted by count) with correct per-rating counts, including a rating with count 0; `quality.unset` counts prompts with no `quality` field; assert `quality.unset + sum(quality.ratings[*].count) === total`.
- `stale`: returns the 10 prompts with the lexicographically smallest `updated`, oldest first, tie-break title-asc; with fewer than 10 prompts in the fixture, returns all of them in the same order.
- `orphanTypes`/`orphanCategories`: fixture with 3 types in use and only 2 in the taxonomy input (mirrors the SPEC acceptance criterion) — the missing one appears in `orphanTypes` with its correct usage count; a type/category that IS configured never appears in either orphan list.
- Empty input (`prompts: []`): returns a fully-shaped `LibraryStats` — `total: 0`, `byType`/`byCategory`/`topTags`/`stale`/`orphanTypes`/`orphanCategories` all `[]`, `quality.ratings` five zero-count entries, `quality.unset: 0`. No throw.

Run: `npm test` while iterating; full command before moving on.

## Task 2 — Report modal, command, and styles

Goal: a "Library statistics" command opens a read-only report `Modal` with the 7 sections in fixed order (Totals, By type, By category, Top tags, Quality distribution, Stale prompts, Taxonomy orphans); an empty library shows one friendly empty state instead of the sections; an empty individual section shows a "None" line; stale rows carry an "open as note" action; orphan rows are informational text plus a re-add hint, no buttons; zero writes anywhere (FR-22.2, FR-22.3, FR-22.4).

Files:
- `src/ui/stats-modal.ts` (new) — `Modal` subclass, constructor `(app, plugin: PromptboxPlugin)`; computes `computeLibraryStats(...)` in `onOpen()` only (no `index.onChange()` subscription, no `onClose()` needed); renders the empty-state short-circuit when `total === 0`; otherwise the 7 sections per ADR-0014. "Open as note" mirrors `PromptboxLibraryView.openAsNote` (`app.workspace.getLeaf(false).openFile(file)` + `Notice` fallback on a stale/missing path) — duplicated inline per ADR-0014 Alternative 5, not extracted.
- `src/main.ts` (modify) — add one `addCommand({ id: "library-statistics", name: "Library statistics", callback: () => new StatsModal(this.app, this).open() })` next to the existing `export-json`/`import-json` commands. No existing command block changes.
- `styles.css` (modify, additive only) — new `.promptbox-stats*` classes for section headings, count rows, and the "None" line; reuse `.promptbox-modal--wide` for width and the existing `.is-mobile` 44px touch-target convention for the "open as note" buttons. No existing rule renamed or removed.

Test (UI glue — project convention is manual smoke here, no vitest for this file): perform and record each of the following before calling the task done:
- Empty vault (or a temporary empty prompts folder): run "Library statistics" — see the friendly empty state only, no console errors, no other sections rendered.
- A library with 3 distinct types in use and only 2 configured in settings: the missing one appears under Taxonomy orphans with its correct usage count and the re-add hint text; confirm no button/click-handler exists on that row (inspect the rendered DOM or the source directly).
- Quality section shows all of ratings 1-5 plus "unset" even when one or more buckets are 0.
- Stale section lists up to 10 oldest-by-`updated` prompts with visible dates; clicking "open as note" opens the correct file in the main workspace pane; deleting/renaming a listed note out from under a stale index reference falls back to the `Notice` path instead of throwing.
- Resize the app window to a mobile-equivalent width (or toggle the `is-mobile` body class): touch targets on the "open as note" buttons are >=44px, no horizontal scrollbar appears.
- Grep `src/ui/stats-modal.ts` for any write-capable call (`.modify(`, `.create(`, `.process(`, `.rename(`, `.delete(`, `saveData(`, `fileManager.`) — expect zero matches, confirming FR-22.4.

## Task 3 — Full verification and DoD closure

Goal: confirm the feature is genuinely done against every SPEC.md acceptance criterion and that nothing outside this feature regressed.

Files: none (verification only). Check off this plan's `- [ ]` boxes as each task closes; do not edit `PROJECT.md` (orchestrator-owned per project convention) or `docs/adr/README.md` (already updated alongside ADR-0014).

Test:
- Run the full authoritative command: `npm run build && npm run lint && npm test` — must be green (typecheck, production build, lint, and the entire existing vitest suite, not only `tests/stats.test.ts`; a contract-touching change elsewhere could in principle break unrelated modules, so the full suite is the bar, even though this feature is additive-only).
- Re-walk all 4 SPEC.md acceptance criteria end-to-end in a real (or test) vault: (1) 3 types in use / 2 configured -> orphan with usage count; (2) quality distribution shows all of 1-5 plus unset; (3) stale section lists the 10 oldest with dates and "open as note" works; (4) empty library shows the empty state, no errors.

## Task checklist

- [x] Task 1 — `computeLibraryStats` domain aggregator, TDD, vitest-covered.
- [ ] Task 2 — Stats report modal, command wiring, styles.css additions, manual smoke recorded.
- [ ] Task 3 — Full build/lint/test green, all 4 acceptance criteria re-verified.
