# SPEC — Vault-content transclusion (Phase 1.5, from competitive-analysis §4 P2b)

**Topic slug:** vault-transclusion

| | |
|---|---|
| Source | `docs/competitive-analysis.md` §4 P2b (approved 2026-07-03), `PROJECT.md` Phase 1.5 |
| Depends on | Tier 4 copy flow (met); ADR-0001, ADR-0002 binding |
| Effort | L |

## 1. Purpose

Let a prompt body embed the content of other vault notes via `[[wikilink]]` references, resolved at copy time with an explicit preview step. Prompts become composable from vault knowledge while notes remain the single source of truth.

## 2. Requirements

### FR-12 Transclusion at copy time (MUST)

- FR-12.1 During "copy with variables", `[[target]]` and `[[target|alias]]` references in the body resolve to the linked note's content. Resolution uses Obsidian's link-resolution API (metadata cache), never manual path guessing. Aliased links resolve to the target's content (the alias is display-only).
- FR-12.2 Depth cap 1: linked notes are inserted as plain text; wikilinks inside the inserted content are NOT recursively resolved (left verbatim). No cycle can therefore recurse, but a self-reference `[[own note]]` still resolves once to its own body.
- FR-12.3 The inserted content is the linked note's body with frontmatter stripped, matching the existing copy semantics (FR-4.3).
- FR-12.4 Unresolvable links (no matching note) are left verbatim in the output and reported in a single Notice naming them. Never a crash (NFR-8).
- FR-12.5 Preview step: when the body contains at least one resolvable wikilink, the copy flow shows a confirmation step listing each link, its target, and the inserted size (characters); the user confirms or cancels. Bodies with zero wikilinks copy exactly as today, no new step. A total-size warning appears above 50,000 characters.
- FR-12.6 Order of operations: links resolve first, then placeholder substitution runs on the ORIGINAL body's placeholders only — placeholders inside transcluded content are not collected and not substituted (consistent with the no-reparse rule of ADR-0005 where applicable on this branch: resolved/inserted text is never re-parsed).
- FR-12.7 Copy raw (FR-4.5) bypasses resolution entirely: wikilinks reach the clipboard verbatim.

## 3. Acceptance criteria

- Body `Context:\n[[style-guide]]\n\nTask: {{task}}` with an existing `style-guide.md`: copy shows the preview (1 link, target path, size), then the variable modal for `task`; clipboard contains the style guide's body inlined.
- `[[missing-note]]` stays verbatim in the clipboard and one Notice names it.
- A transcluded note containing `[[other]]` keeps that inner link verbatim (depth 1).
- Copy raw yields the body byte-identical, links untouched.
- A prompt with no wikilinks copies with zero new UI.

## 4. Constraints

- Link detection is a pure domain function (`src/domain/`), vitest-covered; vault resolution and preview UI live in the UI layer (repo testing-boundary convention). Native primitives only (ADR-0002): the preview is a `Modal`. Desktop and mobile. No network. `.claude/test-cmd` is authoritative and must not change.
- Embed syntax `![[target]]` is treated identically to `[[target]]` in this feature.

## 5. Out of scope

Recursive resolution (depth > 1), block/heading references (`[[note#heading]]`, `[[note^block]]` resolve as unresolvable → verbatim), placeholder collection inside transcluded content, Templater interop (NG-7).
