# ADR-0010: Prompt linter as pure domain rules with a shared per-render lint pass

| | |
|---|---|
| Status | Accepted |
| Date | 3 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `SPEC.md` FR-15, FR-16; ADR-0001; ADR-0002; `docs/competitive-analysis.md` §6 N3 |

## Context

Phase 1.5 adds an on-demand quality check for prompts: seven rules (L1-L7) that surface findings without ever modifying a note. Six rules operate on a single prompt (its `Prompt` record plus its body text); one rule, L6 (near-duplicate titles), is inherently library-wide, since a finding for one prompt depends on every other prompt's title. Two surfaces consume the same findings: a "Lint library" command that opens a full report modal (FR-16.1), and a per-card indicator in the existing library view that must open the same report scoped to one prompt (FR-16.2). FR-16.2 also requires this indicator to "reuse the existing warning badge pattern" — the badge already in `library-view.ts` that shows when `prompt.warnings` (frontmatter-normalization problems, NFR-8) is non-empty. L7 is explicitly defined as "surfaced as findings, reusing prompt.warnings," so the new lint system is a strict superset of what that badge already displays today.

Constraints: all seven rules are pure functions in `src/domain/`, vitest-covered (SPEC §4); the report modal and command wiring are UI glue, verified by manual smoke only, consistent with this repo's established testing-boundary convention (only `src/domain/*` gets automated coverage); the linter is read-only over the index (FR-16.3), no auto-fix, no new settings, no network; native `Modal` per ADR-0002; desktop and mobile.

The two open design questions this ADR resolves: (1) how L6's library-wide computation is shared between the report modal and every per-card badge without an O(n) library-wide pass repeating per card (the library view re-renders on every filter/search keystroke, per its existing single-render-path pattern), and (2) how the new lint-driven badge relates to the existing `prompt.warnings` badge, given FR-16.2's "reuse" instruction and L7's definition.

## Decision

Add one new pure domain module, `src/domain/lint.ts`:

- `LintFinding { ruleId: "L1".."L7"; severity: "warning" | "info"; message: string }` and `PromptLintResult { path: string; title: string; findings: LintFinding[] }`.
- `lintPrompt(prompt: Prompt, body: string): LintFinding[]` — the six single-prompt rules: L1 and L2 (placeholder-level, delegating to two new functions on `placeholders.ts`, see below), L3 (`body.trim() === ""`), L4 (`prompt.useCase.trim() === ""`, info), L5 (`prompt.category.trim() === ""`, info), and L7 (one finding per string in `prompt.warnings`, `severity: "warning"` — matching the severity the existing badge already implied for this data).
- `findDuplicateTitleFindings(prompts: Prompt[]): Map<string, LintFinding[]>` — L6, grouping the whole library by two independent keys: the trimmed, lower-cased title, and `slugify(title)` (reused as-is from `src/domain/slug.ts`, no new normalization logic). Any group of size ≥2 under either key contributes a warning finding to every prompt in that group. The slug key exists because two titles that render differently (accents, punctuation) can still normalize to the same on-disk slug (ADR-0001, FR-3.1), which is a real, distinct collision risk that raw title comparison cannot see.
- `lintLibrary(prompts: Prompt[], getBody: (path: string) => string): PromptLintResult[]` — a thin orchestrator: runs `lintPrompt` for every prompt, merges in `findDuplicateTitleFindings`'s entries by path, and returns **one result per prompt, unfiltered** (a well-formed prompt gets `findings: []`). Filtering "prompts with zero findings" out of the visible report (FR-16.1) and computing severity counts are left to the UI layer, which is not automated-test-covered per SPEC §4, keeping the domain layer a pure, total function over its input.

`lintLibrary` is called exactly once per triggering event (once when the "Lint library" command runs, once per `library-view.ts` `render()` call) and its result is indexed into a `Map<path, PromptLintResult>` by the caller; both the report modal and every per-card badge read from that one map, so a 1,000-prompt library (NFR-1) pays for one O(n) library-wide pass per render, not one per card.

Two additive-only exports on `src/domain/placeholders.ts` (zero change to `parsePlaceholders`/`resolvePlaceholders` signatures or behavior):

- `hasMalformedPlaceholders(body: string): boolean` — L1. True when either (a) a well-formed-brace match's content fails `parseSegments` (empty name, or >3 pipe segments — the same conditions `parsePlaceholders` already silently skips), or (b) the body has leftover, unconsumed text (after removing every well-formed matched span) containing a literal `{{` (catches unclosed openings and the dangling brace left behind by nested constructs).
- `findConflictingVariableNames(body: string): string[]` — L2. Groups every occurrence (not deduplicated to first, unlike `parsePlaceholders`) by variable name; returns the names, in first-appearance order, where two or more occurrences disagree on default value, hint, or option list.

These live in `placeholders.ts`, not `lint.ts`, because only that module's private `PLACEHOLDER_RE`/`parseSegments` define what "malformed" or "conflicting" means for this syntax; `lint.ts` only ever consumes the resulting boolean/`string[]`, the same shape of dependency `query.ts` already has on `prompt.ts` today.

FR-16.2's badge reuse is implemented as a **replacement**, not an addition: `library-view.ts`'s existing badge (currently `header.createSpan({ cls: "promptbox-item__warning" })`, shown when `prompt.warnings.length > 0`, static aria-label, no click handler) is repointed to the shared lint map: same CSS class and icon, shown when that prompt's `PromptLintResult.findings` contains at least one `severity: "warning"` entry, aria-label summarizing the findings, and a new click handler opening `LintModal` scoped to that prompt's path. Because L7 folds `prompt.warnings` into the same finding set, this is a strict superset of the old condition, so no information is lost, and the two previously-separate signals (frontmatter warnings vs. lint findings) collapse into one, matching FR-16.2's "reuse" instruction literally rather than stacking a second, overlapping indicator next to it.

One new `Modal` subclass, `src/ui/lint-modal.ts` (`LintModal`), following the existing `ConfirmModal`/`ImportModal` pattern: constructed with the full `PromptLintResult[]` (already computed by the caller) plus an optional `scopedToPath`; renders a severity-count summary line, one section per prompt with findings (title, per-finding rows, an "open as note" button per FR-16.4), and a "No issues found." fallback when the visible set (after the optional scope filter and the zero-findings filter) is empty — this covers both the empty-library and zero-findings acceptance criteria with the same code path.

A small shared helper, `src/ui/open-note.ts` (`openNote(app: App, path: string): Promise<void>`), extracted from `library-view.ts`'s existing private `openAsNote` method (same body: resolve the file, `Notice` if stale, otherwise open in the active leaf), reused by both `library-view.ts` and `lint-modal.ts` so the "open by path" behavior has one implementation instead of two copies.

`main.ts` registers one new command, `"Lint library"` (`id: "lint-library"`), that calls `lintLibrary` over the full index and opens `LintModal` unscoped.

## Alternatives considered

1. **Recompute the library-wide pass inside every card, or run only the six single-prompt rules per card and call `findDuplicateTitleFindings` separately per card for the L6 check.** Rejected: at the ~1,000-prompt NFR-1 target, either sub-option turns one O(n) library-wide grouping pass into an O(n²) cost on every re-render (the view already re-renders on every filter/search keystroke via its established single-render-path pattern), and running the grouping "separately per card" additionally risks the badge and the report modal disagreeing about which prompts are duplicates if the two computations ever drift. Sharing one `lintLibrary()` result per render through a `Map<path, result>` costs one extra allocation and removes both risks.
2. **Change `parsePlaceholders`'s return shape to carry malformed-construct diagnostics inline** (e.g. `{ variables: PromptVariable[]; malformed: string[] }`) instead of adding sibling functions. Rejected: `parsePlaceholders` has exactly one production call site (`src/ui/copy.ts:23`) and a large, currently-green test suite (`tests/placeholders.test.ts`, 12 cases) asserting its current array-returning shape; reshaping it for the linter's benefit would force an unrelated caller and every existing assertion to change for a feature that constraints classify as UI-adjacent tooling, not the copy path's concern. Two additive, independently-named functions cost nothing to the existing surface.
3. **Compare only trimmed, lower-cased titles for L6, skipping the slug key.** Rejected: the SPEC's own operationalization of "near-duplicate" explicitly lists two criteria ("case-insensitive equality after trimming; exact-duplicate slugs"), and titles that look different to a human (accents, punctuation, whitespace variants) can still `slugify()` to the same value, which is a genuine collision risk given slugs become file names (ADR-0001, FR-3.1). `slugify` already exists, is already tested (`slug.test.ts`), and reusing it costs one extra `Map` pass, so there is no material reason to narrow the rule to titles only.
4. **Add a second, separate lint-only badge next to the existing frontmatter-warning badge, leaving the old one untouched.** Rejected: L7 is explicitly "reusing prompt.warnings," so the two badges would show overlapping, sometimes redundant information for the same prompt (a frontmatter problem would light up both), doubling the DOM and update code for what is conceptually one signal, and directly contradicts FR-16.2's instruction to reuse (not duplicate) the existing pattern.

## Consequences

Positive:
- The report modal and every per-card badge share one library-wide computation per render/command invocation, keeping the feature at O(n) instead of O(n²) at the ~1,000-prompt NFR-1 target, without introducing caching or invalidation machinery.
- Zero risk to the already-tested, single-production-call-site `parsePlaceholders`/`resolvePlaceholders`: the two new placeholder functions are purely additive, so the existing 12-case test file and `copy.ts` need no changes.
- The frontmatter-warning badge and the new lint badge collapse into one signal with one click target and one modal, which is simpler for users than two overlapping indicators, and literally satisfies FR-16.2's "reuse" instruction rather than approximating it.
- All seven rules are pure, colocated by concern (`placeholders.ts` owns what counts as malformed/conflicting; `lint.ts` owns assembling findings and the one library-wide rule), and fully vitest-covered, keeping the UI layer thin glue — consistent with this repo's established testing-boundary convention across every prior tier.
- Reusing `slugify` for half of L6 means the "near-duplicate" rule can never drift from the actual file-naming rule (ADR-0001) it is meant to protect against.

Negative and accepted:
- The existing badge's aria-label text and click-less behavior change: a grep across the repo (`promptbox-item__warning`, `Frontmatter issues`, `.warnings`, `alert-triangle`) found this pattern referenced only inside `library-view.ts` itself; the only tests touching `prompt.warnings` (`tests/prompt.test.ts`) assert on the raw domain array, not on any UI rendering of it, so this is a genuine observable-contract change with zero automated coverage today. It must be verified by manual smoke (per this repo's UI-glue convention) rather than caught by CI; documented here explicitly so it is not mistaken for an accidental regression later.
- `lintLibrary` now runs on every `library-view.ts` `render()` call, i.e., on every filter/search keystroke (the view's existing single-render-path pattern), adding an O(n) grouping cost to a path that previously did none of this work. Acceptable at the ~1,000-prompt NFR-1 target; if a future measurement shows otherwise, the next lever is memoizing the lint pass and invalidating it on `PromptIndex.onChange`, deferred until measured — the same "defer until measured" posture ADR-0001 already takes on list virtualization.
- Two new small files (`open-note.ts`, `lint-modal.ts`) and two new exports on an already-central `placeholders.ts` grow the domain/UI surface slightly; judged preferable to the alternative of duplicating "open a note by path" logic in two modals or scattering "what is a malformed placeholder" knowledge across two files.

Neutral:
- No new settings, no persisted state beyond the existing disposable index, no network calls — consistent with ADR-0001, ADR-0002, and SPEC §4's explicit constraints.
- `LintFinding.ruleId` is a closed `"L1".."L7"` union with no extensibility hook for Phase 2's community-submission pre-flight (SPEC §1 mentions this as a future use); deliberately not designed further here, since that reuse is out of scope for this SPEC (§5) and belongs to whichever ADR eventually wires ADR-0003's Proposed community catalog to these rules.

## References

- `SPEC.md` (this feature: FR-15, FR-16, acceptance criteria, §4 constraints)
- ADR-0001 (storage: markdown + frontmatter; slug-based file naming)
- ADR-0002 (native Obsidian UI components)
- `docs/competitive-analysis.md` §6 N3
- `PROJECT.md` Phase 1.5
