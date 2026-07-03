# ADR-0006: Local keyword-frequency scorer for tag and category suggestions

| | |
|---|---|
| Status | Accepted |
| Date | 3 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `SPEC.md` FR-11 (this feature), `docs/spec.md` FR-3.2/FR-3.4, `docs/competitive-analysis.md` §4 P2a (M4), ADR-0001, ADR-0002, `PROJECT.md` Phase 1.5 |

## Context

Promptbox's competitive analysis (§4 P2a) flags automatic tagging/categorization as a headline feature of one competitor (Prompt Library), with an unverified, possibly AI-based mechanism. The MVP's binding constraints (ADR-0001: notes are the single source of truth, frontmatter written only through the official API on explicit user action; ADR-0002: native Obsidian primitives, vanilla TypeScript, no framework; NFR-5: no network calls) rule out anything semantic or AI-based. `SPEC.md` FR-11 already settles the product shape as a local heuristic: a chip row of suggestions under the tags field and under the category dropdown in the existing create/edit modal (`src/ui/prompt-modal.ts`), never auto-applied, recomputed as the user types, capped at top 5 tags and top 3 categories with a minimum score threshold. That UI placement and the "keyword-frequency" algorithm family are given; this ADR covers what FR-11 leaves open: the exact scoring contract, where candidate values and draft text come from, and how the modal re-renders suggestions without breaking the user's typing flow.

Two things already in the codebase shape the design space:

1. `PromptModalDeps` (`src/ui/prompt-modal.ts`) already carries `tagPool` (library tags first, then vault-wide, built by `main.ts#buildTagPool`) and, via `deps.settings.categoryValues`, the exact two candidate pools FR-11.1 asks for ("category values from settings, tag values from the index and vault"). No new plumbing is needed to source candidates.
2. `draftFrom()` (`src/ui/prompt-modal.ts`) sets `body: ""` unconditionally in edit mode, because `docs/spec.md` FR-3.2 draws an explicit line: "Edit metadata modal for existing prompts: same fields except body." The edit modal has zero body awareness by design (FR-3.3 keeps body editing in the native editor). FR-11.1's "draft text (title, use_case, body)" input therefore cannot mean the same thing in both modes without either accepting a reduced input in edit mode or piercing an existing, deliberate FR-3.2 boundary.

The `@` placeholder namespace reserved for context variables (a sibling, not-yet-merged branch) is unrelated to this feature; no collision risk since suggestions never touch placeholder syntax.

## Decision

Add one new pure domain module, `src/domain/suggestions.ts`, with a single exported function:

```
suggestValues(
  draftText: { title: string; useCase: string; body: string },
  candidates: string[],
  selected: string[],
  limit: number,
): string[]
```

Scoring is deterministic and case-insensitive: both the concatenated draft text and each candidate value are tokenized with the same normalize-NFD, strip-diacritics, lowercase, split-on-`[^a-z0-9]+` approach `src/domain/slug.ts#slugify` already uses (so `"code-review"` tokenizes to `["code", "review"]` the same way a title would). A candidate's score is the sum, over its own distinct tokens, of that token's frequency in the draft-text token multiset. Candidates already present in `selected`, and candidates that tokenize to nothing, are dropped before scoring. Only candidates with score > 0 survive (the "minimum score threshold" FR-11.1 requires, so unrelated values never surface). Surviving candidates are sorted by score descending, then by value ascending (`localeCompare`) for a fully deterministic order under ties. The caller truncates to `limit`: 5 for tags, 3 for categories, exactly as FR-11.1 specifies.

`suggestValues` is called twice from `PromptModal`, with zero new fields on `PromptModalDeps` and zero changes to `main.ts`:

- Tags: `suggestValues({ title: draft.title, useCase: draft.useCase, body: draft.body }, deps.tagPool, draft.tags, 5)`.
- Categories: `suggestValues({ ... same draftText ... }, deps.settings.categoryValues, draft.category ? [draft.category] : [], 3)`.

`draftText` is identical in both modes; the difference is that `draft.body` is always `""` in edit mode (existing `draftFrom()` behavior, untouched). Edit-mode suggestions therefore score against title and use_case only. This is a deliberate, documented consequence of respecting FR-3.2's boundary, not an oversight (see Alternatives, Consequences).

Two new chip-row containers are added to `PromptModal.display()`: one under the tags chips box, one under the category dropdown. Both reuse the existing `.promptbox-chip` visual style unselected (the same neutral pill already used for inactive filter chips in `filter-bar.ts`), inside one new lightweight layout class in `styles.css` mirroring `.promptbox-filters__group` / `.promptbox-filters__label`. Both rows collapse to nothing when the result list is empty, the same empty-collapse idiom `renderChips()` already uses.

Re-render discipline is the crux of the internal design and is fixed as follows:

- Title, use-case, and body-textarea `onChange` handlers share one 150ms debounce timer (the same `window.setTimeout`/`clearTimeout` idiom `filter-bar.ts`'s search input already uses; no new shared debounce utility is introduced). On fire, the timer calls a scoped `renderSuggestions()`-style function that touches only the two suggestion containers, never `this.display()`. `display()` tears down and rebuilds the whole `contentEl`, which would steal focus and cursor position out of whichever text field the user is mid-keystroke in; the two suggestion containers must be updatable independently of that, exactly the same reasoning that already makes tag-chip add/remove use the scoped `renderChips()` instead of a full redraw.
- Tag add/remove (the existing `commit()` and chip "×" handlers) additionally call the scoped tag-suggestion refresh immediately, no debounce, since these are discrete actions, not per-keystroke.
- The category `<select>`'s existing plain-selection branch additionally calls the scoped category-suggestion refresh immediately, same reasoning.
- Clicking a suggestion chip mutates the draft exactly the way the existing manual controls do: a tag suggestion pushes into `draft.tags` (guarded against duplicates) and reuses `renderChips()` plus the scoped suggestion refresh; a category suggestion sets `draft.category` and calls the existing full `this.display()` (already used today for the "New value..." dropdown flow), which is safe here because the triggering event is a discrete click, not typing, so there is no cursor position to lose, and it updates the dropdown's visible value for free through the normal `dropdownValues()`/`setValue()` render path with no new `DropdownComponent` reference needing to be retained.

The only place frontmatter is ever written stays `submit()` → `createPrompt`/`updatePrompt`, unchanged. Suggestions are pure in-memory draft mutations until the user explicitly saves (FR-11.3).

## Alternatives considered

1. **Normalized/ratio scoring** (Jaccard-style overlap between the draft token set and a candidate's token set, or matched-tokens divided by the candidate's own token count) instead of raw summed frequency.
   Rejected: FR-11.1 names "keyword-frequency scoring" specifically, and raw frequency is the more literal reading of that requirement. For the overwhelmingly common case, single-word tags and categories, a ratio and a raw count rank identically, so normalization buys little at Promptbox's scale while introducing a denominator choice (candidate-token-count vs union-size vs draft length) that has no obviously correct answer and that the spec does not ask for. Raw frequency is also easier to explain to a user asking "why did this suggestion appear," which matters for a feature whose whole value proposition is transparency over an opaque AI/semantic alternative.

2. **Corpus-wide TF-IDF weighting**, scoring a candidate's tokens by rarity across every prompt body in the index rather than just the one draft being edited.
   Rejected: this needs the whole index's bodies as scorer input, not just the draft text and candidate list FR-11.1 defines, which blurs the "pure function over draft text and candidate values" boundary the spec draws and invites scope creep toward the AI/semantic auto-tagging path that NFR-5 and `docs/competitive-analysis.md` §5 explicitly rule out. `docs/competitive-analysis.md` §4 P2a itself grades this feature's value as "moderate... rises with library growth," so front-loading corpus-scale machinery now, for an effort-M feature, is speculative future-proofing beyond what is asked.

3. **Thread the note's live body into the edit-mode modal** via `PromptIndex.getBody(path)` (already cached synchronously and reachable from `main.ts#openEditModal`), so edit-mode suggestions score against title + use_case + body exactly like create mode.
   Rejected: `docs/spec.md` FR-3.2 already draws an explicit line, "Edit metadata modal for existing prompts: same fields except body," and `draftFrom()` enforces it today. Piercing that boundary, even read-only and only for scoring, adds a new data dependency between `main.ts`, the index, and the modal for a feature already rated moderate-value at MVP scale, and FR-11 does not ask for it explicitly. Kept as a documented, revisitable gap (see Consequences) rather than a silent limitation or an unrequested scope expansion.

4. **Two field-specific scorer functions** (`suggestTags`, `suggestCategories`) instead of one generic `suggestValues`.
   Rejected: the scoring algorithm, thresholding, and ordering are identical for both fields; the only differences (candidate pool, exclusion set, output cap) are ordinary parameters. Two near-duplicate functions would need near-duplicate test suites and would drift the moment one got a bugfix the other did not. A single generic primitive is also the more reusable shape for later similarity-style work already on the Phase 1.5 backlog (`docs/competitive-analysis.md` N6, "related prompts"), which needs comparable token-overlap scoring.

## Consequences

**Positive:**

- FR-11 is fully implementable with zero new `PromptModalDeps` fields and zero changes to `main.ts`; confirmed by grep that `new PromptModal(` has exactly two call sites (`src/main.ts`, create and edit), both already passing `tagPool` and `settings`.
- Scorer cost is bounded by taxonomy size (unique tags plus unique categories), not by prompt count, since candidates are the tag pool and category list, not the library's prompts. This stays cheap well past the NFR-1 1,000-to-5,000-prompt targets; there is no debounce-starvation or jank risk to design around.
- One generic, thoroughly vitest-covered pure function serves both suggestion rows, keeping the domain surface small and consistent with ADR-0002's "small helper layer, no framework" philosophy, and sets up a reusable primitive for future similarity-style features (competitive-analysis N6).
- FR-11.3's "never auto-write" guarantee is structurally trivial to break by accident and easy to verify by inspection: the scorer returns plain strings, the modal only mutates its own in-memory `draft`, and the existing `submit()` → `createPrompt`/`updatePrompt` path is untouched.
- Suggestion chips inherit the existing `.is-mobile .promptbox-chip { min-height: 44px; }` rule for free, so touch-friendly sizing costs zero new mobile-specific work.
- Deterministic tie-breaking makes the vitest suite exhaustive and the feature's ranking explainable to users and future maintainers, unlike a ratio- or corpus-weighted scheme.
- No observable-contract change: `PromptDraft`, `PromptModalDeps`, and the `createPrompt`/`updatePrompt`/`draftToFrontmatter` signatures are all unchanged, so no existing test or call-site needs updating (verified by grep across `src/`).

**Negative and accepted:**

- Edit-mode suggestions never see the note's current body text, only title and use_case; a real capability gap versus create mode. Accepted because FR-3.2 already draws the "same fields except body" line and threading body content into the edit modal is new coupling for a feature `docs/competitive-analysis.md` itself rates as moderate value at MVP scale. Revisit only if user feedback specifically asks for body-aware suggestions in edit mode.
- Keyword-frequency-by-substring scoring has the false-positive/false-negative modes inherent to the algorithm family FR-11.1 mandates: a tag can surface from one incidental word match in unrelated boilerplate, and a genuinely relevant multi-word tag can fail to surface if none of its own sub-tokens literally appear in the draft. Accepted as the spec-mandated trade-off; semantic matching is explicitly out of scope (NFR-5, competitive-analysis §5).
- The scoped-re-render discipline (touch only the two suggestion containers on every keystroke, never call `this.display()`) adds implementation discipline to `PromptModal` beyond its current, somewhat mixed pattern (it already both scopes and fully redraws depending on the event). This needs to be explicit in the implementation plan so a keystroke-triggered full redraw regression does not slip in and silently steal input focus.
- Two more render functions and a couple of debounce-related fields land on an already sizeable modal class (`prompt-modal.ts` is roughly 290 lines before this change); a manageable, incremental cost, not a new architectural layer.

**Neutral:**

- No new settings, no new frontmatter fields, no schema or `schema_version` bump; FR-11 is purely additive at the UI and domain layers.
- No network, no new dependency; ADR-0001 and ADR-0002 are reaffirmed, not revisited.
- Establishes the repo's first "one pure scorer feeding two UI call sites for two different fields" pattern, worth keeping in mind for later Phase 1.5 items with similar shape (competitive-analysis N6).

## References

- `SPEC.md` (this feature), FR-11.1 through FR-11.4, acceptance criteria §3.
- `docs/spec.md` (MVP spec), FR-3.2, FR-3.4, NFR-5, NFR-8.
- `docs/competitive-analysis.md`, §4 P2a (M4, automatic tagging), §5, N6.
- `docs/adr/0001-storage-markdown-frontmatter.md`.
- `docs/adr/0002-ui-native-obsidian-components.md`.
- `PROJECT.md`, Phase 1.5 entry "tag and category suggestions."
- Source read: `src/ui/prompt-modal.ts`, `src/ui/suggest.ts`, `src/ui/filter-bar.ts`, `src/domain/draft.ts`, `src/domain/query.ts`, `src/domain/slug.ts`, `src/domain/prompt.ts`, `src/storage/prompt-writer.ts`, `src/storage/indexer.ts`, `src/settings.ts`, `src/main.ts`, `styles.css`.
