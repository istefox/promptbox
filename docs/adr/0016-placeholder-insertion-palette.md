# ADR-0016: Placeholder insertion palette: one pure catalog/trigger module shared across four native UI surfaces

| | |
|---|---|
| Status | Accepted |
| Date | 4 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `SPEC.md` (placeholder-insertion-palette, FR-24), ADR-0001, ADR-0002, ADR-0005, ADR-0006, ADR-0009, `src/domain/placeholders.ts` |

## Context

Prompt placeholders (`{{name}}`, `{{name|default}}`, `{{name|default|hint}}`, the choice form `{{name|a,b,c|hint}}`, and the reserved context variables `{{@selection}}` `{{@title}}` `{{@date}}` `{{@clipboard}}`) are not discoverable while authoring. Today the user has to remember all of it; the linter (ADR-0010) only flags a malformed construct after the fact. `SPEC.md` FR-24 adds an insertion helper reachable from four surfaces: a command + picker, inline autocomplete in the note editor, a button in the create modal, and inline autocomplete inside the create modal's plain `<textarea>`. It offers only constructs that already exist (reserved names, names already used somewhere in the library, and the two syntax skeletons); it invents nothing and stores nothing.

FR-24 fixes the observable behavior precisely (catalog content and order, caret placement, trigger detection, the four surfaces, the constraints, and an explicitly accepted trade-off for the weakest of the four surfaces). It leaves the code shape open. This ADR settles:

- the exact shape and name of the one pure module the whole feature is built on;
- how a `SuggestModal` and its insertion mechanics are shared between the two modal-based surfaces instead of duplicated;
- whether the textarea surface can reuse an existing Obsidian suggestion primitive (`AbstractInputSuggest`, the same class already used for tag/folder autocomplete in `src/ui/suggest.ts`) or genuinely needs hand-rolled DOM, checked directly against the vendored `obsidian.d.ts`, not assumed;
- how caret placement (a selected span for a template, a trailing caret otherwise) is computed once and applied identically on both the CodeMirror editor and the flat-string textarea, which use different coordinate systems;
- what, if anything, changes in `PromptModalDeps` and `PromptboxPlugin`'s existing dependency-injection shape.

## Decision

Build one pure core module and four thin, mechanically simple UI consumers. Nothing is persisted; the catalog is derived from the disposable index (`PromptIndex`, ADR-0001) and rebuilt on every surface-open, never cached across sessions.

### Pure core: `src/domain/placeholder-palette.ts` (new, no Obsidian import, 100% vitest-covered)

```ts
export type PaletteEntryKind = "context" | "library" | "template";

export interface PaletteEntry {
  /** Stable key (kind + label); for tests/DOM-keying only, never persisted. */
  id: string;
  /** Text shown in the picker/dropdown. */
  label: string;
  kind: PaletteEntryKind;
  /** Exact text to splice in; never contains a newline (surfaces rely on this). */
  insertText: string;
  /** Offsets within insertText to select after insertion (e.g. the "name" segment
   *  of a template). Absent = caret lands at the end of insertText (FR-24.7). */
  selection?: { start: number; end: number };
}

/**
 * FR-24.1/24.2: context variables (fixed order, FR-24.1's own listing) first,
 * then every distinct well-formed placeholder name harvested from the library
 * via matchPlaceholders (context-variable names excluded, isContextVariable),
 * sorted by total occurrence count descending / name ascending, then the two
 * syntax templates. Never empty: context + templates are unconditional.
 */
export function buildPaletteCatalog(prompts: Prompt[], getBody: (path: string) => string): PaletteEntry[];

export interface PlaceholderTrigger {
  /** Offset of the opening "{{" within textBeforeCursor. */
  start: number;
  /** Offset of the cursor itself, i.e. textBeforeCursor.length. */
  end: number;
  /** Text typed after "{{", used to filter the catalog; may be empty. */
  query: string;
}

/**
 * FR-24.4/24.6: given the text from the start of the current line up to the
 * cursor (callers never pass more than one line, so a trigger never spans a
 * newline), returns the innermost open, unclosed "{{" and its partial query,
 * or null when there is none or it is already closed by a "}}" (edge case §5).
 * Pure string scan: lastIndexOf("{{"), then reject if anything after it is
 * "}}"; the query is whatever remains.
 */
export function matchPlaceholderTrigger(textBeforeCursor: string): PlaceholderTrigger | null;

/**
 * FR-24.4 filter, shared by all four surfaces: case-insensitive substring on
 * label, order-preserving (never re-scores/reorders FR-24.2's canonical
 * order). Empty query returns the catalog unchanged. A query that matches
 * nothing falls back to the context + template entries, so the result is
 * never empty (§5 edge case, AC-5).
 */
export function filterCatalog(catalog: PaletteEntry[], query: string): PaletteEntry[];

/**
 * FR-24.7 caret math, shared by both insertion surfaces: projects an entry's
 * selection (or, absent one, a trailing collapsed caret) onto absolute
 * offsets anchored at insertAt (where insertText's first character lands).
 * Every UI surface calls this instead of branching on "span vs trailing"
 * itself.
 */
export function caretRangeAfterInsert(entry: PaletteEntry, insertAt: number): { start: number; end: number };
```

The two syntax templates are `{{name|default|hint}}` and `{{name|a,b,c|hint}}` (FR-24.1); both select the `name` segment, offsets `{ start: 2, end: 6 }` in either string (`"{{" + "name"`). The four context variables and their fixed order are FR-24.1's own listing: `@selection`, `@title`, `@date`, `@clipboard`. No earlier module exports this list in this order (the UI-layer resolver's lookup table in `src/ui/context-variables.ts` has no order semantics), so this module is the first place the order becomes an explicit, tested contract.

### Trigger scope: line-relative by contract, not whole-document

`matchPlaceholderTrigger` only ever sees what its caller passes it. Both UI surfaces pass the current line's prefix (CodeMirror: `editor.getLine(cursor.line).slice(0, cursor.ch)`; textarea: the substring from the last `\n` before `selectionStart`, or the start of the value). This keeps the pure function trivial (one `lastIndexOf`, one substring check) and sidesteps a genuinely harder problem (nested/multi-line unclosed constructs) that this feature does not need to solve; full placeholder-syntax validation remains the linter's job (ADR-0010).

### Four UI surfaces, one shared modal, one shared pair of appliers

New UI-layer files, none vitest-covered (manual smoke, project convention):

- `src/ui/placeholder-ui.ts` — `applyEntryToEditor(editor, range: EditorRange, entry)` and `applyEntryToTextarea(textarea, range: {start, end}, entry)`, plus `renderPaletteEntry(entry, el)` (label + a muted kind suffix, reusing the existing `promptbox-filters__label` class, no new CSS for this). Both appliers splice the text, then call `caretRangeAfterInsert` and translate its abstract offsets into their own coordinate system: the editor needs zero conversion (CodeMirror's `ch` already is a line offset, and `insertText` never contains `\n`); the textarea needs one addition (`lineStart + offset`) because its coordinate system is a flat whole-value offset, not line-relative. This is the entire answer to "how is caret metadata applied per surface": one shared computation, two one-line projections.
- `src/ui/placeholder-palette-modal.ts` — `PlaceholderPaletteModal extends SuggestModal<PaletteEntry>`, constructed with `(app, catalog: PaletteEntry[], onChoose: (entry: PaletteEntry) => void)`. `getSuggestions` calls `filterCatalog`; `renderSuggestion` calls `renderPaletteEntry`; `onChooseSuggestion` calls the injected `onChoose`. The modal knows nothing about editors or textareas: **surfaces 1 and 3 (FR-24.3, FR-24.5) are exactly this one class, constructed with a different three-line `onChoose`.** A plain `SuggestModal`, not `FuzzySuggestModal`, is used deliberately (see Alternative 1) so the exact same `filterCatalog` drives every surface, including the "never empty" fallback that Obsidian's own fuzzy engine does not give for free.
- `src/ui/placeholder-editor-suggest.ts` — `PlaceholderEditorSuggest extends EditorSuggest<PaletteEntry>`, constructed with `(app, plugin: PromptboxPlugin)` (mirrors `PromptQuickPicker`'s existing `(app, plugin)` shape). `onTrigger` stays cheap (one `getLine().slice()` + `matchPlaceholderTrigger`), per Obsidian's own performance guidance for this hook; the catalog itself is lazily built on the first `getSuggestions` of a trigger session and cached on the instance, invalidated whenever `onTrigger` returns `null` (rebuilt fresh next open, satisfying FR-24.8's "recomputed on open" without rebuilding on every keystroke of a partial). `selectSuggestion` calls `applyEntryToEditor`. Registered once via `this.registerEditorSuggest(...)` in `onload` (lifecycle-managed cleanup on unload, FR-24.4).
- `src/ui/placeholder-textarea-suggest.ts` — `PlaceholderTextareaSuggest`, a small hand-rolled controller bound to one `<textarea>` (FR-24.6). Constructed with `(textarea, catalog, onApply?)`; attaches exactly three listeners directly on the textarea (`input`, `keydown`, `blur`) plus a `pointerdown` (not `click`, for touch-safety per SPEC §3) on each rendered dropdown item. `destroy()` removes all three; `PromptModal.onClose()` (new override) calls it. No document/window-level listener is used anywhere: blur alone closes the dropdown, and a `pointerdown` + `preventDefault()` on an item keeps focus on the textarea so blur never fires before the pick registers, so nothing needs cleanup beyond the textarea's own three listeners, and nothing survives a `contentEl.empty()` re-render or a modal close. Keyboard model, deliberately minimal for this explicitly weakest-ROI surface: arrow keys move a highlighted index, `Enter` confirms the highlighted entry, `Escape` dismisses; no attempt to fully match Obsidian's native suggestion keyboard handling.

### Why not `AbstractInputSuggest` for the textarea

Checked directly against `node_modules/obsidian/obsidian.d.ts`: `AbstractInputSuggest`'s constructor is typed `(app: App, textInputEl: HTMLInputElement | HTMLDivElement)`. A `<textarea>` is neither. FR-24.6's hand-rolled dropdown is not a stylistic choice, it is the only option inside "native components only" (ADR-0002) that still targets a plain `<textarea>`.

### Command gating and dependency wiring

- New command `insert-placeholder` / "Insert placeholder" uses `editorCheckCallback` (not `checkCallback`, which `Edit prompt metadata` uses): the gating predicate is identical (`ctx.file !== null && ctx.file.path.startsWith(this.settings.promptsFolder + "/")`), but this command also needs the live `Editor`, which `editorCheckCallback` hands over together with the gate in one Obsidian-idiomatic callback, rather than re-deriving the active editor separately.
- `PromptboxPlugin` gains one private accessor, `paletteCatalog(): PaletteEntry[]`, returning `buildPaletteCatalog(this.index.getAll(), (p) => this.index.getBody(p))`. Three call sites share it: the `insert-placeholder` command, `modalDeps()` (below), and `PlaceholderEditorSuggest.getSuggestions` (via the injected `plugin`, lazily, cached per trigger session). No caller re-derives the `buildPaletteCatalog(...)` call independently.
- `PromptModalDeps` (`src/ui/prompt-modal.ts`) gains one field, `paletteCatalog: PaletteEntry[]`, populated by `modalDeps()`. This is an additive interface change with exactly one production call site to update (`main.ts`'s `modalDeps()`, itself called from only `openCreateModal`/`openEditModal`); no test constructs this shape today (`prompt-modal.ts` has no vitest coverage, UI glue is manual-smoke by convention).
- The create modal's body `Setting` row gains an "Insert placeholder" button (opens `PlaceholderPaletteModal`, splices at `textarea.selectionStart` as a **point**, not a range, per FR-24.5's literal wording) and a `PlaceholderTextareaSuggest` attached to the same `<textarea>` (FR-24.6). Both bypass the field's existing `onChange` wiring (no synthetic DOM event dispatch) and instead write `this.draft.body = textareaEl.value` directly after applying an entry; this sidesteps a genuine reentrancy hazard (dispatching a synthetic `input` event would re-invoke `PlaceholderTextareaSuggest`'s own `input` listener on the very insertion it just made) at the cost of not re-running the tag/category suggestion refresh (ADR-0006) on a placeholder insertion, an accepted, deliberate omission (a placeholder token is not meaningful new tag/category signal).
- Command/button insert at a **point** (the current cursor / `selectionStart`); the two inline-autocomplete surfaces replace a **range** (the trigger span). One rule, no surface guesses which mode it is in.

### CSS

One new block in `styles.css`, for the textarea dropdown only (the other three surfaces render through Obsidian's own modal/suggestion chrome, or through `promptbox-filters__label`, so they need nothing new): a `position: relative` host class added to the body row's control element, and a `position: absolute` dropdown box below the field (not caret-tracked, no mirror-div; a below-the-field placement is simpler, robust across textarea resizes, and proportionate to a small, infrequently-used authoring aid). The dropdown's item rows reuse Obsidian's native `.suggestion-container` / `.suggestion-item` / `.is-selected` classes for visual consistency with the other three surfaces, at the minor, accepted cost of a soft dependency on non-public-API CSS class names.

## Alternatives considered

1. **True fuzzy scoring via Obsidian's built-in engine (`FuzzySuggestModal`/`prepareFuzzySearch`) for the command surface, hand-rolled substring filtering for the rest.** Rejected. It cannot be reused verbatim inside `EditorSuggest` or the hand-rolled textarea dropdown (neither gets `FuzzySuggestModal`'s engine for free), so at least three of the four surfaces would need their own filter regardless; a scored fuzzy match also reorders results away from FR-24.2's pinned order (context, frequency, templates), which AC-1 requires to stay stable under filtering. One shared, simple, order-preserving substring filter (mirroring the existing `.includes()` convention already used by `TagSuggest`/`FolderSuggest`/`JsonFileSuggest` in `src/ui/suggest.ts`) is both simpler and more consistent across all four surfaces than "real" fuzzy matching on one surface and an ad hoc filter on the other three.
2. **One combined UI-layer class owning catalog-building, trigger-matching, filtering, and insertion, with no separate pure domain module.** Rejected. It would make ordering, dedup, frequency, trigger detection, and caret math testable only through a mocked Obsidian `Editor`/`Modal`, breaking the project's established "domain gets vitest, UI glue gets manual smoke" convention (`variable-profiles.ts`, `usage.ts`, `related.ts`, `stats.ts`, `lint.ts`), and it would duplicate that logic across, at minimum, the modal, the `EditorSuggest`, and the textarea controller instead of sharing one tested implementation.
3. **A persisted "recently inserted placeholders" MRU list in `data.json`, biasing catalog order by the user's own insertion history** (the usage-recency-tracking pattern, ADR-0015, applied here too). Rejected. FR-24.2 already pins a full, deterministic order; a second persisted ranking signal is new plugin state that FR-24.8 and the constraints explicitly rule out ("no `data.json`... the whole feature only inserts text into the surface the user is editing"). Frequency-from-the-library is a reasonable, zero-state proxy for "useful," and no requirement asks for more.
4. **Reuse `AbstractInputSuggest` for the textarea surface instead of hand-rolling.** Rejected on direct evidence, not assumption: `AbstractInputSuggest`'s constructor (`node_modules/obsidian/obsidian.d.ts`) is typed to `HTMLInputElement | HTMLDivElement` only. A `<textarea>` cannot be passed. The hand-rolled dropdown is the only remaining option that still counts as "native components, vanilla TypeScript" (ADR-0002) for this one field.
5. **One shared "popover controller" class used verbatim by both the `EditorSuggest` surface and the textarea dropdown**, to avoid two small UI classes. Rejected. `EditorSuggest` is an Obsidian base class registered once for the plugin's lifetime and driven by CodeMirror's `onTrigger`/`getSuggestions` contract; the textarea controller is constructed and destroyed per modal-open, bound to one DOM element, driven by raw DOM events, in a flat-offset coordinate system instead of CodeMirror's line+ch. Forcing both under one shared class would blur two genuinely different lifecycles and coordinate systems for no real saving, since the actually-shared logic (catalog, trigger matching, filtering, caret math) already lives in the pure domain module and the two small appliers.
6. **Cache the built catalog for the plugin's whole session (build once in `onload`) instead of recomputing per surface-open.** Rejected. FR-24.8 explicitly asks for "recomputed on open," and the index it is built from is disposable and can change between one open and the next (ADR-0001); a plugin-lifetime cache would go stale in exactly the way ADR-0001 already rejects for the index itself. Rebuilding per open is cheap at the ~1,000-prompt NFR-1 target (the same per-body regex scan cost the linter already pays every render) and keeps the feature genuinely stateless: nothing is cached beyond one surface-open, so nothing can go stale beyond it either.
7. **Drop FR-24.6 (the textarea dropdown) entirely and ship only the three surfaces with a native primitive behind them.** Rejected, though it is the alternative with the best cost/benefit ratio of the seven considered here. SPEC §9 records this explicitly: FR-24.6 has the weakest ROI of the four surfaces (a hand-rolled dropdown for a transient authoring field whose real home is the note) and is included at explicit user request. This ADR carries that trade-off forward rather than re-litigating it, so a future simplification (dropping FR-24.6) has its rationale on record.

## Consequences

**Positive:** One pure, 100%-vitest-covered module (`placeholder-palette.ts`) is the single source of truth for catalog content, order, dedup, frequency, trigger detection, filtering, and caret math; all four UI surfaces are thin, mechanically simple consumers, so a hypothetical fifth surface would need almost no new logic. Zero new persisted state: no frontmatter key, no `data.json` field, no settings row (FR-24.8), so a plain export/import is provably unaffected, the feature never touches `Prompt`, `PromptDraft`, or the transfer layer at all. The catalog reuses `parsePlaceholders`/`matchPlaceholders`/`isContextVariable` from the already-hardened parser (`placeholders.ts`) instead of re-implementing placeholder-syntax detection, so the palette can never disagree with the linter (ADR-0010) or the resolver (FR-4) about what counts as a well-formed placeholder. The single caret-math helper (`caretRangeAfterInsert`) is applied identically by the editor and textarea surfaces, with the only per-surface difference being a one-line coordinate projection, so caret placement cannot drift between surfaces. The shared `PlaceholderPaletteModal` and the shared filter function guarantee the command, the button, and (via the same filter) the two inline surfaces all present the exact same catalog, order, and matching behavior, so "insert placeholder" feels identical regardless of which of the four surfaces the user reaches for.

**Negative and accepted:** The hand-rolled textarea dropdown (FR-24.6) is genuinely new, bespoke UI surface area with no native Obsidian primitive behind it (`AbstractInputSuggest` cannot target a `<textarea>`, confirmed against the vendored type declarations), so it carries its own small risk surface (focus/blur/pointer races, minimal keyboard handling, positioning) that the other three surfaces get for free from Obsidian's own suggest machinery. This is the explicitly accepted, weakest-ROI trade-off recorded in SPEC §9: it exists at explicit user request, not because its cost/benefit stacks up against the other three surfaces. The dropdown is positioned below the field rather than at the caret's pixel position (no mirror-div caret tracking), so on a multi-line body it can appear visually distant from where the user is typing; accepted as proportionate for a small, infrequently-used authoring aid. Its keyboard model (arrow keys, `Enter`, `Escape`) is a deliberate scope trim, not a full parity audit against Obsidian's native suggestion keyboard handling, a real, user-visible asymmetry against the other three surfaces. `PromptModalDeps` gains a required field; every current and future constructor of that shape must supply it (today, exactly one: `main.ts`'s `modalDeps()`). Inserting a placeholder into the create-modal body via the button or the dropdown does not re-run the tag/category suggestion refresh (ADR-0006), because both bypass the textarea's `onChange` wiring on purpose to avoid a synthetic-event reentrancy hazard; accepted because a placeholder token is not meaningful new tag/category signal. The `EditorSuggest` surface caches its catalog for the duration of one trigger session and could show a one-keystroke-stale catalog if the vault changes mid-typing; accepted as immaterial at human typing speed. The dropdown's list styling leans on Obsidian's internal (non-public-API) `.suggestion-container`/`.suggestion-item` classes for visual consistency; a future Obsidian release could restyle or rename them, a visual-only risk, never a functional one, since our own controller drives all behavior independently of those classes.

**Neutral:** The four reserved context-variable names and their fixed display order are taken verbatim from FR-24.1's own listing; no existing module exported a canonical ordered list of them before this ADR. The feature adds no new `SortKey`, no new `LibraryQuery` field, and touches no export/import code path; there is no ARCH.md for this project to update. `insert-placeholder` inherits the same root-prompts-folder gating quirk as the pre-existing `Edit prompt metadata` command (`path.startsWith(folder + "/")` never matches when `promptsFolder` is configured as the vault root), a pre-existing pattern this feature mirrors for consistency rather than one it introduces or silently fixes. Any `PROJECT.md` tracking for this feature is orchestrator-owned bookkeeping, out of scope for this ADR and its plan (mirrors ADR-0015's framing).

## References

- `SPEC.md` (root, placeholder-insertion-palette) — FR-24.1 through FR-24.8, UI flows, edge cases (§5), acceptance criteria AC-1 through AC-6, constraints (§7), out of scope (§8), the known trade-off (§9).
- ADR-0001 (`docs/adr/0001-storage-markdown-frontmatter.md`) — notes as source of truth, disposable index; the basis for "recompute on open, never cache across sessions."
- ADR-0002 (`docs/adr/0002-ui-native-obsidian-components.md`) — native UI, vanilla TypeScript, no network; binding background, and the standard the hand-rolled dropdown is measured against.
- ADR-0005 (`docs/adr/0005-context-variables.md`) — the reserved `@` namespace this feature's context-variable section surfaces; `isContextVariable` reused verbatim, never reimplemented.
- ADR-0006 (`docs/adr/0006-tag-category-suggestions.md`) — the `promptbox-filters__label` chip-row visual language reused for the kind suffix; the suggestion-refresh interaction this feature deliberately does not re-trigger on a placeholder insertion.
- ADR-0009 (`docs/adr/0009-variable-profiles.md`) — the pure-module-plus-narrow-deps-injection style this ADR's core module and `PromptModalDeps` extension both follow.
- ADR-0010 (`docs/adr/0010-prompt-linter.md`) — the shared-pass-over-the-library convention `buildPaletteCatalog` follows, and the malformed-placeholder authority this feature defers to rather than duplicating.
- ADR-0015 (`docs/adr/0015-usage-recency-tracking.md`) — the closest prior precedent for "why not persist a ranking signal," distinguished in Alternative 3.
- Internal precedent drawn on directly: `src/domain/placeholders.ts` (`parsePlaceholders`, `matchPlaceholders`, `isContextVariable`, never reimplemented), `src/ui/quick-picker.ts` (`(app, plugin)` constructor shape for a plugin-wide picker), `src/ui/suggest.ts` (`.includes()` substring filter convention, `AbstractInputSuggest`'s `HTMLInputElement | HTMLDivElement` constructor typing that rules it out for FR-24.6), `src/ui/filter-bar.ts` (`toggleClass("is-hidden", ...)` visibility convention), `node_modules/obsidian/obsidian.d.ts` (`SuggestModal`, `EditorSuggest`, `EditorSuggestContext`/`EditorSuggestTriggerInfo`, `AbstractInputSuggest`, the `HTMLElement.trigger`/`hide`/`show` DOM augmentations).
