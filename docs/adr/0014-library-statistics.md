# ADR-0014: Library statistics as a read-only report modal over a pure domain aggregator

| | |
|---|---|
| Status | Accepted |
| Date | 3 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `SPEC.md` (library-statistics), `docs/competitive-analysis.md` §6 N8, `PROJECT.md` Phase 1.5, ADR-0001, ADR-0002 |

## Context

`docs/competitive-analysis.md` §6 N8 proposes a stats panel over the library: counts by taxonomy, quality distribution, oldest-untouched prompts, and taxonomy orphans (values used in notes but absent from settings). This is the last scheduled Phase 1.5 item; every other entry on that list is done.

The orphan-detection half closes a real, silent gap: FR-8.2 lets a user delete a configured type/category value from settings, but that never touches existing notes, so notes can carry a `type`/`category` string that no longer appears anywhere in the UI's taxonomy pickers. Nothing today surfaces that drift back to the user.

Hard constraints carried over from `SPEC.md`:

- FR-22.1: a pure aggregator over `Prompt[]` plus the settings taxonomy, vitest-covered, computing totals, per-type/per-category counts, top-10 tags by count, a quality distribution (1-5 plus "unset"), the 10 oldest prompts by `updated`, and orphan type/category values with usage counts.
- FR-22.2-22.4: a "Library statistics" command opens a report modal; empty sections read "none"; an empty library shows one friendly empty state, never a crash (NFR-8); stale rows get an "open as note" action; orphan rows are purely informational (a hint that the value is re-addable in settings, no button that writes anything); the whole feature performs zero note writes, zero settings writes, adds no frontmatter and no new settings fields.
- Constraint §4: the aggregator lives in `src/domain/` with no Obsidian imports; the modal is UI glue verified by manual smoke (project convention: only `src/domain/*` gets vitest coverage); computation happens on modal open only (no caching, no live subscription); no network calls (binding, ADR-0001/ADR-0002).
- Out of scope (§5): charts/graphs, usage/copy tracking, embedding the report in the library view, exporting the stats.

This ADR assumes the reader has ADR-0001 (notes as source of truth, disposable in-memory index) and ADR-0002 (native Obsidian UI, vanilla TypeScript, one `styles.css`) as binding background; neither is re-litigated here.

## Decision

Add one new pure domain module and one new UI surface, wired through a single new command. No existing file's public contract changes.

**`src/domain/stats.ts`** (new, no Obsidian imports, 100% vitest-covered):

```ts
export interface CountEntry {
  value: string;
  count: number;
}

export interface QualityDistribution {
  /** Exactly 5 entries, ratings "1".."5" in ascending order; count may be 0. */
  ratings: CountEntry[];
  /** Prompts with no quality set. */
  unset: number;
}

export interface StaleEntry {
  path: string;
  title: string;
  updated: string;
}

export interface StatsTaxonomy {
  typeValues: string[];
  categoryValues: string[];
}

export interface LibraryStats {
  total: number;
  byType: CountEntry[];
  byCategory: CountEntry[];
  topTags: CountEntry[];
  quality: QualityDistribution;
  stale: StaleEntry[];
  orphanTypes: CountEntry[];
  orphanCategories: CountEntry[];
}

export function computeLibraryStats(prompts: Prompt[], taxonomy: StatsTaxonomy): LibraryStats;
```

Behavior, pinned precisely so the plan and the coder share one reading:

- `total` is always `prompts.length`. A prompt that `normalizePrompt` had to degrade (NFR-8) still counts; degraded fields already resolved to safe defaults upstream, so this function never special-cases warnings.
- `byType` / `byCategory`: every **distinct** value actually found on the prompts (categories: excluding the empty string, mirroring the existing `collectOptions()` convention in `library-view.ts` that also treats `""` as "no category"), each with its usage count. **Uncapped** — taxonomy cardinality is naturally small, unlike tags. Sort: count descending, then value ascending (`localeCompare`), matching the tie-break style already used in `src/domain/query.ts`'s comparators.
- `topTags`: same sort rule, **capped to the top 10**.
- `quality.ratings`: fixed 5 entries for ratings 1 through 5 **in that ascending order** (not sorted by count — this is a distribution read top-to-bottom by rating, the one section where ordinal order beats count-desc). `quality.unset` counts prompts with `quality === undefined`. `total` always equals the sum of all 5 rating counts plus `unset`.
- `stale`: the 10 prompts with the lexicographically smallest `updated` (oldest first; ISO `YYYY-MM-DD` strings compare correctly as strings, same assumption `query.ts`'s `DateRange` already documents), tie-break title ascending. Fewer than 10 when the library has fewer than 10 prompts.
- `orphanTypes` / `orphanCategories`: the subset of `byType` / `byCategory` whose value fails `isCustomValue(value, configured)` from `src/domain/prompt.ts` — reusing that existing, already-tested primitive verbatim rather than re-implementing the same `!configured.includes(value)` check. Same sort rule as their parent list, uncapped.
- No branch for the empty-library case: with `prompts = []`, the function returns a fully-shaped `LibraryStats` (`total: 0`, all lists `[]`, `quality.ratings` five zero-count entries, `quality.unset: 0`). Whether an empty library collapses to one friendly message is a UI decision, not a domain one.
- All returned values are raw data (counts, ISO date strings, vault paths) — no user-facing prose. Formatting ("10 oldest by updated", the orphan hint sentence, "★★★☆☆"-style labels) is built entirely in the modal.

**`src/ui/stats-modal.ts`** (new, UI glue, manual smoke only):

- A `Modal` subclass (matches `ConfirmModal`/`PromptModal`), constructed with `(app, plugin)`. On `onOpen()` it calls `computeLibraryStats(this.plugin.index.getAll(), { typeValues: this.plugin.settings.typeValues, categoryValues: this.plugin.settings.categoryValues })` — a one-shot snapshot, no `index.onChange()` subscription and therefore no `onClose()` cleanup needed, matching "computation on modal open only."
- If `total === 0`: render one empty-state block only (mirrors `renderEmptyState` in `library-view.ts`), skip every other section entirely.
- Otherwise render 7 sections, in this fixed order: Totals -> By type -> By category -> Top tags -> Quality distribution -> Stale prompts -> Taxonomy orphans. Any individual section whose list is empty (orphans being the common case) renders one "None" line instead of an empty container.
- Stale rows: title, `updated` date, and an "open as note" button. Behavior mirrors `PromptboxLibraryView.openAsNote` (`app.workspace.getLeaf(false).openFile(file)`, with a `Notice` fallback if the path no longer resolves to a `TFile` because the index is stale) — duplicated as ~5 lines rather than extracted into a shared helper (see Alternatives).
- Orphan rows: value, usage count, and a static hint sentence ("Add '<value>' back in Settings -> Promptbox to keep tracking it."). No buttons, no click handlers — nothing here writes anything (FR-22.3, FR-22.4).
- Reuses `.promptbox-modal--wide` for width; adds a small set of additive `.promptbox-stats*` BEM-ish classes to `styles.css` for section layout, count rows, and the "none" line, following the existing variable-driven, `.is-mobile` 44px-touch-target convention already in the file. No existing CSS rule is renamed or removed.

**`src/main.ts`** (modify — additive only): one new `addCommand({ id: "library-statistics", name: "Library statistics", callback: () => new StatsModal(this.app, this).open() })`, following the exact shape of the existing `export-json`/`import-json` commands. No existing command's id, name, or callback changes.

## Alternatives considered

1. **Embed a live-updating stats panel inside the existing `PromptboxLibraryView`, subscribed to `index.onChange()` like the rest of that view.** Rejected: explicitly out of scope per `SPEC.md` §5 ("library-view embedding"); it would also turn a curation snapshot into a continuously-recomputed panel that re-runs six aggregations (including two sorts) on every vault edit, for a feature whose entire value is "look occasionally, then close it" — the spec's own "computation on modal open only" constraint rules this out directly.
2. **A second full-tab `ItemView` dedicated to statistics, parallel to `PromptboxLibraryView`, opened via a ribbon icon plus a command.** Rejected: an `ItemView` needs view-type registration, workspace-leaf activation logic (`activateLibraryView`-style), and its own `onClose()` cleanup bookkeeping — real weight for an effort-S feature used occasionally, not continuously. A transient `Modal` (open, read, close) matches the actual usage pattern with none of that lifecycle surface, exactly like `ConfirmModal` and `PromptModal` already do for their own occasional-use flows.
3. **Five separate exported pure functions (`countByType`, `countByCategory`, `topTags`, `qualityDistribution`, `findStale`, `findOrphans`) that the modal composes ad hoc, instead of one `computeLibraryStats` entry point.** Rejected: FR-22.1 frames these six facets as one report, and there is exactly one call site (the modal, on open) that always needs all of them together. A single entry point gives one test surface and one place to keep `total` consistent across sections (e.g., the quality buckets always summing to `total`); the flexibility five separate functions would buy (calling a subset independently) has no current consumer, and adding it speculatively would be scope creep the SPEC's own "out of scope" list warns against.
4. **Cache computed stats on `PromptIndex` and maintain them incrementally on every `scan()` / `handleCreateOrModify()` / `handleDelete()` event, the way the index already maintains `prompts` and `bodies`.** Rejected: over-engineering for a report opened on demand. The SPEC pins "computation on modal open only," the project's own performance target is ~1,000 prompts (NFR-1), and a single-pass aggregation plus two bounded sorts (top-10 tags, oldest-10) over that size is sub-millisecond. Incremental maintenance would mean partially re-deriving a top-10 and a bottom-10 ranked list on every single note edit — real complexity bought for a benefit nobody asked for and the constraint explicitly declines.
5. **A shared `openNoteByPath(app, path)` helper extracted out of `library-view.ts`'s `openAsNote`, imported by both the view and the new modal, instead of duplicating the ~5-line logic.** Rejected for this feature: it would either live in a view module that a modal would then depend on (backwards layering — modals importing from a full-tab view), or need a brand-new one-function utility file, disproportionate for a five-line, `this.app`/`Notice`-coupled snippet. The codebase already tolerates equivalent small duplication elsewhere (the `error instanceof Error ? error.message : String(error)` formatting appears verbatim in both `main.ts` and `library-view.ts`), so this stays consistent with an existing, accepted pattern rather than introducing a new shared-utility layer for one call site.

## Consequences

**Positive:** the feature is fully additive — no existing function signature, command id, settings field, frontmatter shape, or CSS rule changes, so there is no migration and no risk to any of the ten prior Phase 1.5 features once they land. The orphan-detection half closes the FR-8.2 gap with zero new mechanism: it is a read-only cross-reference over data the index and settings already hold, reusing the already-tested `isCustomValue` primitive verbatim. The domain/UI split keeps the entire computational surface (six aggregations, two sorts, one cross-reference) unit-testable without any Obsidian mock, consistent with the project's established "domain gets vitest, UI glue gets manual smoke" convention, so this feature adds real automated coverage rather than expanding the untested surface. The modal pattern (transient, one-shot, no subscription) needs no new cleanup bookkeeping and therefore cannot leak a listener on unload, keeping store-guideline compliance (CLAUDE.md "Gotchas") free.

**Negative and accepted:** the ~5-line "open as note" logic now exists in two places (`library-view.ts` and `stats-modal.ts`) rather than one shared helper (Alternative 5); if that logic ever grows non-trivial, a future refactor should extract it, but today it would add a cross-module dependency for no real benefit. Taxonomy values are compared verbatim (no case-folding or whitespace-trimming beyond what `normalizePrompt` already does), so `"Task"` and `"task"` count as two distinct orphan buckets if both occur — this mirrors the exact behavior `collectOptions()` in `library-view.ts` already has today, so it is a pre-existing, accepted limitation carried forward, not a new one introduced here. A prompt whose `type`/`category` was defaulted by `normalizePrompt` because the original frontmatter was invalid (NFR-8) still contributes to `byType`/`byCategory`/orphans under its resolved value; the existing per-note warning badge in the library view is the mechanism that already surfaces that underlying data-quality issue, so this feature does not need to duplicate it.

**Neutral:** the report is a point-in-time snapshot with no auto-refresh; reopening the command recomputes fresh, which is the intended and spec-mandated behavior, not a limitation to fix. `PROJECT.md`'s Phase 1.5 checkbox for this feature is orchestrator-owned bookkeeping (per this project's established convention) and is intentionally out of scope for both this ADR and the implementation plan derived from it.

## References

- `SPEC.md` (root, this feature) — FR-22.1 through FR-22.4, acceptance criteria, constraints, out-of-scope list.
- `docs/competitive-analysis.md` §6 N8 — original proposal and rationale ("no competitor reports on the library as a corpus").
- `PROJECT.md` Phase 1.5 — sequencing; this is the last scheduled entry.
- ADR-0001 (`docs/adr/0001-storage-markdown-frontmatter.md`) — notes as source of truth, disposable in-memory index; binding background.
- ADR-0002 (`docs/adr/0002-ui-native-obsidian-components.md`) — native `Modal`/`Setting`, vanilla TypeScript, one `styles.css`; binding background.
- Internal precedent drawn on directly: `src/domain/prompt.ts` (`isCustomValue`, reused for orphan detection), `src/domain/query.ts` (sort/tie-break and ISO-date-range comparison conventions), `src/ui/confirm-modal.ts` and `src/ui/prompt-modal.ts` (`Modal` construction patterns), `src/ui/library-view.ts` (`openAsNote`, `renderEmptyState`, `collectOptions` category-exclusion convention).
