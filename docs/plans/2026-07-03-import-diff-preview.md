# Plan: import-conflict diff preview (FR-17, ADR-0011)

Source: `SPEC.md`, `docs/adr/0011-import-diff-preview.md`. Branch: `feat/import-diff-preview`.

Testing boundary (see ADR-0011 Context): only `src/domain/transfer.ts` additions get vitest coverage in this plan. `src/storage/transfer-io.ts` and `src/ui/*` changes are UI/I-O glue, verified by manual smoke — this matches every other function in those two files today (`runImport`, `exportWithDialog`, `ImportModal` have no test file of their own).

Full-suite command (authoritative, `.claude/test-cmd`, unchanged by this feature): `npm run build && npm run lint && npm test`. Run it after every task, not just at the end — task 1 in particular refactors `buildExport`'s internals and must not shift any existing `buildExport`/`planImport`/`validateImport` test in `tests/transfer.test.ts`.

---

- [x] **Task 1 — Domain diff engine (`src/domain/transfer.ts`, TDD)**

  Goal: a pure, vitest-covered function that turns an existing conflicting prompt (current metadata + body) and an incoming `ExportedPrompt` into a structured diff, plus the line-based body comparison it depends on. Also extract the reusable "Prompt + body → transfer shape" mapper so the existing side of the diff and `buildExport`'s output come from one place.

  Files:
  - `src/domain/transfer.ts` — extract `toExportedPrompt(prompt: Prompt, body: string, relativePath: string): ExportedPrompt` out of `buildExport`'s current `.map(...)` body and export it; `buildExport` calls it per item, output unchanged. Add exported types `ImportFieldChange` (discriminated union: `{ field: "tags"; from: string[]; to: string[] }` | `{ field: "quality"; from: number | undefined; to: number | undefined }` | `{ field: <the other 8 scalar keys>; from: string; to: string }`) and `ImportDiff` (`{ targetPath: string; identical: boolean; fieldChanges: ImportFieldChange[]; body: { changed: boolean; added: number; removed: number } }`). Add `lineDelta(oldBody: string, newBody: string): { added: number; removed: number }` (line-multiset difference, see ADR-0011 Decision). Add `diffImportEntry(existing: ExportedPrompt, incoming: ExportedPrompt): ImportDiff`, comparing fields in the fixed order `title, type, category, tags, quality, use_case, visibility, version, created, updated` (matches `applyEntry`'s write order in `transfer-io.ts`), with `body.changed = added > 0 || removed > 0` and `identical = fieldChanges.length === 0 && !body.changed`.
  - `tests/transfer.test.ts` — new `describe("lineDelta", ...)` and `describe("diffImportEntry (FR-17.2, FR-17.3)", ...)` blocks. Do not remove or alter the existing `buildExport` / `validateImport` / `planImport` / round-trip describe blocks; they are the regression guard for the `toExportedPrompt` extraction.

  Contract change: none observable (new exports only; `buildExport`'s signature and output are unchanged — confirmed by grep, its only call-sites are `src/main.ts:134` and the 3 existing `tests/transfer.test.ts` call-sites, none of which need edits).

  Test (write first, then implement to green):
  - `lineDelta`: identical bodies → `{added:0, removed:0}`; 2 lines appended, nothing else changed → `{added:2, removed:0}`; one line edited in place → `{added:1, removed:1}`; empty existing body vs N-line incoming → `{added:N, removed:0}`.
  - `diffImportEntry`: the exact acceptance-criteria scenario from `SPEC.md` §3 — `quality` 3→5, body with 2 lines appended and nothing removed, everything else equal — expect `fieldChanges` = one entry for `quality` (`from: 3, to: 5`), `body: {changed:true, added:2, removed:0}`, `identical: false`.
  - Byte-identical existing vs incoming (all fields and body equal) → `fieldChanges: []`, `body: {changed:false, added:0, removed:0}`, `identical: true` (SPEC.md §3 third bullet).
  - `tags` changed (e.g. `["x"]` → `["x","y"]`) → surfaces as `{field:"tags", from:["x"], to:["x","y"]}`, raw arrays, not a joined string.
  - `quality` defined→undefined and undefined→defined, each surfaced as a field change with the raw `number | undefined` values.
  - Metadata identical but body changed → `identical: false`, `fieldChanges: []`.
  - `created`/`updated` differing → surfaced as field changes (deliberate: mirrors what `applyEntry` actually overwrites, see ADR-0011).

- [x] **Task 2 — Storage orchestration (`src/storage/transfer-io.ts`, manual smoke)**

  Goal: compute the diff list for every planned overwrite conflict, reading current vault state, without writing anything.

  Files:
  - `src/storage/transfer-io.ts` — extract `runImport`'s inline existing-paths computation into `listExistingRelativePaths(app: App, folder: string): Set<string>`; `runImport` calls it, behavior unchanged (confirmed by grep: `runImport`'s only call-site is `src/ui/import-modal.ts:100`, signature untouched). Add `buildOverwritePreview(app: App, folder: string, doc: ExportDoc): Promise<ImportDiff[]>`: `listExistingRelativePaths` → `planImport(doc, existing, "overwrite")` → filter `kind === "overwrite"` → for each, `app.vault.getFileByPath(fullPath)`; if null, skip (file vanished since listing, `runImport` already falls back to create in this case); else `readPromptFromCache(app, file)` + `stripFrontmatter(await app.vault.cachedRead(file))` (both already exported from `src/storage/frontmatter.ts`) → `toExportedPrompt(existingPrompt, existingBody, action.targetPath)` → `diffImportEntry(existingExported, action.entry)`.

  Contract change: none observable (`runImport`'s signature/behavior unchanged; `buildOverwritePreview` is a new export, no existing caller to update).

  Test: no new vitest file (see testing-boundary note above). Manual smoke deferred to Task 5. Immediate check for this task: `npm run build` must typecheck cleanly (this file already imports `obsidian` types, so it is exercised by `tsc`, just not by `vitest`).

- [x] **Task 3 — Preview modal (`src/ui/import-preview-modal.ts`, new file + `styles.css`)**

  Goal: a native `Modal` (ADR-0002) that renders the `ImportDiff[]` from Task 2 and gates on Confirm/Cancel.

  Files:
  - `src/ui/import-preview-modal.ts` (new) — `ImportPreviewModal extends Modal`, constructor `(app: App, diffs: ImportDiff[], onConfirm: () => void)` (narrow deps, no `PromptboxPlugin` reference — matches the pattern already used by `VariableModal`/`ConfirmModal`). `onOpen()`: title "Review overwrite changes"; for each `ImportDiff`, render `targetPath` as a heading, then either the literal label "identical" or the field-change list (this is where raw `ImportFieldChange` values become presentation: `tags.join(", ")`, `quality ?? "none"`, plain strings for the rest) followed by the body line ("unchanged" or `changed (+N/-N)`); a `Setting` row with a `setCta()` "Confirm import" button (`close()` then `onConfirm()`) and a "Cancel" button (`close()` only, no callback — nothing written, matches SPEC.md §3 second bullet).
  - `styles.css` — additive rules for the new list, following the existing `promptbox-<component>__<part>` convention (e.g. `promptbox-diff-preview__item`, `promptbox-diff-preview__field`, `promptbox-diff-preview__body`, `promptbox-diff-preview__identical`), Obsidian CSS variables only (no hinfluencing existing selectors).

  Contract change: none (new file, new CSS rules only).

  Test: manual smoke, deferred to Task 5 (this modal has no standalone entry point yet — Task 4 wires it in).

- [x] **Task 4 — Wire the gate into `ImportModal` (`src/ui/import-modal.ts`)**

  Goal: `submit()` opens the preview only for the overwrite policy with ≥1 conflict; every other path is unchanged.

  Files:
  - `src/ui/import-modal.ts` — after `validateImport` succeeds: if `this.policy === "overwrite"`, `await buildOverwritePreview(this.app, folder, result.doc)`; if the result has at least one entry, `new ImportPreviewModal(this.app, diffs, () => void this.runAndReport(folder, result.doc, this.policy)).open()` and `return` — `ImportModal` itself stays open underneath (see ADR-0011 Decision/Alternative 4; do not call `this.close()` before opening the preview). Otherwise (policy is skip/duplicate, or overwrite with zero conflicts), fall through to the same `runAndReport`. Extract today's post-validation tail (`runImport` → `close()` → `Notice(...)` → `console.warn` on failures) verbatim into a new private `runAndReport(folder: string, doc: ExportDoc, policy: ImportPolicy): Promise<void>`, called from both branches.

  Contract change: none observable in any tested function; `ImportModal`'s constructor and its two call-sites (`src/main.ts:89`, `src/ui/library-view.ts:61`) are untouched (confirmed by grep).

  Test: manual smoke, see Task 5 (this is the integration point all 4 SPEC.md §3 acceptance criteria run through).

- [ ] **Task 5 — Full-suite run + manual smoke checklist**

  Goal: confirm the full test suite is green and walk every acceptance criterion from `SPEC.md` §3 by hand, since this feature's UI/storage glue has no automated coverage by design (testing boundary above).

  Run: `npm run build && npm run lint && npm test` (must be clean; this also re-verifies Tasks 1-2 did not shift `buildExport`/`planImport`/`validateImport`'s existing test results).

  Manual smoke, against a scratch vault with at least one prompt already imported once:
  1. Re-export that prompt, hand-edit the JSON to bump `quality` and append 2 lines to `body`, import with policy = overwrite → preview shows the path with `quality: 3 → 5` and `body: changed (+2/-0)` → Confirm → note is overwritten → summary Notice reads "... 1 overwritten ...".
  2. Repeat step 1's setup, click Cancel on the preview instead → vault file is unchanged, no summary Notice appears, `ImportModal` is still open with the same fields filled in.
  3. Re-export unchanged and re-import the same JSON verbatim with policy = overwrite → preview labels the path "identical".
  4. Same conflicting JSON, policy = skip → no preview modal appears at all (existing skip behavior, unchanged).
  5. Same conflicting JSON, policy = duplicate → no preview modal appears at all (existing duplicate-with-suffix behavior, unchanged).
  6. JSON with only new (non-conflicting) paths, policy = overwrite → no preview modal appears (`buildOverwritePreview` returns `[]`), import proceeds directly as today.
  7. Quick look on both desktop and mobile (or mobile emulation) at the stacked-modal visual (Task 3's neutral consequence in ADR-0011) — no layout breakage, tap targets usable.

---

## Out of scope (per SPEC.md §5, unchanged by this plan)

Per-item accept/reject within an import, rendered inline diffs or a full patch view, three-way merge, any export-side change, any change to `schema_version` or the JSON wire shape.
