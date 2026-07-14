# SPEC: Prompt chains

**Topic slug:** prompt-chains

## Objective

Let a user define an ordered sequence of existing prompt notes ("chain") and walk through it
with a guided wizard: copy each step's compiled prompt, paste the external AI's answer back in
to feed the next step, without Promptbox ever calling an AI itself.

## Origin and scope boundary

Design direction explored via `design-brainstorm` (`BRAINSTORM.md`, 2026-07-14) before this
interview. The core constraint locked there and not renegotiated here: Promptbox makes no
network calls (ADR-0003), so a chain can never execute automatically against an LLM. This SPEC
only extracts the requirements for the manual, guided-copy version of the feature.

**Explicitly out of scope for this feature:**
- Automatic execution against an AI API (would require a network call; contradicts the
  no-network constraint that holds across every tier so far).
- Branching or conditional steps. Chains are fixed linear sequences only.
- Chains inside curated packs (ADR-0013). Noted as a future idea, not built now.

## Current state (confirmed during interview / codebase check)

- `Prompt` (`src/domain/prompt.ts`) already has a `type: string` field, free-form and
  user-editable (default `"task"`), used for the user's own classification of a prompt (e.g.
  "task", "chat"). It is **not** a structural discriminator and must not be repurposed as one.
  This ruled out the `type: chain` marker considered during the brainstorm.
- `KNOWN_FIELDS` in `prompt.ts` is the tolerant-parsing allowlist; any frontmatter key not in
  it lands in `custom` (NFR-8, unrecognized-but-preserved). A new `chain` field must be added
  to `KNOWN_FIELDS` and to the `Prompt` interface, following the same silent-tolerant,
  omit-on-default pattern already used for `favorite` (ADR-0004).
- Existing precedent this feature reuses directly: `variable-profiles.ts` (named value sets,
  ADR-0009), `usage.ts` rename-tracking migration (ADR-0015), `lint.ts` rule set L1-L7
  (ADR-0010), `FuzzySuggestModal`-based picking (`quick-picker.ts`, `placeholder-palette.ts`),
  `{{@clipboard}}` context variable (ADR-0005, `context-variables.ts`).

## Scope

### 1. Chain identity and frontmatter

- A chain is a normal vault note. It is identified purely by the **presence** of a `chain`
  frontmatter field: `chain: [path1, path2, ...]` (ordered list of prompt note paths). No
  separate boolean marker field; no reuse of the existing `type` field.
- A chain note must have **at least 2 steps** to be saved. The creation/edit modal blocks
  saving with an inline error ("A chain needs at least 2 steps") if the list has 0 or 1 entry.
- The same prompt path may appear more than once in `chain` (e.g. a refinement prompt reused
  mid-chain and again at the end). No uniqueness constraint.
- `chain: []` or a `chain` field reduced to one entry outside the modal (hand-edited
  frontmatter) is tolerated per NFR-8, not rejected at parse time — only the modal enforces the
  2-step minimum at save time. See Edge cases for the read-time behavior of a sub-2-step chain.

### 2. Creation and editing

- New entry point ("New chain") opens a dedicated modal, following the existing `Modal` +
  `Setting` convention (no new UI framework).
- Steps are added one at a time via a `FuzzySuggestModal` picker over existing prompts (same
  interaction pattern as `placeholder-palette.ts`), appended in pick order.
- Each step row has up/down arrow buttons to reorder (keyboard-accessible, no drag-and-drop
  library dependency) and a remove button.
- If editing an existing chain down to exactly 1 remaining step, the modal does not silently
  auto-convert or auto-delete the note. It shows an explicit **"Convert to single prompt"**
  button. Clicking it: transcludes the remaining step's prompt body into this note's body
  (same mechanism as vault-transclusion, ADR-0007) and removes the `chain` field — the note
  becomes a normal, standalone, usable prompt with real content, not an empty shell. This is
  the only way a chain note stops being a chain; it never happens automatically.

### 3. Wizard execution

- Entry point: clicking a chain's card in the library view (same click-to-act convention as a
  normal prompt card) opens the wizard modal, instead of the normal copy/fill flow.
- Before step 1, a single picker asks which variable profile (ADR-0009) to apply for the
  entire chain (optional — can be skipped to fill everything manually per step). The chosen
  profile's values are applied automatically at every step that references them; the user is
  never asked for the same value twice across the chain.
- Each step screen shows: a "Step N of M" progress header, the step's prompt fully compiled
  (profile values + any per-step-only variables + `{{@previous}}` resolved), an explicit
  "Copy" button, and "Back"/"Next" navigation.
- `{{@previous}}` is a **display-only alias** for `{{@clipboard}}` (ADR-0005) — it resolves to
  the exact same value, but the fill UI labels it "Previous step output" instead of
  "Clipboard" so the user understands its role in a chain context. No new parsing, no new
  reserved-variable behavior; `context-variables.ts` is unchanged except for this label.
- Closing the wizard early (Escape, click outside) simply closes it. No progress is persisted;
  reopening the chain restarts at step 1. This is a session-scoped wizard, not a resumable
  workflow — consistent with the wizard/multi-step-form analogy chosen during the brainstorm.
- If a step's path does not resolve to an existing prompt (deleted or otherwise orphaned), the
  wizard blocks that step with an explicit error message and offers "Skip this step" or
  "Cancel chain" — it never silently skips or copies empty/broken text.

### 4. Library view integration

- Chain notes appear in the same filterable/searchable list as regular prompts (no separate
  tab or view).
- A chain card shows a distinct badge, e.g. "Chain · 4 steps", instead of the normal prompt
  preview text.
- A chain with 0 resolvable steps (empty or fully-orphaned `chain` array) shows a "0 steps"
  badge state; clicking it opens the note for editing instead of attempting to start a wizard.

### 5. Rename resilience

- A vault rename/move event listener rewrites any `chain` array entry that matches the
  renamed/moved path, across all chain notes, the same way `usage.ts` already migrates its
  path-keyed records on rename (ADR-0015 precedent). This runs automatically; no user action
  required.

### 6. Lint coverage

- Extends the existing lint rule set (ADR-0010, `lint.ts`, currently L1-L7) with a new rule
  **L8**: flags a chain note whose `chain` array contains one or more paths that do not
  resolve to an existing prompt note (orphan steps). Ships in the first release, not deferred,
  since a silently-broken chain was the top risk identified in the brainstorm's pre-mortem.

## Architecture (ADR-0001 pattern: pure domain + thin UI glue)

- **`src/domain/chains.ts`** (new, no Obsidian import, vitest-covered): pure functions for
  parsing/validating the `chain` frontmatter field (tolerant per NFR-8), enforcing the 2-step
  minimum at the validation boundary the modal calls into, computing wizard step data
  (compiled text per step, resolved `{{@previous}}` via the existing `{{@clipboard}}`
  resolution path), and the path-rewrite logic used by the rename listener. Mirrors the shape
  of `related.ts` and `variable-profiles.ts`.
- **`src/domain/prompt.ts`** (modified): add optional `chain?: string[]` to the `Prompt`
  interface and `"chain"` to `KNOWN_FIELDS`, following the exact omit-on-default,
  silent-tolerant pattern `favorite` already uses (ADR-0004).
- **`src/domain/lint.ts`** (modified): add rule `L8` for orphan chain steps, following the
  existing per-prompt rule shape (`ruleId`, `severity`, `message`).
- **`src/ui/chain-modal.ts`** (new): creation/edit modal — step list with reorder/remove,
  `FuzzySuggestModal` step picker, 2-step-minimum validation, "Convert to single prompt"
  action. Built on `Modal` + `Setting`, matching `prompt-modal.ts`'s structure.
- **`src/ui/chain-wizard-modal.ts`** (new): the execution wizard — profile picker step, then
  one screen per chain step with progress header, compiled text, Copy button, Back/Next,
  orphan-step blocking error with Skip/Cancel.
- **`src/ui/library-view.ts`** (modified): card rendering branches on presence of `prompt.chain`
  to show the chain badge and route the click handler to `chain-wizard-modal.ts` instead of
  the normal copy/fill flow.
- **Rename listener** (extends the existing vault-event wiring used by `usage.ts`'s migration,
  likely in the plugin's `onload`): on a vault rename event, calls into `chains.ts`'s
  path-rewrite function for every chain note in the index.

## Data model

No new `data.json` entries — a chain lives entirely in its own note's frontmatter, consistent
with ADR-0001 (notes are the source of truth). No transfer/export schema version bump: `chain`
is additive to the existing per-prompt export shape, `schema_version` stays 1 (ADR-0006-era
convention).

```
interface Prompt {
  // ...existing fields unchanged...
  chain?: string[];   // ordered prompt paths; omitted entirely for non-chain notes
}
```

Frontmatter shape on disk for a chain note:

```yaml
---
title: "Research → Draft → Polish"
chain:
  - prompts/research-outline.md
  - prompts/first-draft.md
  - prompts/polish-tone.md
---
```

(Body of a chain note is unused/empty unless it has been explicitly converted to a single
prompt via the "Convert to single prompt" action, at which point `chain` is removed and the
body holds real transcluded content.)

## UI flows

**Create a chain:**
1. User triggers "New chain" (new command/button, exact placement mirrors the existing "New
   prompt" entry point).
2. `chain-modal.ts` opens empty; user adds steps via the `FuzzySuggestModal` picker, reorders
   with up/down arrows, optionally removes steps.
3. Save is blocked with an inline error while fewer than 2 steps are present.
4. On save, a new note is written with `chain: [...]` frontmatter (no body content).

**Run a chain:**
1. User clicks a chain card in the library view.
2. `chain-wizard-modal.ts` opens; optional variable-profile picker, then step 1.
3. Each step: read compiled text, click Copy, paste into external AI tool, copy its answer,
   click Next.
4. Step 2+: `{{@previous}}` (labeled "Previous step output") is pre-filled with whatever is
   currently on the clipboard — the answer just copied in step 3 above.
5. On the last step, "Next" becomes "Finish" and simply closes the wizard. No summary screen,
   no persisted execution record.

**Edit a chain down to 1 step:**
1. User removes steps in `chain-modal.ts` until only one remains.
2. Save is blocked (2-step minimum); the modal instead shows "Convert to single prompt".
3. Clicking it transcludes the remaining step's body and strips `chain`, turning the note into
   a regular, standalone prompt.

## Edge cases

- **Duplicate step in the same chain:** allowed without restriction; `chain` is a list, not a
  set. The wizard shows the same prompt twice at its two positions, independently compiled.
- **`chain: []` or `chain` with 1 entry via hand-edited frontmatter (bypassing the modal):**
  tolerated at parse time (NFR-8); the library-view card shows a "0/1 steps" badge and clicking
  it opens the note for editing (via `chain-modal.ts`, where the 2-step-minimum guard applies
  again on save) rather than starting a wizard.
- **A step's path is renamed/moved elsewhere in the vault:** the rename listener rewrites the
  `chain` array automatically; no user action needed, no orphan created by this path.
- **A step's path is deleted (not renamed):** becomes a true orphan; caught by lint rule L8 at
  any time, and blocked with an explicit error (Skip/Cancel) if reached during a wizard run.
- **Closing the wizard mid-chain:** discards all in-progress state; no partial-execution record
  is written anywhere. Reopening always restarts at step 1.
- **Variable profile chosen at wizard start conflicts with a step's own required variable not
  covered by the profile:** the step still prompts for that specific variable individually
  (profile values are a superset convenience, not an exclusive source), consistent with how
  profiles already behave outside chains (ADR-0009).

## Success criteria / Definition of Done

- `src/domain/chains.ts` exists, has no Obsidian import, and has vitest coverage for: 2-step
  minimum validation, duplicate-step tolerance, empty/short-chain tolerant parsing, wizard
  step-data compilation (including `{{@previous}}` resolving to the same value as
  `{{@clipboard}}`), and the rename path-rewrite function.
- `lint.ts` rule `L8` is implemented and covered by a vitest test asserting it fires on a chain
  with at least one orphan step and stays silent on a fully-resolvable chain.
- Manual smoke pass on a dev build: create a chain (add/reorder/remove steps, 2-step-minimum
  error shown correctly), run its wizard end-to-end (profile picker, Copy per step,
  `{{@previous}}` label and value correctness, Finish), rename a step's source note and confirm
  the chain's `chain` array updates automatically, delete a step's source note and confirm the
  wizard blocks with the orphan error.
- Manual smoke pass for "Convert to single prompt": reduce a chain to 1 step, confirm save is
  blocked, click the convert button, confirm the resulting note has real transcluded body
  content and no `chain` field.
- Library view: chain cards show the correct step-count badge, including the "0/1 steps" edge
  state, and clicking them routes correctly (wizard vs. edit-note-for-broken-chain).
- `npm run build` (typecheck + production build) and `npm run lint` both green.
- No regression to existing single-prompt card behavior, `{{@clipboard}}` outside of chains, or
  `variable-profiles.ts` usage outside of chains.

## Out of scope / follow-up

- Automatic execution against an AI API (network call — contradicts the standing no-network
  constraint).
- Branching or conditional chain steps.
- Chains inside curated packs (ADR-0013) — noted as a future idea in the brainstorm, not built
  in this pass.
- Physical-device mobile verification of the wizard modal (dev-build/desktop smoke only for
  this cycle, same follow-up pattern already used for click-actions).
