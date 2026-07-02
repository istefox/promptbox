# SPEC — Tag and category suggestions (Phase 1.5, from competitive-analysis §4 P2a)

**Topic slug:** tag-category-suggestions

| | |
|---|---|
| Source | `docs/competitive-analysis.md` §4 P2a (approved 2026-07-03), `PROJECT.md` Phase 1.5 |
| Depends on | Tier 3 modals (met); ADR-0001, ADR-0002 binding |
| Effort | M |

## 1. Purpose

Suggest — never auto-write — tags and a category in the create/edit prompt modal, scored locally from the draft's text against the existing taxonomy and vault tags. Keeps the taxonomy consistent as the library grows (US-5) with zero network and zero silent writes.

## 2. Requirements

### FR-11 Suggestions (MUST)

- FR-11.1 Pure domain scorer (`src/domain/`): input = draft text (title, use_case, body) plus candidate values (category values from settings, tag values from the index and vault); output = ranked suggestions with deterministic, case-insensitive keyword-frequency scoring. Top 5 tags and top 3 categories, minimum score threshold so unrelated values never surface.
- FR-11.2 Prompt modal (create and edit): a suggestion chip row under the tags field and under the category dropdown. Clicking a chip applies that value to the field, an explicit user action. Suggestions recompute on title/use_case/body input, debounced (reuse the existing debounce helper pattern).
- FR-11.3 Suggestions are never auto-applied and never touch a note; frontmatter changes still happen only through the modal's save (spec §3.2 rule: no writes except explicit user actions).
- FR-11.4 Values already selected in the field are excluded from its suggestions. Zero suggestions → the chip row is hidden entirely. Malformed or empty candidate data never crashes the modal (NFR-8).

## 3. Acceptance criteria

- Draft body mentioning "review the pull request diff" with an existing tag `code-review`: the tags chip row shows `code-review`; clicking it adds the tag chip to the field; nothing is written until save.
- Category `writing` exists in settings; a draft about email drafting surfaces `writing` under the category dropdown; clicking selects it.
- A tag already added to the draft does not reappear as a suggestion.
- Empty body and title → no suggestion rows rendered.

## 4. Constraints

- Scorer is a pure function with no Obsidian imports, vitest-covered (repo testing-boundary convention). UI chips follow the existing chips patterns in `prompt-modal.ts`/`filter-bar.ts`, native primitives only, Obsidian CSS variables, touch-friendly. No network. `.claude/test-cmd` is authoritative and must not change.

## 5. Out of scope

AI/semantic tagging (conflicts with NFR-5, see §5 of the analysis), auto-tagging on import, suggestions outside the modal, new settings.
