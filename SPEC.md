# SPEC — Related prompts (Phase 1.5, from competitive-analysis §6 N6)

**Topic slug:** related-prompts

| | |
|---|---|
| Source | `docs/competitive-analysis.md` §6 N6 (approved 2026-07-03), `PROJECT.md` Phase 1.5 |
| Depends on | Tiers 1-3 (met); ADR-0001, ADR-0002 binding |
| Effort | S/M |

## 1. Purpose

Surface each prompt's nearest neighbors by shared tags, category, and title/use_case token overlap, to help curation (US-5) as the library grows toward 1,000 prompts. Pure index computation, no new data.

## 2. Requirements

### FR-18 Similarity (MUST)

- FR-18.1 Pure domain scorer: similarity between two prompts = weighted sum of shared tags (weight 3 each), same category (2), title/use_case token overlap (1 per shared token, case-insensitive, diacritics-insensitive). Deterministic; zero score = unrelated.
- FR-18.2 `relatedPrompts(target, all, limit)` returns the top N (default 5) non-zero-score neighbors, ties broken by newest `updated` then path ascending. Excludes the target itself. Vitest-covered.

### FR-19 Surface (MUST)

- FR-19.1 In the edit-metadata modal, a read-only "Related" section lists up to 5 related prompts (title, type, score-free display) with an "open as note" action each. Absent when there are no related prompts. Create mode shows nothing (no path yet).
- FR-19.2 Computation runs once when the modal opens; no keystroke recomputation.
- FR-19.3 Read-only: no note writes, no new settings, no new frontmatter.

## 3. Acceptance criteria

- Two prompts sharing 2 tags and a category outrank a prompt sharing 1 title token.
- A prompt with unique tags, category, and title shows no Related section.
- Related entries open as notes without closing corruption (modal closes, note opens).
- Create-mode modal never shows the section.

## 4. Constraints

- Scorer in `src/domain/` with no Obsidian imports, vitest-covered; modal section is UI glue (manual smoke). Native primitives, existing modal patterns, mobile touch targets. Performance: O(n) per modal open at 1,000 prompts is acceptable (NFR-1 scale). No network. `.claude/test-cmd` is authoritative and must not change.

## 5. Out of scope

Body-content similarity (bodies not loaded in the modal), backlink-graph integration, a library-view "related" panel, embeddings or any semantic scoring.
