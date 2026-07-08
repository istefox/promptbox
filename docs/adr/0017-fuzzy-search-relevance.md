# ADR-0017: Fuzzy library search with relevance ranking

| | |
|---|---|
| Status | Accepted |
| Date | 8 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `docs/spec.md` (FR-2.4, FR-2.5), ADR-0002, ADR-0012, `src/domain/search.ts`, issue #30 |

## Context

Issue #30 reports that the library search misses obvious matches. Typing `prompt test` returns nothing even though a prompt titled "test prompt" exists. The cause is the matcher in `runQuery` (`src/domain/query.ts`): it lower-cased the whole query and ran a single `haystack.includes(needle)` against `title \n use_case \n body`. That is one contiguous substring test, so word order matters, a missing letter breaks the match, and accented text only matches when the query carries the same accents. FR-2.4 asked for "full-text search"; the substring implementation was the thinnest reading of it.

The fix has to preserve three things the codebase already commits to. Matching and scoring stay in a pure `src/domain/` module with no `obsidian` import, so vitest covers them the way it covers `related.ts` and `suggestions.ts` (ADR-0002, and the vitest mock in `tests/mocks/obsidian.ts` stubs almost nothing). The result stays fast at the ~1,000-prompt NFR-1 target, since search runs on every debounced keystroke over full note bodies. And `runQuery` keeps returning `Prompt[]` so its other callers (the Export buttons) are untouched.

This ADR settles the matching algorithm, where the relevance score lives, how results reorder while a query is active, and how title matches are highlighted without an index-mapping bug on accented characters.

## Decision

Add one pure module, `src/domain/search.ts`, and wire it into `runQuery`. The UI gains a relevance sort that turns on by itself while a query is active, and highlights the matched characters in each card title.

### Subsequence match, token AND, field weights

`scoreLibraryMatch(queryText, { title, useCase, body })` returns `{ score, titleRanges } | null`:

- The query is split on whitespace into tokens. Each token must subsequence-match at least one field (its characters appear in order, not necessarily adjacent). If any token matches no field, the prompt is excluded (`null`). This is an AND across tokens, which is what makes order irrelevant: `prompt test` and `test prompt` both match "test prompt", and a second word narrows instead of replacing the first. It is the direct answer to issue #30.
- Per token the best field wins, weighted `title (3) > use_case (2) > body (1)`, and the token scores sum into the prompt's `score`. A title hit outranks a body-only hit. The per-token subsequence score rewards contiguous runs, matches at a word boundary or string start, an early first character, and a fully contiguous run, so an exact prefix beats a scattered match.
- No edit-distance or typo tolerance. Subsequence mirrors Obsidian's own search feel, stays cheap, and keeps noise down. This is a deliberate scope line, not an oversight.

### Diacritics folded, and title indices preserved for highlighting

Both sides fold diacritics (NFD, strip combining marks, lower-case), the same normalize pipeline already duplicated in `related.ts` and `suggestions.ts`. So `puo` matches "può" and `café` matches "cafe".

Highlighting needs the matched positions to point back into the original title, and NFD decomposition changes string length (a precomposed "é" becomes two code units), which would shift every index after it. So the title uses a length-preserving fold: each source UTF-16 unit maps to exactly one folded unit, keeping a 1:1 index map. Body and use_case fold with the cheaper whole-string pipeline, since their positions never surface. `titleMatchRanges(queryText, title)` is a thin exported helper the view calls per card; it returns ascending, non-overlapping `[start, end)` ranges over the original title and highlights only tokens that actually occur there.

### Relevance lives in `runQuery`, signature unchanged

`runQuery` builds a `Map<path, score>` in the same filter pass, then threads it into the comparator the way `usageRecency` is already threaded. `SortKey` gains `"relevance-desc"`, whose comparator orders by score descending and tie-breaks on title, falling back to `updated-desc` when scores are equal. `favoritesFirst` still layers on top unchanged. `runQuery` still returns `Prompt[]`; the score never leaves the function.

### Auto-switch on an active query, highlight in the card

`filter-bar.ts` adds "Relevance (best match)" to the sort dropdown. When the search box goes from empty to non-empty, the previous sort is remembered and the list switches to relevance; clearing the box restores it. Picking a sort by hand while searching wins and sticks after the box is cleared. The dropdown reflects the active sort through the existing `sync()`, so the switch is visible rather than hidden. `library-view.ts` renders the title through `titleMatchRanges`, wrapping matched spans in `.promptbox-library__match` (accent color, bold, Obsidian CSS variables, no `!important`).

## Alternatives considered

1. **Token-AND substring, no ranking.** The one-line fix for issue #30: split the query, require every token as a plain substring. It solves word order but not subsequence recall (`tmpl` would still miss "template"), and it leaves results in `updated-desc` order, so the best match is not first. Rejected as under-delivering on an explicit "professional and complete" request, though the shipped scorer is a strict superset of it.
2. **Obsidian's `prepareFuzzySearch` in the UI layer, scores passed to a domain ranker.** The engine is proven and matches Obsidian's own UX, and `quick-picker.ts` already hands `FuzzySuggestModal` scores to `rankFavoritesFirst`. Rejected for the library view because it moves the matcher into the UI, where the vitest mock stubs nothing, so the core behavior (word order, AND, weighting, ranges) would lose its unit coverage. A self-contained pure scorer keeps the domain testable, which the whole project is built on.
3. **Edit-distance typo tolerance.** Rejected. It is heavier per keystroke over full bodies at the NFR-1 target and it surfaces noisier matches; subsequence is the deliberate ceiling (confirmed with the user).
4. **A new richer return type from `runQuery` carrying hits and ranges.** Rejected. It would touch every caller, including the Export buttons that only want the filtered set. Keeping `Prompt[]` and exposing `titleMatchRanges` as a separate per-card helper is additive and leaves those callers alone.

## Consequences

**Positive:** Issue #30 is fixed, and multi-word queries narrow in any order. Recall improves through subsequence matching and diacritic folding, with title-weighted relevance putting the best match first while a query is active. All matching and scoring stay in one pure, vitest-covered module. `runQuery` keeps its signature, so no other caller changes. Performance is unaffected: the worst fuzzy-plus-relevance keystroke over the 1,000-prompt fixture measures ~3.7 ms, next to ~4 ms for the old substring path.

**Negative and accepted:** The scorer's weights and bonuses are hand-tuned constants, reasonable but not empirically optimized; they can be revisited without touching the callers. The auto-switch adds a small piece of UI state (the remembered pre-search sort) that lives in the filter-bar closure. Subsequence matching can, on very short queries, admit loose matches that relevance ranking then pushes down rather than excludes; accepted, since AND across tokens plus field weighting keeps the top of the list clean.

**Neutral:** `emptyQuery`'s default sort stays `updated-desc`; relevance is applied by the UI only while a query is active, not persisted. The normalize pipeline is now duplicated in a third domain module; consolidating `related.ts`, `suggestions.ts`, and `search.ts` onto one shared helper is a low-risk follow-up guarded by their existing tests, out of scope here. Export and import are untouched; no new `Prompt` field, no `data.json` change.

## References

- `docs/spec.md` — FR-2.4 (search) amended to fuzzy subsequence + token AND, diacritic-insensitive; FR-2.5 gains the relevance sort and match highlighting.
- ADR-0002 (`docs/adr/0002-ui-native-obsidian-components.md`) — pure domain modules get vitest, UI glue gets manual smoke; the basis for a self-contained scorer over `prepareFuzzySearch`.
- ADR-0012 (`docs/adr/0012-related-prompts.md`) — the weighted-scoring precedent and the NFD normalize pipeline reused here.
- Internal precedent: `src/domain/related.ts` and `src/domain/suggestions.ts` (normalize pipeline, pure scorers), `src/domain/query.ts` (`usageRecency` threading, `rankFavoritesFirst`), `src/ui/quick-picker.ts` (Obsidian fuzzy scores handed to a domain ranker), `tests/perf.test.ts` (the NFR-1 keystroke budget).
- Issue #30 — the reported miss (`prompt test` not matching "test prompt").
