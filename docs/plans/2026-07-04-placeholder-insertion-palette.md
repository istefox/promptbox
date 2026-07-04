# Plan: Placeholder insertion palette (FR-24, ADR-0016)

Source: `SPEC.md` (root, placeholder-insertion-palette). Design: `docs/adr/0016-placeholder-insertion-palette.md` (one pure catalog/trigger module, four thin UI surfaces sharing one `SuggestModal` and one pair of insertion appliers).

Observable-contract changes: one new command id (`insert-placeholder`), one new registered `EditorSuggest`, one new required field on the `PromptModalDeps` interface (exactly one production call site, listed in Task 5), five new files, additive CSS rules. No existing function signature, frontmatter shape, settings field, `SortKey`, or export/import field changes; `src/domain/placeholders.ts`, `src/domain/query.ts`, and the transfer layer are untouched.

Full authoritative test command (run after every task, not just Task 1's new files): `npm run build && npm run lint && npm test`.

## Task 1 — Pure core: `src/domain/placeholder-palette.ts` (TDD)

Goal: the catalog builder, trigger matcher, filter, and caret helper, exactly per ADR-0016's Decision section. Write the tests first; they fail against a stub, then pass once implemented.

Files:
- `tests/placeholder-palette.test.ts` (new) — mirror `tests/usage.test.ts` style (plain fixtures, `describe` per function).
- `src/domain/placeholder-palette.ts` (new) — exports `PaletteEntryKind`, `PaletteEntry`, `buildPaletteCatalog`, `PlaceholderTrigger`, `matchPlaceholderTrigger`, `filterCatalog`, `caretRangeAfterInsert`, exact shapes per the ADR. No Obsidian import. Reuses `parsePlaceholders`/`matchPlaceholders`/`isContextVariable` from `src/domain/placeholders.ts` (do not reimplement placeholder parsing).

Test cases (vitest):
- `buildPaletteCatalog`:
  - Empty library (`prompts: []`) still returns the 4 context entries (in FR-24.1's fixed order: `@selection`, `@title`, `@date`, `@clipboard`) followed immediately by the 2 template entries — AC-5.
  - Harvests every distinct well-formed placeholder name via `matchPlaceholders` across all bodies, library section sorted by total occurrence count descending, tie-break name ascending.
  - Counts total occurrences correctly: a name appearing twice in one body and once in another totals 3.
  - Excludes any `@`-prefixed name from the library section (`isContextVariable`), even one not among the four resolved names.
  - Skips malformed occurrences (empty name, >3 segments) when tallying frequency; they contribute nothing and don't crash.
  - Template entries: `insertText` is exactly `"{{name|default|hint}}"` and `"{{name|a,b,c|hint}}"`; both carry `selection: { start: 2, end: 6 }`, and `insertText.slice(2, 6) === "name"` for both.
  - Full order end-to-end: context (4) → library (by frequency/name) → templates (2), never interleaved.
- `matchPlaceholderTrigger`:
  - No `{{` anywhere → `null`.
  - Just typed `{{` → `{ start, end: text.length, query: "" }`.
  - `{{pro` → `query: "pro"`.
  - The last `{{` on the line is already closed by a `}}` before the cursor → `null` (§5 edge case).
  - Two `{{`s, an earlier closed one and a later open one (e.g. `"{{done}} {{pro"`) → matches the later, open one, `query: "pro"`.
- `filterCatalog`:
  - Empty query → catalog returned unchanged (same order).
  - Case-insensitive substring match on `label` (e.g. `"PRO"` matches `"product"`).
  - A query matching nothing falls back to exactly the context + template entries (kind !== "library"), never an empty array (§5 edge case, AC-5).
  - Matches preserve the input catalog's relative order (no re-scoring).
- `caretRangeAfterInsert`:
  - No `selection` on the entry → collapsed caret at `insertAt + insertText.length`.
  - A template entry → `{ start: insertAt + 2, end: insertAt + 6 }`.
  - Non-zero `insertAt` (mid-document insertion) computes correctly in both cases above.

Run: `npm test` while iterating; full command before moving on.

## Task 2 — Shared UI plumbing: appliers, renderer, and the shared modal

Goal: the reusable, surface-agnostic pieces every UI integration builds on. No behavior change yet (nothing calls these from a real command/editor until Task 3); verify by typecheck/lint only.

Files:
- `src/ui/placeholder-ui.ts` (new) —
  - `applyEntryToEditor(editor: Editor, range: EditorRange, entry: PaletteEntry): void` — `editor.replaceRange(entry.insertText, range.from, range.to)`, then `caretRangeAfterInsert(entry, range.from.ch)` projected with `{ line: range.from.line, ch }` (no other conversion needed: `insertText` never contains `\n`), then `editor.setSelection(...)`.
  - `applyEntryToTextarea(textarea: HTMLTextAreaElement, range: { start: number; end: number }, entry: PaletteEntry): void` — splice `textarea.value` directly (`value.slice(0, range.start) + entry.insertText + value.slice(range.end)`), then `caretRangeAfterInsert(entry, range.start)`, then `textarea.focus()` + `textarea.setSelectionRange(caret.start, caret.end)`. **Does not** dispatch any synthetic event (see ADR-0016, reentrancy rationale); callers sync their own state.
  - `renderPaletteEntry(entry: PaletteEntry, el: HTMLElement): void` — `el.createSpan({ text: entry.label })` + `el.createSpan({ text: entry.kind, cls: "promptbox-filters__label" })`. No new CSS.
- `src/ui/placeholder-palette-modal.ts` (new) — `PlaceholderPaletteModal extends SuggestModal<PaletteEntry>`, constructor `(app: App, catalog: PaletteEntry[], onChoose: (entry: PaletteEntry) => void)`. `getSuggestions(query)` → `filterCatalog(this.catalog, query)`; `renderSuggestion(entry, el)` → `renderPaletteEntry(entry, el)`; `onChooseSuggestion(entry)` → `this.onChoose(entry)`. `setPlaceholder("Insert placeholder...")` in the constructor.

Obsidian API facts this relies on (confirmed against `node_modules/obsidian/obsidian.d.ts`, no need to re-derive): `SuggestModal<T>` requires `getSuggestions(query: string)`, `renderSuggestion(value, el)`, `onChooseSuggestion(item, evt)`; `EditorRange` is `{ from: EditorPosition; to: EditorPosition }`; `Editor.replaceRange(text, from, to?)` and `Editor.setSelection(anchor, head?)` exist; `HTMLElement.trigger(eventType)` is an Obsidian DOM augmentation (not used here, noted for Task 6).

Manual smoke: `npm run build && npm run lint` green; no runtime smoke possible yet (no consumer wired).

## Task 3 — Surface 1: command + picker (FR-24.3)

Goal: `Insert placeholder` command, gated to prompt-folder notes, inserting at the editor cursor.

Files:
- `src/main.ts` (modify):
  - Add `private paletteCatalog(): PaletteEntry[] { return buildPaletteCatalog(this.index.getAll(), (p) => this.index.getBody(p)); }`.
  - Add `this.addCommand({ id: "insert-placeholder", name: "Insert placeholder", editorCheckCallback: (checking, editor, ctx) => { const inFolder = ctx.file !== null && ctx.file.path.startsWith(this.settings.promptsFolder + "/"); if (checking) return inFolder; if (inFolder) { new PlaceholderPaletteModal(this.app, this.paletteCatalog(), (entry) => { const cursor = editor.getCursor(); applyEntryToEditor(editor, { from: cursor, to: cursor }, entry); }).open(); } return inFolder; } });` — mirrors `edit-prompt-metadata`'s gating predicate exactly (same known root-folder quirk, not fixed here, see ADR-0016 Neutral consequences).

Manual smoke:
- Open a note inside the prompts folder, run `Insert placeholder` from the command palette: modal opens with context variables first, then any library names, then the two templates.
- Pick `@date` → `{{@date}}` inserted at the cursor, caret lands after `}}`.
- Pick a template → `{{name|default|hint}}` inserted, `name` selected, typing replaces it immediately (AC-2).
- Open a note **outside** the prompts folder: command does not appear in the command palette (AC-4).

## Task 4 — Surface 2: inline autocomplete in the editor (FR-24.4)

Goal: typing `{{` in a prompt note offers the same catalog inline, replacing the trigger range on selection.

Files:
- `src/ui/placeholder-editor-suggest.ts` (new) — `PlaceholderEditorSuggest extends EditorSuggest<PaletteEntry>`, constructor `(app: App, private readonly plugin: PromptboxPlugin)`.
  - `private cachedCatalog: PaletteEntry[] | null = null;`
  - `onTrigger(cursor, editor, file)`: `const trigger = matchPlaceholderTrigger(editor.getLine(cursor.line).slice(0, cursor.ch));` → if `null`, set `this.cachedCatalog = null` and return `null`; else return `{ start: { line: cursor.line, ch: trigger.start }, end: cursor, query: trigger.query }`.
  - `getSuggestions(context)`: lazily build `this.cachedCatalog ??= this.plugin.paletteCatalog();` then `filterCatalog(this.cachedCatalog, context.query)`. (Keeps `onTrigger` cheap per Obsidian's own performance guidance; catalog rebuilt once per trigger session, not per keystroke — FR-24.8.)
  - `renderSuggestion(entry, el)` → `renderPaletteEntry`.
  - `selectSuggestion(entry)`: `if (!this.context) return; applyEntryToEditor(this.context.editor, { from: this.context.start, to: this.context.end }, entry);`
  - Note: after inserting a template, the caret sits mid-line (the `name` selection), which could plausibly cause an immediate re-trigger check by Obsidian's engine. Guard: skip re-triggering by relying on `matchPlaceholderTrigger`'s own "already closed" check — since `entry.insertText` always ends in `}}`, verify manually that no spurious reopen occurs (see risk flag in the architect's report); if one is observed, add a one-shot suppress flag set in `selectSuggestion` and cleared on the next `onTrigger` call.
- `src/main.ts` (modify): in `onload`, `this.registerEditorSuggest(new PlaceholderEditorSuggest(this.app, this));` (lifecycle-managed cleanup on unload, no `indexReady` gate needed: an empty/not-yet-scanned index degrades gracefully to context+templates only, same as AC-5).

Manual smoke:
- In a prompt note, type `{{pro`: suggestions filter to `product` (if present), context vars, templates (matching on substring). Pick `product` → `{{pro` replaced by `{{product}}`, no leftover braces, caret after `}}` (mirrors AC-3's pattern).
- Type `{{@da`, pick `@date` → exactly `{{@date}}`, `{{@da` fully replaced, caret after `}}` (AC-3, literal).
- Type `{{`, then `}}` immediately after (e.g. autocomplete an existing closed pair via cursor placement) — confirm the popup does not appear once the cursor is past the closing `}}` (§5 edge case).
- Type `{{xyz123` (matches nothing) — popup still shows context variables and templates, never empty (§5, AC-5).
- Pick a template inline and confirm no dropdown "flicker" reopening immediately after (see the note above); if it reopens, apply the one-shot suppress guard.

## Task 5 — Surface 3: create-modal button (FR-24.5)

Goal: an "Insert placeholder" button next to the create modal's `Initial body` field, splicing at the textarea's caret.

**Contract-staleness check (required before this task).** Grep run: `PromptModalDeps` / `modalDeps(` across `src/` and `tests/` → interface declared once (`src/ui/prompt-modal.ts:12`), builder declared once (`src/main.ts:278`, private `modalDeps()`), exactly 2 construction call sites, both routed through that one builder (`src/main.ts:301` `openCreateModal`, `src/main.ts:311` `openEditModal`), 0 test constructors (`prompt-modal.ts` has no vitest file; UI glue is manual-smoke by convention). One task updates the interface and its one builder together, in the same commit, so the build is never red in between.

Files:
- `src/ui/prompt-modal.ts` (modify):
  - `PromptModalDeps` gains `paletteCatalog: PaletteEntry[];` (required field).
  - New private fields: `private bodyTextareaEl: HTMLTextAreaElement | null = null;`
  - In the create-mode body row (`bodyRow`, ~line 247): capture `t.inputEl` into `this.bodyTextareaEl` inside the existing `addTextArea` callback; add `bodyRow.addButton((b) => b.setButtonText("Insert placeholder").onClick(() => { const el = this.bodyTextareaEl; if (!el) return; new PlaceholderPaletteModal(this.app, this.deps.paletteCatalog, (entry) => { const at = el.selectionStart ?? el.value.length; applyEntryToTextarea(el, { start: at, end: at }, entry); this.draft.body = el.value; }).open(); }));` — inserts at the caret as a **point** (FR-24.5's literal wording), not a range.
- `src/main.ts` (modify): `modalDeps()` gains `paletteCatalog: this.paletteCatalog()`.

Run the **full** authoritative command after this task (`npm run build && npm run lint && npm test`), not just any new files: this is an interface-contract change and must not silently break the one existing call site.

Manual smoke:
- New prompt → click "Insert placeholder" above the body textarea → modal opens (AC-1 ordering) → pick an entry → spliced in at the caret, caret/selection set correctly (template → `name` selected).
- Confirm `Create` still saves the resulting body correctly (draft.body stays in sync via the direct assignment, no reliance on the textarea's `input` event).

## Task 6 — Surface 4: inline autocomplete in the create-modal textarea (FR-24.6)

Goal: typing `{{` in the `Initial body` textarea shows a hand-rolled dropdown, same trigger-replace behavior as Task 4, all listeners removed on modal close.

Files:
- `src/ui/placeholder-textarea-suggest.ts` (new) — `PlaceholderTextareaSuggest`, constructor `(private readonly textarea: HTMLTextAreaElement, private readonly catalog: PaletteEntry[], private readonly onApply?: () => void)`.
  - Creates `this.dropdownEl` as a child of `textarea.parentElement` (`cls: "promptbox-placeholder-dropdown"`), hidden initially (`toggleClass("is-hidden", true)`, mirroring `filter-bar.ts`'s existing visibility convention).
  - Attaches `input`, `keydown`, `blur` listeners directly on `textarea` (arrow functions stored as instance properties, for correct `removeEventListener` in `destroy()`).
  - `input` handler: computes the current line's prefix (`value.lastIndexOf("\n", selectionStart - 1) + 1` → `lineStart`; slice to `selectionStart`), runs `matchPlaceholderTrigger`; if `null`, hides the dropdown; else stores `{ absoluteStart: lineStart + trigger.start, absoluteEnd: selectionStart, query: trigger.query }`, runs `filterCatalog`, resets the highlighted index to 0, renders.
  - `keydown` handler: `Escape` closes; `ArrowDown`/`ArrowUp` move the highlighted index (clamped, re-render); `Enter` confirms the highlighted entry (`preventDefault`, so it never also inserts a newline in the textarea).
  - Render: items get `cls: "suggestion-item" [+ " is-selected" for the highlighted one]` inside a `cls: "suggestion-container"` wrapper (reuses Obsidian's native suggestion look); each item's selection listener is `pointerdown` (touch-safe, SPEC §3), with `preventDefault()` so the textarea never loses focus/blurs before the pick registers.
  - `choose(entry)`: `applyEntryToTextarea(this.textarea, { start: absoluteStart, end: absoluteEnd }, entry)`, then `this.onApply?.()`, then close.
  - `blur` handler: closes the dropdown (no document/window listener needed — see ADR-0016).
  - `destroy()`: removes all three textarea listeners.
- `src/ui/prompt-modal.ts` (modify):
  - `bodyRow.controlEl.addClass("promptbox-placeholder-host")`.
  - New private field `private bodyTextareaSuggest: PlaceholderTextareaSuggest | null = null;`; instantiate it right after capturing `this.bodyTextareaEl` in the create-mode branch: `this.bodyTextareaSuggest = new PlaceholderTextareaSuggest(t.inputEl, this.deps.paletteCatalog, () => { this.draft.body = t.inputEl.value; });`.
  - Add `override onClose(): void { this.bodyTextareaSuggest?.destroy(); }`.
- `styles.css` (modify) — new block:
  ```css
  /* Placeholder insertion palette: hand-rolled textarea dropdown (FR-24.6) */
  .promptbox-placeholder-host {
  	position: relative;
  }

  .promptbox-placeholder-dropdown {
  	position: absolute;
  	top: 100%;
  	left: 0;
  	right: 0;
  	z-index: var(--layer-popover);
  	max-height: 200px;
  	overflow-y: auto;
  	background: var(--background-primary);
  	border: 1px solid var(--background-modifier-border);
  	border-radius: var(--radius-m);
  	box-shadow: var(--shadow-s);
  }

  .promptbox-placeholder-dropdown.is-hidden {
  	display: none;
  }
  ```
  Confirm `--layer-popover` resolves in a live Obsidian vault (it is a standard Obsidian theme z-index token, not vendored in `node_modules`, so it cannot be grepped locally); fall back to a literal z-index (e.g. `100`) if it does not.

Manual smoke:
- Type `{{` in the `Initial body` textarea: dropdown appears below the field with the full catalog.
- Type `{{pro`: filters live; arrow keys move the highlight; `Enter` inserts the highlighted entry and replaces the whole trigger range, no leftover braces.
- Click an entry with the mouse/touch: same result; textarea keeps focus throughout (no premature blur-close).
- Press `Escape` while the dropdown is open: it closes, no text is inserted, typing resumes normally.
- Click away (blur the textarea) while the dropdown is open: it closes.
- Close the modal (Cancel or Create) while the dropdown is open at least once during the session: reopen the create modal, confirm no duplicate/ghost dropdown and no console errors (listener cleanup, FR-24.6 lifecycle requirement).

## Task 7 — Final verification

Goal: confirm all six acceptance criteria hold end-to-end, nothing regressed, and the feature is provably state-free.

Files: none (verification only). Do not edit `PROJECT.md` (orchestrator-owned) or `docs/adr/README.md` (already updated alongside ADR-0016).

Test:
- Run the full authoritative command: `npm run build && npm run lint && npm test` — green (typecheck, production build, lint, entire vitest suite, not only the new files).
- Re-walk all six SPEC.md acceptance criteria in a real or test vault:
  - AC-1: a library with `{{product}}`/`{{tone}}` — all four surfaces offer both names (by frequency), the four context variables, and the two templates, in FR-24.2 order.
  - AC-2: a template inserts with `name` selected; typing replaces it immediately.
  - AC-3: inline, typing `{{@da` and picking `@date` yields exactly `{{@date}}`, no leftover braces, caret after `}}`.
  - AC-4: `Insert placeholder` does not appear/act outside the prompts folder.
  - AC-5: an empty library still shows context variables and templates on every surface; no crash, no empty-list dead end.
  - AC-6: no note frontmatter, `data.json`, or settings change results from any surface; export a library before and after exercising all four surfaces and diff — byte-identical.
- Grep `src/domain/placeholder-palette.ts` for any Obsidian import or write-capable call — expect none.
- Grep the transfer layer (`src/storage/transfer-io.ts`, `src/domain/transfer.ts`) and `src/main.ts`'s `saveSettings`/`saveData` call — confirm nothing from this feature (`paletteCatalog`, `PaletteEntry`, `insertText`) appears in any persisted or exported shape.
- Confirm lifecycle: reload the plugin (disable/enable) with a prompt note open and the editor-suggest popover previously used at least once — no leaked listener errors, `Insert placeholder` command still works after reload.

## Task checklist

- [ ] Task 1 — `src/domain/placeholder-palette.ts` pure module, TDD, vitest-covered.
- [ ] Task 2 — Shared UI plumbing: `placeholder-ui.ts` appliers/renderer, `PlaceholderPaletteModal`.
- [ ] Task 3 — Surface 1: `insert-placeholder` command + picker, gated to the prompts folder.
- [ ] Task 4 — Surface 2: `PlaceholderEditorSuggest`, registered via `registerEditorSuggest`.
- [ ] Task 5 — Surface 3: create-modal button, `PromptModalDeps.paletteCatalog` contract change verified.
- [ ] Task 6 — Surface 4: hand-rolled `PlaceholderTextareaSuggest` dropdown + CSS + lifecycle cleanup.
- [ ] Task 7 — Full build/lint/test green, AC-1..AC-6 re-verified, no persisted state confirmed.
