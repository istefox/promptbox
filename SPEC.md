# SPEC — Library statistics view (Phase 1.5, from competitive-analysis §6 N8)

**Topic slug:** library-statistics

| | |
|---|---|
| Source | `docs/competitive-analysis.md` §6 N8 (approved 2026-07-03), `PROJECT.md` Phase 1.5 |
| Depends on | Tiers 1-2 (met); ADR-0001, ADR-0002 binding |
| Effort | S |

## 1. Purpose

A read-only statistics panel over the index: counts by taxonomy, quality distribution, stale prompts, and taxonomy orphans (values used in notes but absent from settings). Curation aid; orphan detection closes the silent gap left by FR-8.2 (removing a taxonomy value never edits notes).

## 2. Requirements

### FR-22 Statistics (MUST)

- FR-22.1 Pure domain aggregator over `Prompt[]` + settings taxonomy: totals; counts per type, category, and tag (top 10 tags by count); quality distribution (1-5 plus unset); stale list (10 oldest by `updated`); orphan values (types and categories present in notes but not in settings). Vitest-covered.
- FR-22.2 Command "Library statistics" opens a report modal with those sections; empty sections show a "none" line; empty library shows a friendly empty state, never a crash (NFR-8).
- FR-22.3 Orphan rows and stale rows are informational; orphan rows carry a hint that the value can be re-added in settings (no action buttons that write anything). Stale rows have an "open as note" action.
- FR-22.4 Read-only: no note writes, no settings writes, no new frontmatter, no new settings.

## 3. Acceptance criteria

- Library with 3 types in use, 2 configured: the missing one is listed under orphans with its usage count.
- Quality distribution row shows counts for each value 1-5 plus "unset".
- Stale section lists the 10 oldest by `updated` with dates; "open as note" works.
- Empty library: modal shows the empty state, no errors.

## 4. Constraints

- Aggregator in `src/domain/` with no Obsidian imports, vitest-covered; modal is UI glue (manual smoke), native `Modal`, existing patterns, Obsidian CSS variables, mobile-friendly. Computation on modal open only. No network. `.claude/test-cmd` is authoritative and must not change.

## 5. Out of scope

Charts/graph rendering (text and counts only), usage/copy tracking (parked N4), library-view embedding, exports of the stats.
