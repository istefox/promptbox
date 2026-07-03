# Implementation plan: curated packs export/import

| | |
|---|---|
| Date | 3 Jul 2026 |
| Source | `SPEC.md` (curated-packs, FR-20/FR-21) |
| ADR | `docs/adr/0013-curated-packs.md` |
| Test command | `npm run build && npm run lint && npm test` (`.claude/test-cmd`, authoritative, unchanged) |

TDD order: domain first (write failing tests, then implement), then storage naming, then the two UI surfaces (export, import), then a full regression gate. Each task is independently reviewable and ordered by dependency — later tasks call functions the earlier tasks introduce.

---

## Task 1: Domain — pack header type, tolerant parse, pack-aware build (TDD)

- [ ] Write the failing test cases below in `tests/transfer.test.ts` first; confirm they fail against the current `src/domain/transfer.ts`; then implement `src/domain/transfer.ts` until they pass, without changing `buildExport`'s existing behavior or signature.

**Goal:** introduce `PackHeader`, `buildPackExport`, `parsePackHeader`, extend `ExportDoc` with an optional `pack` field, and extend `ValidationResult`'s success branch with a `warnings: string[]` field, per the contracts pinned in ADR-0013's Decision section (Domain layer). `buildExport`, `planImport`, `ExportedPrompt`, `ImportAction` stay untouched.

**Files:**
- `src/domain/transfer.ts` (modify: add `PackHeader`, `buildPackExport`, `parsePackHeader`; extend `ExportDoc` and `ValidationResult`; wire pack parsing into `validateImport` after existing hard-validation checks pass, contributing only to `warnings`, never to `errors`)
- `tests/transfer.test.ts` (modify: new `describe` blocks, see below)

**Test (new `describe` blocks in `tests/transfer.test.ts`):**
- `buildPackExport` — attaches the given `PackHeader` as `doc.pack`; `doc.prompts` is identical to what `buildExport` produces for the same inputs (explicit parity assertion against a `buildExport(...)` call with the same arguments).
- `parsePackHeader` — table-driven:
  - `undefined` and `null` → `{ pack: undefined, warning: null }` (both treated as "absent", no noise).
  - well-formed `{ name: "Code Review Kit", description: "..." }` → `pack` populated verbatim, `warning: null`.
  - well-formed with `description` omitted → `pack.description === ""`.
  - malformed root type, e.g. `"oops"` (the acceptance-criteria example) → `pack: undefined`, exactly one non-null `warning`.
  - malformed: `{}`, `{ name: "" }`, `{ name: "   " }`, `{ name: 42 }` → all warned, `pack: undefined`.
  - malformed: `{ name: "ok", description: 42 }` → warned, `pack: undefined` (whole value dropped, not partially repaired).
  - extra unknown keys alongside a valid `name`/`description` → no warning, pack still parsed.
- `validateImport` with pack —
  - a doc without a `pack` key → `ok: true`, `warnings: []`, `doc.pack === undefined` (explicit regression guard: today's plain-import behavior is unchanged).
  - a doc with a well-formed `pack` → `ok: true`, `doc.pack` populated, `warnings: []`, `doc.prompts.length` usable as the FR-21.2 count.
  - a doc with `pack: "oops"` → `ok: true` (import still proceeds), `doc.pack === undefined`, `warnings.length === 1` (this is the literal acceptance criterion "Importing a file with `pack: "oops"`... warns and imports as plain").
  - re-assert 1-2 of the pre-existing hard-failure cases (bad `schema_version`, non-array `prompts`) still yield `ok: false` unchanged, to close the loop on the `ValidationResult` type change.
- Round trip with pack (extends the existing FR-7.4 round-trip test) — `buildPackExport` → `JSON.stringify`/`JSON.parse` → `validateImport` → `doc.pack` deep-equals the original `PackHeader`; `doc.prompts` still equals the original prompts array element-for-element; no `prompts[i]` entry carries a `pack` key (data-shape half of "pack header never written into notes", complementing the UI-level check in Task 4).

---

## Task 2: Storage — pack-aware export file naming

- [ ] Factor the existing `promptbox-export-${date}` base-name computation in `src/storage/transfer-io.ts` into one shared helper and extend it to append `-${slugify(doc.pack.name)}` when `doc.pack` is present.

**Goal:** satisfy FR-20.2 ("file naming follows the existing export naming with the pack slug") without changing `exportWithDialog`'s or `exportToVaultFile`'s exported signatures or their plain-export output (no `doc.pack` → identical filename to today).

**Files:**
- `src/storage/transfer-io.ts` (modify: add a local `baseExportName(doc)` helper reused by `exportWithDialog`'s `suggestedName` and `exportToVaultFile`'s `base`; import `slugify` alongside the existing `resolveCollision` import from `../domain/slug`)

**Test:** no automated test (this file has no existing dedicated test file, consistent with this project's domain-only vitest coverage convention, reconfirmed in ADR-0013). Manual smoke, folded into Task 3's smoke pass: export a pack named "Code Review Kit" and confirm the produced/suggested filename contains `code-review-kit` and the existing date segment, in that order; export a plain (non-pack) set and confirm the filename is byte-identical to pre-change behavior.

---

## Task 3: Export UI — "Export as pack…" modal and wiring

- [ ] Add `PackExportModal`, a third library-view button, and a plugin method that builds and exports a pack document.

**Goal:** discharge FR-20.1/FR-20.2 end to end: a small modal collects a required non-empty `name` and optional `description`, then exports the current filtered set as a pack document via the existing `exportWithDialog` path. FR-20.3 (plain export flows unchanged) is preserved by leaving `exportPrompts` and its call sites untouched.

**Files:**
- `src/ui/pack-export-modal.ts` (new: `PackExportModal` — `Modal` + `Setting`, narrow deps: prompt count for its own copy plus an `onSubmit(pack: PackHeader)` callback; inline error only if Export is clicked with a blank name)
- `src/ui/library-view.ts` (modify: new "Export as pack…" button between "Export filtered" and "Import"; click handler reuses the same `runQuery(...)` filtered-set computation as "Export filtered", early-`Notice`-returns on an empty set exactly like `exportPrompts` does, otherwise opens `PackExportModal`)
- `src/main.ts` (modify: new `exportPromptsAsPack(prompts: Prompt[], pack: PackHeader): Promise<void>` sibling to `exportPrompts`, using `buildPackExport` + the unchanged `exportWithDialog`, same empty-check/success/error `Notice` shape)
- `styles.css` (modify: minor — spacing for the third button if needed; no new visual system)

**Test:** manual smoke (UI glue, per this project's convention) — filter the library to 4 prompts, click "Export as pack…", name it "Code Review Kit", confirm: the exported JSON has `pack.name === "Code Review Kit"` and exactly 4 `prompts` entries; separately trigger the plain "Export filtered" button and the "Export prompts (JSON)" command palette action and confirm their output shape is unchanged (no `pack` key) — this is the acceptance criterion "existing export command output is unchanged in shape."

---

## Task 4: Import UI — pack-aware preview panel

- [ ] Add a live-updating pack summary/warning panel to `ImportModal`, positioned above the existing "On conflicts" policy control; leave `submit()`'s validation/execution flow otherwise unchanged.

**Goal:** discharge FR-21.2 (pack name/description/count shown above policy controls when a valid pack is present) and the FR-21.1 warning-line requirement, while FR-21.3 (execution, policies, summary, round-trip) stays intact because `runImport` is never touched and never reads `doc.pack`.

**Files:**
- `src/ui/import-modal.ts` (modify: new pack-info panel element inserted between the "...or paste JSON" and "On conflicts" `Setting` rows; a `refreshPreview()` method wired to both existing `onChange` handlers via the same fire-and-forget pattern already used for `submit()`, reusing `readSource()`'s existing "pasted wins over file" precedence, wrapped in `try/catch` so a parse failure mid-edit silently clears the panel instead of surfacing an error; recommend a short debounce, ballpark 150–200 ms, on the textarea path)
- `styles.css` (modify: minor — a class for the new panel, mirroring the existing `.promptbox-import__errors` pattern)

**Test:** manual smoke — import the pack file produced in Task 3 and confirm "Code Review Kit — 4 prompts" plus its description renders above the conflict-policy dropdown before clicking Import, and that the import then behaves exactly like a plain import (same summary notice shape); hand-edit a copy of that file to set `"pack": "oops"` and confirm the warning line appears and the import still completes as a plain import when confirmed (the acceptance criterion "Importing a file with `pack: "oops"` ... warns and imports as plain"); re-export the imported notes and confirm round-trip equivalence per FR-7.4, and confirm no note's frontmatter or body contains a `pack` key anywhere (the acceptance criterion "pack header not written into any note" — the UI-level half of the check whose data-shape half is covered in Task 1).

---

## Task 5: Full regression gate

- [ ] Re-confirm the call-site audit from ADR-0013 (a quick re-grep for `validateImport`, `buildExport`, `ExportDoc`, `ValidationResult`, `exportWithDialog`, `exportToVaultFile`, `runImport`, `planImport` across `src/` and `tests/`) and run the full authoritative test command, not just the touched module's tests.

**Goal:** enforce, rather than merely assert, that this feature's additive changes have not broken any unrelated suite or call site — the Quality Standards concern behind touching a shared, well-tested type (`ExportDoc`, `ValidationResult`).

**Files:** none (verification-only task; no source changes).

**Test:**
- `npm run build && npm run lint && npm test` green in full (all 9 existing test files — `draft`, `indexer`, `perf`, `placeholders`, `prompt`, `query`, `slug`, `transfer`, plus the new pack cases in `transfer` — not just `tests/transfer.test.ts`).
- Manual smoke of the pre-existing plain-export/import round trip (spec.md US-6) once more end to end, to guard FR-20.3/FR-7 non-regression after all four preceding tasks have landed.
- Mobile verification is deliberately deferred to Tier 6 hardening (per `docs/project.md`, mobile QA is already scoped there and excluded from nightly/autopilot runs); this task's manual smoke is desktop-only, consistent with how the other completed Phase 1.5 features in `PROJECT.md` have been verified.

---

## Out of scope (per `SPEC.md` §5)

Pack registry/catalog (Tier 8), multi-pack files, pack versioning, pack-scoped conflict policies, any note frontmatter change. None of the five tasks above should grow into any of these.
