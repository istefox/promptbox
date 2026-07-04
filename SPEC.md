# SPEC — Placeholder insertion palette (Phase 1.5+)

**Topic slug:** placeholder-insertion-palette

| | |
|---|---|
| Source | User request (2026-07-04) |
| Depends on | Tier 3 create/edit, Tier 4 reuse engine (met); ADR-0001, ADR-0002 binding; `src/domain/placeholders.ts` |
| Effort | L |

## 1. Purpose

Prompt placeholders use a syntax that is not discoverable while authoring: `{{name}}`, `{{name|default}}`, `{{name|default|hint}}`, choice `{{name|a,b,c|hint}}`, and the reserved context variables `{{@selection}}` `{{@title}}` `{{@date}}` `{{@clipboard}}`. Today a user must remember all of it, and the linter (FR-21) only flags malformed placeholders after the fact. This feature adds an insertion helper that offers the valid constructs, reuses placeholder names already present in the library, and inserts the chosen construct at the cursor. It never invents new syntax and adds no data.

## 2. Requirements

### FR-24 Placeholder insertion palette

- FR-24.1 **Shared catalog.** A pure module builds one ordered, deduplicated list of catalog entries from the current index. Each entry knows its display label, its kind (context / library / template), the text to insert, and where the caret lands after insertion (a selected span within the inserted text, or a trailing cursor). Content:
  - **Context variables:** the four reserved names, inserted as `{{@selection}}` / `{{@title}}` / `{{@date}}` / `{{@clipboard}}`, caret after `}}`.
  - **Library names:** every placeholder name already used across prompt bodies, harvested with the existing `parsePlaceholders` over the index; each inserted as `{{name}}`, caret after `}}`. Context-variable names are excluded from this section (they are their own section). Deduplicated by name.
  - **Syntax templates:** two skeletons, `{{name|default|hint}}` and `{{name|a,b,c|hint}}`, inserted ready to fill with the `name` segment selected.
- FR-24.2 **Order.** Context variables first, then library names sorted by usage frequency descending (tie-break name ascending), then the syntax templates.
- FR-24.3 **Command + picker.** An Obsidian command `Insert placeholder`, available only when the active note is inside the prompts folder (`checkCallback`, mirroring `Edit prompt metadata`), opens a `SuggestModal` (substring-filterable, shared filter) over the catalog. Selecting an entry inserts its construct at the editor cursor via the editor API.
- FR-24.4 **Inline autocomplete (native editor).** An `EditorSuggest` fires when the text before the cursor contains an open `{{` with an optional partial name and no closing `}}` yet. It offers the same catalog, filtered by the partial. Selecting an entry replaces the whole trigger range (the `{{` plus the typed partial) with the full construct, including the closing `}}`; it does not rely on the theme's bracket auto-pairing. Registered via `registerEditorSuggest` so it is cleaned up on unload.
- FR-24.5 **Create-modal button.** The create modal's `Initial body` field gains an `Insert placeholder` button that opens the same `SuggestModal`; the selected construct is spliced into the `<textarea>` at its caret (`selectionStart`), and the caret/selection is set per the entry (templates select the `name` segment).
- FR-24.6 **Inline autocomplete (create-modal textarea).** Typing `{{` in the `Initial body` textarea shows a hand-rolled dropdown over the same catalog (a plain `<textarea>` cannot host `EditorSuggest`), with the same replace-the-trigger-range behavior as FR-24.4. All listeners attached in the modal are removed on modal close.
- FR-24.7 **Template caret.** Inserting a syntax template leaves the `name` segment selected so the user types over it immediately; context variables and library names place the caret after `}}` (nothing to fill).
- FR-24.8 **No new data, no network.** The feature writes only into the editor/textarea the user is already editing. No frontmatter, no `data.json`, no settings field, no network. The catalog is derived from the disposable index and recomputed on open.

## 3. Architecture

- Pure core in `src/domain/` (no Obsidian imports, vitest-covered): the catalog builder over `Prompt[]` + a `getBody` accessor, plus the `{{`-trigger matcher (given the text before the cursor, return the trigger range and the partial query) and the fuzzy/prefix filter. Returns raw entries with `insertText` and caret metadata (selection span offsets or trailing-caret flag). One entry point, one test surface.
- Four thin UI integrations consuming the core: the command + `SuggestModal`, the `EditorSuggest`, the create-modal button, and the textarea autocomplete. Each maps a chosen entry to an insertion on its surface (editor `replaceRange`/`replaceSelection`, or textarea value splice) and applies the caret metadata.
- Mobile: the command and `EditorSuggest` work on the mobile editor; the textarea autocomplete uses touch-safe events.

## 4. UI flows

1. **Command:** active prompt note → `Cmd+P` → `Insert placeholder` → SuggestModal → pick → construct inserted at cursor.
2. **Inline (editor):** type `{{pro` → suggestions filter to `product`, `@…`, templates → pick → `{{pro` replaced by `{{product}}`.
3. **Modal button:** new prompt → click `Insert placeholder` above the body textarea → SuggestModal → pick → inserted at textarea caret.
4. **Inline (modal textarea):** type `{{` in the body textarea → dropdown → pick → inserted, trigger range replaced.

## 5. Edge cases

- Empty library or no existing placeholder names: the library-names section is omitted; context variables and templates are always present, so the palette is never empty.
- Partial that matches nothing: the suggestion popup shows the always-available context variables and templates (never an empty list that blocks typing).
- A `{{` already followed by a `}}` on the same line: the trigger matcher must not span across an existing `}}` (only an open, unclosed `{{`).
- Duplicate placeholder names across prompts: deduplicated to one entry; frequency is the total count of occurrences.
- Inserting inside an existing malformed construct is the user's responsibility; the linter (FR-21) still flags anything malformed afterward.

## 6. Acceptance criteria

- AC-1 With a library containing `{{product}}` and `{{tone}}`, all four surfaces offer `product` and `tone` (by frequency), the four context variables, and the two templates, in the FR-24.2 order.
- AC-2 Selecting a template inserts `{{name|default|hint}}` (or the choice skeleton) with `name` selected; typing immediately replaces `name`.
- AC-3 Inline: typing `{{@da` in the editor and selecting `@date` yields exactly `{{@date}}` with the `{{@da` replaced, no leftover braces, caret after `}}`.
- AC-4 The `Insert placeholder` command does not appear/act when the active note is outside the prompts folder.
- AC-5 An empty library still shows context variables and templates in every surface; no crash, no empty-list dead end.
- AC-6 No note frontmatter, `data.json`, or settings change results from using any surface; a plain export is unaffected.

## 7. Constraints

- Native Obsidian components and vanilla TypeScript only (ADR-0002): `SuggestModal`, `EditorSuggest`, `Setting`/button, plain DOM for the textarea dropdown. Notes are the source of truth; the index is disposable (ADR-0001). No network.
- Lifecycle: `EditorSuggest` via `registerEditorSuggest`; every modal/textarea listener removed on modal close; no leak on unload.
- The pure core is the only vitest-covered part; the four UI integrations are verified by manual smoke (project convention).

## 8. Out of scope

- New placeholder syntax (the catalog only offers existing constructs).
- Rendering or previewing resolved values in the palette.
- Managing/saving custom placeholder presets (that is variable profiles, ADR-0009).
- A settings surface for the palette.

## 9. Known trade-off

The inline autocomplete inside the create-modal `<textarea>` (FR-24.6) has the weakest cost/benefit of the four surfaces: it needs a hand-rolled dropdown because `EditorSuggest` only works in the CodeMirror editor, for a transient authoring field whose real home is the note. It is included at explicit user request; the ADR records this so a future simplification has the rationale.
