# ADR-0013: Curated packs — additive pack header for export/import

| | |
|---|---|
| Status | Accepted |
| Date | 3 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `SPEC.md` (curated-packs, FR-20/FR-21), `docs/spec.md` FR-7, ADR-0001, ADR-0002, `docs/competitive-analysis.md` §6 N7 |

## Context

Phase 1.5 wants file-based sharing of a curated subset of a library (a "pack": a name, an optional description, and a set of prompts) without any network dependency, on top of the existing `schema_version: 1` JSON export/import (ADR-driven by `docs/spec.md` FR-7, implemented in `src/domain/transfer.ts` and `src/storage/transfer-io.ts`). Two functional blocks are in scope: FR-20 (pack export — a name/description modal, `pack: { name, description }` layered on the existing schema, unchanged plain export) and FR-21 (pack import — tolerant recognition of a `pack` key, a summary shown above the existing policy controls, unchanged execution/policies/summary).

Hard constraints from `SPEC.md`: `schema_version` stays `1`; the `pack` key is additive and optional; a malformed `pack` value never blocks import, it degrades to a warning and the file imports as plain (mirrors the NFR-8 tolerance idiom already used for note frontmatter in `src/domain/prompt.ts`); no note frontmatter is ever touched by a pack header; plain export/import flows (all-prompts export, command palette, whole-import conflict policy, end-of-run summary) are byte-for-byte unchanged; no network; pure pack parse/build logic lives in `src/domain/transfer.ts` and is vitest-covered, UI additions follow the existing modal patterns and are manually smoke-tested (this project's established convention: only `src/domain/*` has automated coverage — confirmed by grep, there is no test file for `src/storage/transfer-io.ts` or any `src/ui/*.ts` today).

A full call-site audit of every symbol this ADR touches (`validateImport`, `buildExport`, `ExportDoc`, `ValidationResult`, `exportWithDialog`, `exportToVaultFile`, `runImport`, `planImport`) was run across `src/` and `tests/` before committing to this design (see Consequences). No external dependency changes: `obsidian` is an unpinned-behavior-wise devDependency already used identically elsewhere in this codebase (`Modal`, `Setting`, `Notice`, `TFile`); this feature introduces no new package and no new Obsidian API surface, so the Context7 documentation check was skipped by design (nothing to look up that isn't already proven working in this exact codebase).

## Decision

Extend the transfer schema and its UI additively; touch as few existing signatures as possible; keep pack data document-level only, never per-note.

### Domain layer (`src/domain/transfer.ts`)

New type:

```ts
export interface PackHeader {
  name: string;
  description: string;
}
```

`ExportDoc` gains one optional field, nothing else changes on it:

```ts
export interface ExportDoc {
  schema_version: typeof SCHEMA_VERSION;
  exported_at: string;
  prompts: ExportedPrompt[];
  pack?: PackHeader;
}
```

`buildExport` is **not modified** (signature and behavior stay exactly as today — this is what keeps FR-20.3's "plain export flows unchanged" true by construction, not by convention). A new function composes it:

```ts
export function buildPackExport(
  prompts: Prompt[],
  getBody: (path: string) => string,
  folder: string,
  exportedAt: string,
  pack: PackHeader,
): ExportDoc // { ...buildExport(prompts, getBody, folder, exportedAt), pack }
```

A new pure, tolerant parser, mirroring the `warnings`-collection idiom already used in `normalizePrompt` (`src/domain/prompt.ts`, NFR-8):

```ts
export function parsePackHeader(raw: unknown): { pack: PackHeader | undefined; warning: string | null }
```

Rules (binding, remove all ambiguity for the coder):
- `raw === undefined || raw === null` → absent, no warning. This is the common case (a plain export file, or a pack file re-serialized by a tool that emits `null` for an unset optional key) and must never produce noise.
- `raw` is not a plain object (string, number, array, boolean) → malformed, one warning, `pack: undefined`. This is the acceptance-criteria case (`pack: "oops"`).
- `raw.name` missing, not a string, or empty/whitespace-only after `.trim()` → malformed, one warning, `pack: undefined`. A pack without a usable name cannot satisfy FR-21.2's display requirement, so it is not a "valid pack" for import purposes even though FR-20.2's export-time rule ("name required, non-empty") is a separate, symmetrical rule enforced client-side in the export modal.
- `raw.description` present but not a string → malformed (whole pack dropped, not field-partially-repaired — FR-21.1 says the *value* is ignored, not individually patched). Missing `description` defaults to `""`.
- Unknown extra keys inside `raw` → ignored, not a reason to warn (consistent with the codebase's general tolerance philosophy; no spec requirement to reject on this).
- Exactly one warning string per malformed pack (FR-21.1: "a warning line", singular).

`validateImport` changes internally, signature stays `validateImport(parsed: unknown): ValidationResult`. Pack parsing is evaluated only after the existing hard-validation checks pass (`errors.length === 0`), at the same point `exported_at` is already extracted, and it **never contributes to `errors`** — only to a new `warnings` array on the success branch:

```ts
export type ValidationResult =
  | { ok: true; doc: ExportDoc; warnings: string[] }
  | { ok: false; errors: string[] };
```

`warnings` lives on the result, not inside `doc`: `doc` mirrors exactly what is/would be written to the JSON file (schema-shaped data), `warnings` is metadata about the validation run (process-shaped data). This also means a future "soft, non-fatal" validation concern can reuse the same `warnings` channel instead of inventing a second one.

### Storage layer (`src/storage/transfer-io.ts`)

`exportWithDialog(app, doc)`, `exportToVaultFile(app, doc)`, and `runImport(app, folder, doc, policy)` **keep their exact existing signatures**. `runImport` needs zero changes at all: it already reads only `doc.prompts`, never a document-level key, so it satisfies FR-21.3 ("pack header never written into notes") automatically, with no new code.

The only change is internal: both export functions currently derive the file base name as `promptbox-export-${date}`. Factor that into one local helper used by both:

```ts
function baseExportName(doc: ExportDoc): string
// `promptbox-export-${date}` when doc.pack is absent (unchanged output for plain exports)
// `promptbox-export-${date}-${slugify(doc.pack.name)}` when doc.pack is present
```

reusing `slugify` from `src/domain/slug.ts` (already a sibling import of `resolveCollision` in this file). Date-then-slug ordering is deliberate: the existing `promptbox-export-${date}` prefix stays byte-identical for plain exports, and pack files still sort chronologically first. `resolveCollision` keeps wrapping the result in `exportToVaultFile` exactly as today; `exportWithDialog`'s `suggestedName` uses the same helper directly (the OS picker handles overwrite prompts itself, as today).

### UI layer

- New file `src/ui/pack-export-modal.ts` — `PackExportModal`, a `Modal` + `Setting` pair (mirrors the compactness of `VariableModal`/`ConfirmModal`): one required text field (`name`, trimmed, non-empty — FR-20.2), one optional textarea (`description`), Export/Cancel buttons. Narrow deps (per this project's established modal-deps pattern): the modal receives the prompt count (for its own copy, e.g. "Exporting N prompts") and a submit callback `onSubmit: (pack: PackHeader) => void`; it does not receive the plugin or the prompt list itself. Inline validation error (mirrors `ImportModal`'s `errorsEl` single-purpose error area) is shown only if Export is clicked with a blank name; no `Notice` toast for this — consistent with how this modal family surfaces validation today.
- `src/ui/library-view.ts` — one new button, "Export as pack…", placed between the existing "Export filtered" and "Import" buttons in `promptbox-library__buttons`. Its click handler computes the same `runQuery(...)` filtered set "Export filtered" already computes; if empty, shows the same `Notice("Promptbox: nothing to export.")` early and never opens the modal (no pointless data entry); otherwise opens `PackExportModal` whose `onSubmit` calls the new plugin method below.
- `src/main.ts` — new method `exportPromptsAsPack(prompts: Prompt[], pack: PackHeader): Promise<void>`, a sibling of the existing `exportPrompts`, calling `buildPackExport` instead of `buildExport` and then the unchanged `exportWithDialog`, with the same empty-check, success `Notice`, and error `Notice` shape as `exportPrompts`. `exportPrompts` itself is untouched (FR-20.3).
- `src/ui/import-modal.ts` — one new element, a pack-info panel, inserted after the "...or paste JSON" `Setting` and before the "On conflicts" `Setting` (FR-21.2's exact ordering: "above the existing policy controls"). A `refreshPreview()` method, called from both existing `onChange` handlers (file-suggest and paste-textarea) via the same fire-and-forget pattern already used for `submit()` (`void this.refreshPreview()`), reuses the same "pasted wins over file" precedence `readSource()` already implements, attempts `JSON.parse` + `validateImport` inside a `try/catch` that silently clears the panel on parse failure (no premature error noise mid-paste — hard failures stay exclusively a submit-time concern via the existing `showErrors`), and then: shows "`<name>` — `<description>` — N prompts" when `result.ok && result.doc.pack`, shows the single warning line when `result.ok && result.warnings.length > 0`, or clears the panel otherwise. A short debounce (rule of thumb ~150–200 ms, exact value left to implementation) on the textarea path is recommended so large pasted files do not re-validate on every keystroke — this project already has a "debounced search" precedent (ADR-0002). `submit()` itself is unchanged: it still calls `validateImport`, `showErrors` on `ok:false`, and `runImport(..., result.doc, ...)` on success; `result.doc.pack` simply rides along and `runImport` ignores it.
- `styles.css` — small additions only: a modifier/class for the new pack-info panel (mirrors the existing `.promptbox-import__errors` BEM pattern) and, if needed, spacing for the third library-view button. No new visual system, reuses Obsidian CSS variables per ADR-0002.

### Call-site audit (observable-contract staleness check)

Grep across `src/` and `tests/` for every touched symbol before writing this ADR:

- `validateImport`: 9 call-sites in `tests/transfer.test.ts` (all read only `.ok`/`.doc`/`.errors`, unaffected by the additive `.warnings` field) and 1 in `src/ui/import-modal.ts:95` (the file this plan updates anyway).
- `buildExport`: 3 call-sites in `tests/transfer.test.ts` and 1 in `src/main.ts:134` (the plain-export flow, explicitly required unchanged by FR-20.3 — this ADR does not touch that call site).
- `ExportDoc`: used as a type annotation only (`tests/transfer.test.ts`, `src/storage/transfer-io.ts` ×3, `src/domain/transfer.ts` ×3); an additive optional field is structurally compatible everywhere, nothing currently reads `.pack`.
- `exportWithDialog`/`exportToVaultFile`: 1 call site (`src/main.ts:141`, unchanged signature and call shape); this plan adds one new call site from `exportPromptsAsPack`, reusing the same functions unmodified.
- `runImport`: 1 call site (`src/ui/import-modal.ts:100`), left untouched by this plan.
- `planImport`, `ImportAction`, `ExportedPrompt`, `ImportSummary`: no changes proposed, no new call sites.

Conclusion: no call-site needs updating beyond the files already in this plan's scope (`src/ui/import-modal.ts`). This is stated explicitly rather than assumed; Task 5 of the implementation plan re-runs the full test suite as the enforcement mechanism for this claim, not just the new/changed module's tests.

## Alternatives considered

1. **Add a 5th, optional `pack?` parameter directly to `buildExport`**, instead of a separate `buildPackExport` composing it. Rejected: widens a stable, fully-tested (3 existing unit tests) function's signature for a feature most callers (`src/main.ts`'s plain-export path, FR-20.3) will never use; every future reader of `buildExport` would have to reason about an unused parameter. A thin wrapper produces byte-identical output with zero risk to the existing tests or the plain-export call site.
2. **Treat a malformed `pack` value as a hard validation failure** (push it into `errors`, block the whole import until the user removes/fixes the key). Rejected: directly contradicts FR-21.1 ("ignored with a warning... imports as plain") and the codebase's established NFR-8 tolerance idiom (`Prompt.warnings` in `src/domain/prompt.ts`); would also block legitimate plain-export files that happen to carry a stray or hand-edited `pack` key for no good reason.
3. **Expose pack extraction as a separate function the UI calls independently of `validateImport`** (e.g. `extractPack(parsed)` called on its own for the live preview, with `validateImport` staying byte-for-byte as it is today). Rejected: forces `import-modal.ts` to run two different parses of "is this JSON a valid import document" that could silently drift apart on what counts as a valid root; folding pack parsing into the single `validateImport` call (already the only call site in `import-modal.ts`) keeps one source of truth for "this file is importable" and matches the file's existing single-validation-call pattern.
4. **Thread the pack name into `exportWithDialog`/`exportToVaultFile` as a new explicit parameter** instead of deriving the file base name from `doc.pack` inside those functions. Rejected: widens two function signatures for a value that already lives on the `doc` argument they receive; deriving it internally keeps `src/main.ts`'s call shape for both `exportPrompts` and the new `exportPromptsAsPack` identical (`exportWithDialog(this.app, doc)`), and avoids a parameter that is `undefined` in the overwhelming majority (plain-export) case.
5. **Redesign `ImportModal` as a two-screen wizard** (pick source → confirm screen showing pack info and policy) instead of a live-updating info panel bolted onto the existing single-screen modal. Rejected: FR-21.3 explicitly requires "import execution, conflict policies, and the end-of-run summary are unchanged"; a wizard restructure is disproportionate to an "effort S" feature, would touch a working, previously-shipped modal's overall structure end to end, and is exactly the kind of change the observable-contract-staleness concern warns about for no functional gain — a panel inserted at one fixed point in the existing DOM order satisfies FR-21.2 with a minimal, localized diff and zero change to `submit()`'s control flow.

## Consequences

**Positive:**
- FR-20/FR-21 are satisfied with `buildExport`, `runImport`, `planImport`, and every plain-export/import code path left byte-for-byte unchanged in both signature and behavior — the call-site audit above shows nothing outside this feature's own new/touched files can regress.
- The tolerance rule for a malformed `pack` reuses an idiom this codebase already trusts (`Prompt.warnings`), so reviewers and future contributors do not need to learn a second "how do we degrade gracefully" convention.
- `ExportDoc.pack` and `ValidationResult.warnings` are both small, additive, structurally-optional changes — TypeScript's structural typing means no existing consumer needs to change to keep compiling, which is exactly why the 9 pre-existing `validateImport`/`buildExport` tests need no modification.
- The pack header shape (`name`, `description`, a bounded prompt list) is deliberately the simplest possible "named collection of prompts" — it prototypes the catalog-entry shape Tier 8 will eventually need (per `docs/competitive-analysis.md` §6 N7's own rationale) without committing to anything Tier 8-specific (no versioning, no registry, no author field) that would be premature now.

**Negative and accepted:**
- `src/storage/transfer-io.ts` and every touched `src/ui/*.ts` file remain outside automated test coverage after this change, same as before it — this plan does not introduce Obsidian `App`/vault mocking infrastructure to close that gap, matching this project's own established, deliberate domain-only coverage boundary. Verification for those layers is manual smoke only.
- The import-modal live preview re-runs `JSON.parse` + `validateImport` on every source-selection change (and, without a debounce, potentially per keystroke while pasting); this is computationally cheap at the ~1,000-prompt NFR-1 ceiling but is still extra work on a path that previously did none until submit — mitigated by the recommended short debounce, not eliminated.
- `ValidationResult`'s success branch gains a field (`warnings`) that most call sites will not read; call sites that construct a `ValidationResult`-shaped literal by hand anywhere in the future must remember to include it (TypeScript will enforce this at the construction site, so the risk is compile-time-caught, not silent).

**Neutral:**
- The pack concept stays file-header-only: no registry, no versioning, no pack-scoped conflict policy, no note-frontmatter change — all explicitly out of scope per `SPEC.md` §5. This shapes, but does not bind, whatever Tier 8's eventual catalog-entry design turns out to be.
- `warnings` on `ValidationResult` is, for now, populated only by pack parsing; it is designed as a general "non-fatal but worth surfacing" channel, so the next feature that needs one should extend this array rather than add a second one.
- The exact debounce value for the import-modal live preview, and the exact button ordering/spacing in the library view, are left to implementation discretion as non-load-bearing details; nothing in this ADR depends on a specific number here.

## References

- `SPEC.md` (repo root, curated-packs addendum) — FR-20, FR-21, acceptance criteria, §4/§5 constraints and out-of-scope list.
- `docs/spec.md` — FR-7 (base `schema_version: 1` export/import contract this ADR extends), NFR-8 (tolerance idiom reused here).
- `docs/adr/0001-storage-markdown-frontmatter.md` — notes as single source of truth; binding constraint that this feature never writes a pack header into note frontmatter.
- `docs/adr/0002-ui-native-obsidian-components.md` — `Modal`/`Setting` UI pattern this ADR's new modal and panel follow.
- `docs/competitive-analysis.md` §6 N7 — feature rationale and the Tier 8 catalog-entry-shape connection.
- `docs/project.md` — Phase 1.5 listing, Tier 8 dependency context.
- `src/domain/transfer.ts`, `src/storage/transfer-io.ts`, `src/ui/import-modal.ts`, `src/ui/library-view.ts`, `src/main.ts`, `src/domain/slug.ts`, `src/domain/prompt.ts` — existing source read and extended by this decision.
- `tests/transfer.test.ts` — existing coverage this ADR's call-site audit is based on and extends.
