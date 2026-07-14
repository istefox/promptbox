# Plan: Prompt chains (ADR-0018)

Source: `SPEC.md` (root, prompt-chains). Design: `docs/adr/0018-prompt-chains.md` (chain as a
vault note discriminated by the presence of a `chain` frontmatter field; one pure
`src/domain/chains.ts`, two thin modals, a library-view branch, and a rename-listener extension).

Full authoritative test command (run after every task, not just the task's own files):
`npm run build && npm run lint && npm test`.

## Observable-contract changes (grepped up front, so no call-site is discovered by the coder)

1. **`Prompt` gains `chain?: string[]`; `KNOWN_FIELDS` gains `"chain"`.** A `chain` frontmatter
   key previously landed in `prompt.custom`; it now normalizes into `prompt.chain`.
   - Grep `tests/prompt.test.ts` "passes unknown ... through custom" (line ~101): fixture uses
     `community_id`/`promptbox_origin`/`stray`, **not** `chain` — unaffected.
   - Grep `\bchain\b` across `src/` and `tests/`: no existing references. No consumer reads
     `prompt.chain` or a `chain` custom key today.
2. **`LintRuleId` union gains `"L8"`.** Grep `LintRuleId` / `ruleId` across `src/`: the only
   consumer is `src/ui/lint-modal.ts:56`, which string-interpolates `finding.ruleId` — no
   exhaustive `switch`, so the additive union member breaks nothing.
3. **Transfer/export shape: no change.** Per ADR-0018 Alternative D, `chain` is excluded from the
   transfer allowlist (parity with `favorite`). `src/domain/transfer.ts`, `src/storage/transfer-io.ts`,
   `src/storage/prompt-writer.ts` `OPTIONAL_FIELDS`, and `schema_version` are all untouched; plain
   exports stay byte-identical. Confirm in Task 8 by grepping the transfer layer for `chain`.
4. **New command id `new-chain`; new library-view card branch for `prompt.chain !== undefined`.**
   Additive. Normal-prompt cards must render and act exactly as before (regression check, Task 8).

Because change (1) alters how `normalizePrompt` classifies one key, run the **full** vitest suite
(not just `chains`/`prompt` tests) after Tasks 1 and 2: a normalization change can surface in
`indexer`, `transfer`, `search`, or `stats` fixtures that share the `Prompt` shape.

## Task 1 — Pure core: `src/domain/chains.ts` (TDD)

Goal: the tolerant read, the save-time guard, orphan detection, rename rewrite, and the wizard
variable partition/assembly, exactly per ADR-0018's Decision section. Tests first, failing against
a stub, then green.

Files:
- `tests/chains.test.ts` (new) — mirror `tests/related.test.ts` / `tests/usage.test.ts` style
  (plain fixtures, `describe` per function). No Obsidian import.
- `src/domain/chains.ts` (new) — exports `MIN_CHAIN_STEPS`, `readChain`, `isSaveableChain`,
  `chainOrphanSteps`, `renameChainSteps`, `StepVariablePartition`, `partitionStepVariables`,
  `buildStepValues`, exact shapes per the ADR. No Obsidian import. Reuses `parsePlaceholders` and
  `isContextVariable` from `src/domain/placeholders.ts` (do not reimplement placeholder parsing).

Test cases (vitest):
- `readChain` (NFR-8 tolerance):
  - A well-formed `["a.md","b.md"]` → same order, same values.
  - Duplicates preserved: `["a.md","a.md"]` → `["a.md","a.md"]` (no dedupe; SPEC allows repeats).
  - `[]` → `[]`; a single-entry `["a.md"]` → `["a.md"]` (tolerated at read time; the 2-step
    minimum is a save-time guard only).
  - Non-list scalar (`"a.md"`, `42`, `null`, `undefined`, `{}`) → `[]` (never throws).
  - Mixed array with non-string / empty-string entries → those dropped, order otherwise kept.
- `isSaveableChain`: `false` for length 0 and 1, `true` for length 2 and 3 (incl. a 2-entry
  all-duplicate `["a.md","a.md"]` → `true`).
- `chainOrphanSteps`: returns exactly the entries absent from `knownPaths`, order preserved,
  duplicates reported per occurrence; empty when all resolve; every entry when none resolve.
- `renameChainSteps`:
  - Replaces every occurrence of `oldPath` with `newPath` (a path appearing twice → both rewritten).
  - No occurrence → an array equal in content to the input (assert value equality).
  - Does not touch non-matching entries; preserves order and length.
- `partitionStepVariables`:
  - Body with `{{@date}} {{name}} {{@previous}}` → `contextNames: ["@date"]`, `usesPrevious: true`,
    `userVariables` containing `name` only (`@previous` never appears in `contextNames` or
    `userVariables`).
  - Body with no `@previous` → `usesPrevious: false`.
  - `@previous` appearing multiple times still yields `usesPrevious: true` and is de-duplicated out
    of both other buckets.
  - A body whose only variable is `@previous` → `contextNames: []`, `usesPrevious: true`,
    `userVariables: []`.
- `buildStepValues`:
  - `usesPrevious: true` → output has `"@previous"` equal to the passed `clipboardValue`, **the same
    value `@clipboard` would carry** (assert `out["@previous"] === clipboardValue`). This is the
    DoD's "`{{@previous}}` resolves to the same value as `{{@clipboard}}`" check.
  - `usesPrevious: false` → no `"@previous"` key in the output.
  - Context values and user values are both merged in; user values win over a colliding context key
    (documents precedence; keep consistent with `copy.ts`'s `{ ...contextValues, ...userValues }`).

Run: `npm test` while iterating; the full command before moving on.

## Task 2 — `Prompt.chain` field + tolerant normalization (TDD)

Goal: `normalizePrompt` reads the `chain` key into `prompt.chain`, distinguishing presence from
absence, without disturbing any other field.

Files:
- `tests/prompt.test.ts` (modify — add a `describe("chain (ADR-0018)")` block):
  - Key **absent** → `prompt.chain === undefined`.
  - Key present as `["a.md","b.md"]` → `prompt.chain` deep-equals `["a.md","b.md"]`; `custom` has no
    `chain` key.
  - Key present as `[]` → `prompt.chain` deep-equals `[]` (present, empty), **not** `undefined`
    (this is the "0 steps" discriminator the library view relies on).
  - Key present as a scalar (`chain: "a.md"`) → `prompt.chain` deep-equals `[]` (tolerated), no
    warning added beyond the baseline (silent-tolerant like `favorite`).
  - Re-assert the existing "passes unknown ... through custom" test still passes unchanged.
- `src/domain/prompt.ts` (modify):
  - `Prompt` interface: add `chain?: string[];`.
  - `KNOWN_FIELDS`: add `"chain"`.
  - In `normalizePrompt`, set `chain: "chain" in raw ? readChain(raw["chain"]) : undefined` (import
    `readChain` from `./chains`). Presence is decided by the key being present in `raw`; validity is
    `readChain`'s tolerant job. Silent, no warning push (ADR-0004 `readFavorite` precedent).

Run the **full** authoritative command after this task: it changes how one frontmatter key
normalizes across the whole `Prompt` pipeline.

## Task 3 — Lint rule L8 (orphan chain steps) (TDD)

Goal: a chain with one or more unresolvable steps produces exactly one L8 `warning`; a
fully-resolvable chain stays silent; non-chain notes are never considered.

Files:
- `tests/lint.test.ts` (modify — add an L8 block):
  - A chain prompt whose `chain` includes a path not in the library → one finding, `ruleId "L8"`,
    `severity "warning"`, message naming the orphan path(s).
  - A chain whose every step resolves → no L8 finding.
  - A non-chain prompt (`chain === undefined`) → never an L8 finding, whatever its body.
  - `lintLibrary` merges L8 alongside L6 duplicate findings for the same path without dropping
    either (both appear in `findings`).
- `src/domain/lint.ts` (modify):
  - `LintRuleId` union: add `"L8"`.
  - Add `findChainOrphanFindings(prompts: Prompt[]): Map<string, LintFinding[]>` — builds the set of
    all `prompt.path`, then for each prompt with `prompt.chain !== undefined` calls
    `chainOrphanSteps(prompt.chain, knownPaths)`; if non-empty, one L8 finding listing the orphans.
    Mirror `findDuplicateTitleFindings`'s shape and library-wide-pass placement.
  - `lintLibrary`: merge `findChainOrphanFindings` into each result the same way `duplicates` is
    merged (`...(orphans.get(prompt.path) ?? [])`).

## Task 4 — Create/edit modal: `src/ui/chain-modal.ts` (glue, manual smoke)

Goal: build/reorder/remove steps, enforce the 2-step minimum at save, and offer "Convert to single
prompt" at exactly one step. No vitest (UI glue, manual-smoke by convention).

Files:
- `src/ui/chain-modal.ts` (new) — `ChainModal extends Modal`, on `Modal` + `Setting`. State: an
  ordered `steps: string[]` field and a `title`. A private `display()` rebuild renders one `Setting`
  row per step (title resolved from the index, up/down/remove buttons), an "Add step" button opening
  a `FuzzySuggestModal` over `deps.allPrompts` (append in pick order; same interaction as
  `placeholder-palette.ts`), and a footer. Footer logic:
  - `steps.length >= 2` → "Save" enabled; on click, write the note (`chain: steps`, empty body) via
    the `storage/prompt-writer.ts` path (official frontmatter API, ADR-0001), or in edit mode update
    the existing note's `chain` field.
  - `steps.length < 2` → "Save" blocked with an inline error "A chain needs at least 2 steps".
  - `steps.length === 1` → also show **"Convert to single prompt"**: read the remaining step's body
    (`deps.getBody(path)`), write it as this note's body, and remove the `chain` field via
    `processFrontMatter` (delete key). Never automatic.
  - Reorder/remove mutate `steps` and call `display()` (per-render rebuild; no cursor-in-textarea
    concern here, so `display()` is fine — mirrors `variable-modal.ts`).
- `src/main.ts` (modify): add `openChainModal(path?: string)` building the same narrow deps object
  `modalDeps()` already assembles (needs `allPrompts`, `getBody`, `folder`, `persist`); add a
  `new-chain` command (`callback: () => this.openChainModal()`), placed beside `new-prompt`.

Manual smoke:
- New chain: add three steps via the picker, reorder with up/down, remove one → order tracks the UI.
- With 0 or 1 step, "Save" is blocked with the inline error; with 2+, it saves a note with
  `chain: [...]` frontmatter and an empty body (inspect the file).
- Edit a saved chain down to 1 step → "Save" blocked, "Convert to single prompt" appears; clicking it
  produces a note with the remaining step's body as content and **no** `chain` field.

## Task 5 — Wizard modal: `src/ui/chain-wizard-modal.ts` (glue, manual smoke)

Goal: the guided run — optional profile, one compiled screen per step, Copy, Back/Next/Finish,
orphan blocking. No vitest.

Files:
- `src/ui/chain-wizard-modal.ts` (new) — `ChainWizardModal extends Modal`. State: `index` (current
  step), a chosen `profileValues` (or none), and the per-step user values already collected.
  - `onOpen()`: if any profile matches, show the profile picker (reuse `matchingProfiles`/
    `applyProfile` from `variable-profiles.ts`, ADR-0009) as an optional first screen; "Skip" is
    allowed. Then render step 0.
  - Per-step render: resolve the step path against the index; if unresolved, show the orphan error
    with "Skip this step" / "Cancel chain" (never copy empty/broken text). Otherwise compute
    `partitionStepVariables(body)`; resolve real context names via `resolveContextVariables`
    (`ui/context-variables.ts`) and read the clipboard once for `@previous` when `usesPrevious`;
    collect any `userVariables` (reusing a `VariableModal`-style inline form or the existing modal,
    seeded from `profileValues`); then `assembleBody(body, resolvedLinks, buildStepValues(...))`.
    Show a "Step N of M" header, the compiled text, a **Copy** button (`writeClipboard`), and
    Back/Next — Next becomes **Finish** on the last step and closes the wizard.
  - `@previous` field label is "Previous step output", not "Clipboard" (the only user-visible
    difference; ADR-0018).
  - Closing early (Escape / click outside) discards all state; reopening restarts at step 1.
- `src/ui/library-view.ts` (modify, see Task 6) routes the chain card's primary action here.

Manual smoke (dev vault):
- Build a 3-step chain where step 2's body uses `{{@previous}}` and a per-step `{{name}}`, step 3
  uses a profile variable. Run it: pick a profile at the start; per step, click Copy, paste into a
  scratch note, copy that note's text, click Next; confirm step 2 shows the pasted text where
  `{{@previous}}` sits and its field is labelled "Previous step output"; confirm the profile value is
  applied at step 3 without re-prompting; Finish closes with no persisted record.
- Delete a step's source note, reopen the wizard, reach that step → the orphan error with
  Skip/Cancel appears; Skip advances, Cancel closes; no empty text is ever copied.

## Task 6 — Library-view integration (glue, manual smoke)

Goal: chain cards render a step-count badge and route their primary action correctly, with zero
change to normal-prompt cards.

Files:
- `src/ui/library-view.ts` (modify) — in `renderItem`, branch on `prompt.chain !== undefined`:
  - Replace the body-preview line with a "Chain · N steps" badge (N = `prompt.chain.length`); for
    `length < 2` render a "0/1 steps" state.
  - Route the primary action: a 2-step-or-more chain opens `ChainWizardModal`; a sub-2-step or
    fully-orphaned chain opens `ChainModal` for editing instead (never a wizard). Replace the normal
    "Copy with variables" / "Copy raw" card actions with a single "Run chain" (or "Edit chain")
    action for chain cards; keep Edit/Open-as-note/Delete.
  - Normal prompts (`prompt.chain === undefined`) take the existing path unchanged.
- `styles.css` (modify) — a `.promptbox-item__chain-badge` rule using Obsidian CSS variables
  (mirror the existing `.promptbox-pill--*` conventions; no new color literals).

Manual smoke:
- A saved chain shows "Chain · 3 steps"; clicking its card (or "Run chain") opens the wizard.
- A hand-edited `chain: []` note shows "0 steps" and clicking opens the edit modal, not a wizard.
- A normal prompt card is visually and behaviourally identical to before (regression).

## Task 7 — Rename resilience (glue, manual smoke)

Goal: renaming/moving a prompt note that any chain references rewrites those `chain` arrays
automatically, reusing the existing rename listener.

Files:
- `src/main.ts` (modify) — inside the existing `this.app.vault.on("rename", (file, oldPath) => …)`
  handler that already calls `renameUsage` (ADR-0015): iterate the chain notes in the index
  (`this.index.getAll().filter(p => p.chain !== undefined)`), compute
  `renameChainSteps(p.chain, oldPath, file.path)`, and for any note whose array actually changed,
  persist the new `chain` via `processFrontMatter`. Guard against a rename of the chain note itself
  (its own path changing is handled by the index, not by rewriting its steps).

Manual smoke:
- Rename a prompt that is a step in two different chains (via Obsidian's rename) → both chains'
  `chain` arrays update to the new path automatically; open each and confirm; run one and confirm the
  step still resolves.
- Delete (not rename) a step's source note → no rewrite; L8 flags it and the wizard blocks it (this
  is the intended orphan path, verified in Tasks 3 and 5).

## Task 8 — Full verification & regression

Goal: confirm the DoD end-to-end, prove no transfer/state leakage, and confirm no regression.

Files: none (verification only). Do not edit `PROJECT.md` (orchestrator-owned) or
`docs/adr/README.md` (already updated alongside ADR-0018).

Checks:
- Run the full authoritative command: `npm run build && npm run lint && npm test` — green
  (typecheck, production build, lint, entire vitest suite).
- Grep the transfer layer (`src/domain/transfer.ts`, `src/storage/transfer-io.ts`,
  `src/storage/prompt-writer.ts`) for `chain` → expect **none** (Alternative D: excluded from
  transfer). Export a library before and after creating a chain and diff → byte-identical for the
  non-chain prompts; the chain note simply does not round-trip (documented negative consequence).
- Grep `src/domain/chains.ts` for any Obsidian import or write-capable call → expect none.
- Re-walk the SPEC Definition of Done: 2-step-minimum error, wizard end-to-end incl. `@previous`
  label/value, rename auto-rewrite, orphan block, "Convert to single prompt" body content, the
  "0/1 steps" badge routing, and no regression to single-prompt cards, `{{@clipboard}}` outside
  chains, or `variable-profiles.ts` outside chains.

## Task checklist

- [ ] Task 1 — `src/domain/chains.ts` pure module, TDD, full vitest coverage.
- [ ] Task 2 — `Prompt.chain` field + tolerant `normalizePrompt`, presence-vs-absence tested.
- [ ] Task 3 — Lint rule L8 (orphan chain steps) via a library-wide pass.
- [ ] Task 4 — `ChainModal` create/edit: reorder/remove, 2-step guard, "Convert to single prompt".
- [ ] Task 5 — `ChainWizardModal`: profile picker, per-step compile/Copy/Nav, orphan block.
- [ ] Task 6 — Library-view chain badge + routing; normal cards unchanged.
- [ ] Task 7 — Rename listener rewrites chain arrays automatically.
- [ ] Task 8 — Full build/lint/test green, transfer-exclusion & no-Obsidian-import confirmed, DoD re-verified.
</content>
