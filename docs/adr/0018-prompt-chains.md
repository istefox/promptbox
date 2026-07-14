# ADR-0018: Prompt chains as a vault note discriminated by a `chain` frontmatter field

| | |
|---|---|
| Status | Accepted |
| Date | 14 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `SPEC.md` (prompt-chains), `BRAINSTORM.md` (2026-07-14), `PROJECT.md` Phase 1.5, ADR-0001, ADR-0002, ADR-0004, ADR-0005, ADR-0007, ADR-0009, ADR-0010, ADR-0013, ADR-0015 |

## Context

A "chain" lets a user walk an ordered sequence of existing prompt notes through a guided
wizard: copy each step's compiled text, run it in an external AI, paste the answer back to feed
the next step. Promptbox never makes network calls (ADR-0003 holds across every tier), so a
chain can never execute automatically against an LLM; the orchestration is order plus a manual
data hand-off, the user still runs each prompt externally.

Three questions had to be settled before implementation, each surfaced in `BRAINSTORM.md`:

1. **Where a chain lives** (its persistence model) — the brainstorm's three alternatives A/B/C.
2. **How a chain is identified** — a structural discriminator that does not collide with the
   existing free-form `type` field.
3. **How `{{@previous}}` coexists with the permanently-reserved `@` namespace** (ADR-0005,
   FR-10) without adding a second global reserved name or duplicating `{{@clipboard}}`.

Binding background, not re-litigated: ADR-0001 (notes are the source of truth; the in-memory
index is disposable), ADR-0002 (native Obsidian UI, vanilla TypeScript, one `styles.css`, no
network). Load-bearing internal precedents: ADR-0004 (a silent-tolerant, omit-on-default
`Prompt` frontmatter field), ADR-0005 (the reserved `@` namespace and its isolated UI-layer
resolver), ADR-0007 (single-pass body assembly for transclusion), ADR-0009 (variable profiles
as a pure domain module), ADR-0010 (linter as pure per-render rules with one shared pass),
ADR-0015 (a vault `rename` listener migrating path-keyed state).

## Decision

A chain is a **normal vault note**, identified purely by the **presence** of a `chain`
frontmatter field (`chain: [path1, path2, ...]`, an ordered list of prompt-note paths). The
free-form `type` field is never repurposed as a marker. Computation lives in one pure domain
module; the two new UI surfaces (create/edit modal, execution wizard) are thin glue.

### `src/domain/prompt.ts` (modified — additive, ADR-0004 pattern)

`Prompt` gains `chain?: string[]`. `"chain"` joins `KNOWN_FIELDS`. Normalization distinguishes
**presence** from validity: the key being present (even as `[]`, a scalar, or a single entry)
yields a `string[]` (tolerantly cleaned per NFR-8), the key being absent yields `undefined`.
The chain discriminator is therefore `prompt.chain !== undefined`, orthogonal to `type`.

```ts
interface Prompt {
  // ...existing fields unchanged...
  chain?: string[]; // present => chain note (list tolerantly cleaned); absent => normal prompt
}
```

`chain` is **excluded from the JSON transfer allowlist**, exactly as `favorite` is (ADR-0004):
`toExportedPrompt`/`ExportedPrompt` and the import writer (`storage/transfer-io.ts`,
`storage/prompt-writer.ts` `OPTIONAL_FIELDS`) are untouched, `schema_version` stays 1. Rationale
in Consequences and Alternative D.

### `src/domain/chains.ts` (new, no Obsidian import, vitest-covered)

Mirrors the shape of `related.ts`/`variable-profiles.ts`. Pure functions:

```ts
export const MIN_CHAIN_STEPS = 2;

/** Tolerant read (NFR-8): non-list => []; non-string/empty entries dropped; order and
 *  duplicates preserved. Presence vs absence is decided by the caller (normalizePrompt). */
export function readChain(raw: unknown): string[];

/** Save-time guard the modal calls into; the only place the 2-step minimum is enforced. */
export function isSaveableChain(steps: string[]): boolean; // steps.length >= MIN_CHAIN_STEPS

/** Steps that do not resolve against the current path set (deleted / out-of-vault). */
export function chainOrphanSteps(steps: string[], knownPaths: ReadonlySet<string>): string[];

/** Rename rewrite: a NEW array with every oldPath entry replaced by newPath (all
 *  occurrences). Returns an equal-content array unchanged in value when nothing matched. */
export function renameChainSteps(steps: string[], oldPath: string, newPath: string): string[];

/** Wizard fill partition. `@previous` is a chain-scoped display alias for `@clipboard`:
 *  it is never routed to resolveContextVariables (no @previous resolver exists) nor to the
 *  user modal. Other `@`-names go to context resolution; bare names go to the fill modal. */
export interface StepVariablePartition {
  contextNames: string[];          // real @-names present, excluding @previous
  usesPrevious: boolean;           // @previous appears at least once
  userVariables: PromptVariable[]; // non-@ variables to fill
}
export function partitionStepVariables(body: string): StepVariablePartition;

/** Merges resolved values for assembleBody: context values, then { "@previous": clipboard }
 *  when usesPrevious, then user values. @previous carries the exact @clipboard value. */
export function buildStepValues(
  contextValues: Record<string, string>,
  clipboardValue: string,
  usesPrevious: boolean,
  userValues: Record<string, string>,
): Record<string, string>;
```

Every function returns a fresh value and reads no clock, clipboard, or workspace: the impurity
(clipboard read, `Notice`, file I/O) stays in the wizard, matching `usage.ts`'s split.

### `{{@previous}}` (the reserved-namespace question, settled)

`@previous` is **not** added to `RESOLVERS` in `context-variables.ts` and **not** added to any
reserved-name list. It is resolved only inside a wizard run, where `buildStepValues` maps it to
the value already read for `@clipboard`. `context-variables.ts`, `placeholders.ts`
(`isContextVariable` stays `name.startsWith("@")`), and ADR-0005's four resolved names are all
untouched. The wizard's fill UI labels the field "Previous step output" instead of "Clipboard";
that label is the only user-visible difference. No new parsing, no new global reserved name.

### `src/domain/lint.ts` (modified — rule L8, ADR-0010 shared-pass pattern)

`LintRuleId` gains `"L8"`. Orphan detection is library-wide (it needs the full path set), so it
is a new `findChainOrphanFindings(prompts): Map<string, LintFinding[]>` merged into `lintLibrary`
beside `findDuplicateTitleFindings`, not a single-prompt rule in `lintPrompt`. For each chain
note it calls `chainOrphanSteps` against the set of all prompt paths and emits one `warning`
finding listing the unresolved steps.

### UI glue (manual-smoke only, per project convention)

- **`src/ui/chain-modal.ts`** (new): create/edit on `Modal` + `Setting`. Steps added via a
  `FuzzySuggestModal` picker over existing prompts (same interaction as
  `placeholder-palette.ts`), reordered with up/down buttons, removed with a button. Save is
  blocked by `isSaveableChain` with an inline "A chain needs at least 2 steps". At exactly one
  remaining step it shows **"Convert to single prompt"**: it writes the remaining step's body as
  this note's body and strips `chain` via the official frontmatter API, never automatically.
  Writes go through `storage/prompt-writer.ts`'s existing path (ADR-0001, no hand-parsed YAML).
- **`src/ui/chain-wizard-modal.ts`** (new): an optional variable-profile picker (ADR-0009,
  applied once for the whole run), then one screen per step — "Step N of M" header, the compiled
  text (via `assembleBody` with `buildStepValues`), a Copy button, Back/Next (Finish on the
  last). An orphan step blocks with an explicit error offering "Skip this step" / "Cancel chain".
  Closing early discards all state (session-scoped, never persisted).
- **`src/ui/library-view.ts`** (modified): `renderItem` branches on `prompt.chain !== undefined`
  to show a "Chain · N steps" badge (or a "0/1 steps" state) instead of the body preview, and to
  route the card's primary action to the wizard — or, for a sub-2-step/orphaned chain, to
  `openChainModal` for editing instead of starting a wizard.
- **`src/main.ts`** (modified): a `new-chain` command and a `openChainModal` entry point; the
  existing `vault.on("rename", ...)` handler (which already calls `renameUsage`, ADR-0015) also
  rewrites every chain note's `chain` array via `renameChainSteps` and persists changed notes
  through the frontmatter API.

## Alternatives considered

**A — Ephemeral chain, no persistence (BRAINSTORM Alternative A).** Rejected. The user composes
a chain on the fly and it vanishes after one run. Cheapest to build, no new schema, but it gives
no reusable, nameable, or shareable chain — every run starts from scratch. The core value the
feature exists to deliver (a saved, repeatable multi-step flow) is exactly what this drops.

**B — Chain as a vault note (BRAINSTORM Alternative B) — ADOPTED.** A chain is a note whose
frontmatter carries the ordered step list. Chosen because it is the only option consistent with
ADR-0001's invariant that notes are the single source of truth, it is version-controlled and
vault-synced with the rest of the library for free, and it is the natural substrate for a future
"chains in curated packs" export (ADR-0013). The brainstorm's own trade-off analysis reached the
same preliminary pick for the same reason; validated here against implementation cost, the extra
schema/UI surface is in line with what every prior Phase 1.5 ADR already paid, and it is
contained to one pure module plus two thin modals. The brainstorm proposed the discriminator as
`type: chain`; that was **rejected during the SPEC interview** after checking `prompt.ts`, because
`type` is a free-form, user-editable classification field (default `"task"`) and overloading it
would make a user's own `type: chat` ambiguous and silently break their classification. The
discriminator is instead the mere **presence** of the `chain` field — a dedicated structural
signal that cannot collide with user content.

**C — Chain as a `data.json` record (BRAINSTORM Alternative C).** Rejected. Named chains stored
in plugin data, reusing the `variable-profiles.ts`/`usage.ts` storage pattern. Lighter to build
and no new note-parsing surface, but it breaks the "notes are the truth" pattern that governs
every content-bearing feature, and a chain would not travel with a vault sync/git or a curated
pack unless the user also syncs `data.json` separately. `data.json` is the right home for
per-machine telemetry and settings (ADR-0009, ADR-0015), not for shareable prompt content; a
chain is content. Choosing C would give the codebase two conflicting answers to "where does
content live."

**D — Include `chain` in the JSON transfer/pack export shape now.** Rejected for this release.
The SPEC notes chain is "additive to the export shape" with no `schema_version` bump, which
holds — but actively serializing it now ships a latent defect: export paths are folder-relative
and remapped on import, whereas `chain` stores raw vault paths, so importing a chain into a
differently-named folder or another vault yields orphan step references — the silently-broken
chain the brainstorm pre-mortem named the top risk. Correct chain export needs path-remapping
that belongs with the deferred "chains in curated packs" work (SPEC out-of-scope). For now
`chain` is treated exactly like `favorite` (ADR-0004): real content, excluded from transfer
until its transfer story is designed. This keeps `transfer.ts`, `transfer-io.ts`, and
`prompt-writer.ts` untouched and `schema_version` at 1, matching the SPEC's "additive, no bump"
posture (the trivially-additive case is no change at all).

**E — Add `@previous` as a real resolver in `context-variables.ts`.** Rejected. It would create
a fifth globally reserved `@`-name (ADR-0005, FR-10, "the whole `@` namespace is reserved"),
meaningful only inside a wizard yet resolvable everywhere, and it would emit a spurious "could
not resolve @previous" Notice on any normal copy of a prompt that happens to use it outside a
chain. Scoping the alias to `buildStepValues` keeps ADR-0005's namespace and the four resolved
names exactly as they are.

**F — Add `@previous` to the user variable-fill modal as an editable field.** Rejected.
`isContextVariable` already classifies any `@`-name as reserved, so it never reaches the modal;
more importantly the previous step's output is not a value the user should type, it is carried
automatically from the clipboard. Routing it to the modal would ask the user to paste manually
what the wizard already has.

## Consequences

**Positive.** The whole computational surface — tolerant read, save-time validation, orphan
detection, rename rewrite, wizard variable partition, and value assembly — is pure and
vitest-covered with no Obsidian mock, matching the project's "domain gets vitest, UI glue gets
manual smoke" convention and directly mirroring `related.ts`/`variable-profiles.ts`. The
discriminator (presence of `chain`) is unambiguous and leaves `type` fully user-owned. `@previous`
adds zero parsing and zero new global reserved names; `context-variables.ts` and `placeholders.ts`
are untouched. L8 rides the existing shared per-render lint pass (one path-keyed Map, no O(n²)),
so a broken chain is caught in the same badge/report machinery as every other rule. Rename
resilience reuses the exact `vault.on("rename")` listener that already migrates usage (ADR-0015),
so no new event wiring is introduced. No `data.json` growth, no `schema_version` bump, and plain
exports stay byte-identical to today.

**Negative and accepted.** A chain does not survive a JSON export/import round-trip in this
release (Alternative D): re-importing an exported library drops the `chain` field and the note
becomes an empty-body prompt, the same loss `favorite` already accepts. This is a deliberate
deferral, not corruption, and it is flagged as the top follow-up. A chain note's `chain` array
can still be broken by out-of-Obsidian moves/deletes (git, Finder) that fire no vault event; this
degrades gracefully — L8 flags it, and the wizard blocks the orphan step with Skip/Cancel rather
than copying broken text — the same self-healing posture ADR-0001/ADR-0015 already take. A
sub-2-step chain reachable only by hand-editing frontmatter is tolerated at parse time (NFR-8)
and surfaced as a "0/1 steps" badge that routes to editing, never to a wizard.

**Neutral.** A chain note lives in the same filterable/searchable list as prompts, with no
separate tab or view; it is a prompt whose card renders differently. The two new modals add a
maintenance surface, but both sit on the existing `Modal`/`Setting`/`FuzzySuggestModal`
primitives (ADR-0002) rather than a new UI pattern. Branching/conditional steps, chains in
curated packs, and physical-device mobile verification are out of scope (SPEC), and
`PROJECT.md`'s Phase 1.5 checkbox is orchestrator-owned bookkeeping outside this ADR and its plan.

## References

- `SPEC.md` (root, this feature) — scope, edge cases, Definition of Done.
- `BRAINSTORM.md` (2026-07-14) — Alternatives A/B/C, the pre-mortem risk list, and the
  `@previous`/rename/lint pre-resolutions carried into this ADR.
- ADR-0001 (`0001-storage-markdown-frontmatter.md`) — notes as source of truth; disposable index.
- ADR-0002 (`0002-ui-native-obsidian-components.md`) — native UI, vanilla TS, no network.
- ADR-0004 (`0004-favorites.md`) — silent-tolerant omit-on-default field; transfer exclusion.
- ADR-0005 (`0005-context-variables.md`) — the reserved `@` namespace and its resolver.
- ADR-0007 (`0007-vault-transclusion.md`) — `assembleBody` single-pass compilation.
- ADR-0009 (`0009-variable-profiles.md`) — variable profiles as a pure module, applied per run.
- ADR-0010 (`0010-prompt-linter.md`) — shared per-render lint pass, path-keyed Map.
- ADR-0013 (`0013-curated-packs.md`) — the future home for chain export.
- ADR-0015 (`0015-usage-recency-tracking.md`) — the `vault.on("rename")` migration precedent.
- Internal precedent drawn on directly: `src/domain/related.ts`, `src/domain/variable-profiles.ts`
  (pure-module shape), `src/domain/lint.ts` (`findDuplicateTitleFindings` library-wide pass),
  `src/ui/copy.ts` (`assembleBody` + `resolveContextVariables` flow), `src/main.ts`
  (`vault.on("rename")` listener, command registration, modal deps).
</content>
</invoke>
