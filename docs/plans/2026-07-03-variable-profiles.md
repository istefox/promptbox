# Plan: Saved variable profiles (2026-07-03)

| | |
|---|---|
| Source | `SPEC.md` FR-14, `docs/competitive-analysis.md` §6 N2 |
| ADR | `docs/adr/0009-variable-profiles.md` |
| Depends on | Tier 4 variable modal (met); ADR-0001, ADR-0002 binding |
| Test command | `npm run build && npm run lint && npm test` (`.claude/test-cmd`, authoritative, unchanged) |
| Testing boundary | Only `src/domain/*` gets vitest coverage; UI glue (variable-modal.ts, copy.ts, settings-tab.ts, main.ts wiring) verifies via manual smoke, per existing project convention |

## Tasks

- [ ] **Task 1 — Domain layer: `variable-profiles.ts`, TDD**
  - Goal: pure, fully tested functions for tolerant load (FR-14.1), dropdown gating (FR-14.2), profile application (FR-14.5), and save-as-profile (FR-14.3). Nothing here touches the DOM or settings persistence.
  - Files: create `src/domain/variable-profiles.ts`; create `tests/variable-profiles.test.ts`.
  - Exports: `VariableProfile { name: string; values: Record<string,string> }`; `normalizeProfiles(raw: unknown): VariableProfile[]`; `matchingProfiles(profiles, variableNames: string[]): VariableProfile[]`; `applyProfile(profileValues, currentValues, variableNames): Record<string,string>`; `findProfileIndex(profiles, name: string): number`; `upsertProfile(profiles, name, values): VariableProfile[]`.
  - Behavior to lock down in tests (write these first, then implement):
    - `normalizeProfiles`: non-array raw → `[]`; entry missing/blank/non-string `name` → dropped; entry whose `values` isn't a plain object → kept with `values: {}`; non-string entries inside `values` → dropped key-by-key, string ones kept; `name` trimmed; two entries whose names collide case-insensitively (e.g. "Acme"/"ACME") → first occurrence wins, second dropped (mirrors `parsePlaceholders`'s existing first-occurrence rule).
    - `matchingProfiles`: profile with ≥1 key overlapping `variableNames` → included; 0 overlap → excluded; empty `profiles` or empty `variableNames` → `[]`.
    - `applyProfile`: for each name in `variableNames`, `profileValues`'s entry wins when present (including an explicit empty string), otherwise `currentValues`'s entry is kept (falls back to `""` if absent there too); keys in `profileValues` outside `variableNames` never appear in the output; output's key set is exactly `variableNames`.
    - `findProfileIndex`: exact match and case-insensitive match both resolve to the same index; trimmed comparison; no match → `-1`.
    - `upsertProfile`: new case-insensitive name → appended, input array not mutated; existing case-insensitive match → same length, that entry's `name` becomes exactly the newly given string (not the old casing) and `values` is replaced wholesale, not merged.
  - No dependency on `settings.ts`, `obsidian`, or any `ui/` file.

- [ ] **Task 2 — Settings persistence wiring**
  - Goal: `data.json` gains a tolerant, versionless `profiles` field (FR-14.1), delegating all parsing smarts to Task 1.
  - Files: modify `src/settings.ts`.
  - Contract changes: `PromptboxSettings` gains `profiles: VariableProfile[]`; `DEFAULT_SETTINGS.profiles = []`; both `mergeSettings` return branches (the corrupt-input early return and the normal path) set `profiles: normalizeProfiles(r["profiles"])` (or `[]` on the early-return branch, matching how `categoryValues` is handled there today). Import `normalizeProfiles` and `type VariableProfile` from `../domain/variable-profiles` — one-directional dependency (settings depends on domain, never the reverse), no cycle.
  - Test: none new (the tolerant-load behavior itself is already covered by Task 1's `normalizeProfiles` tests; this task is a thin, mechanical delegation). Verify with `npm run build` (typecheck) — confirm no other file in `src/` or `tests/` constructs a `PromptboxSettings` object literal that would now be missing the required `profiles` field (grepped already: only `settings.ts` itself does; `main.ts` and `prompt-modal.ts` only read the type, they never construct a literal).

- [ ] **Task 3 — Variable modal: profile dropdown, apply-on-select, save-as-profile**
  - Goal: `VariableModal` supports FR-14.2 and FR-14.3 while staying loss-free across rebuilds.
  - Files: modify `src/ui/variable-modal.ts`.
  - Contract changes: export a new `VariableModalDeps` interface, `{ profiles: VariableProfile[]; saveProfile: (name: string, values: Record<string, string>) => Promise<void> }`; constructor becomes `(app, variables, deps: VariableModalDeps, onSubmit)`.
  - Implementation notes (from ADR-0009 decision 3 and 4, read before coding):
    - Split the current `onOpen()` into: a one-time part that attaches the `Enter`-to-submit `keydown` listener on `contentEl` exactly once, plus a call to a new `private display()`; and `display()` itself, which does `contentEl.empty()` and rebuilds every row, mirroring `PromptModal.display()`. **Do not** move the `keydown` listener attachment into `display()` — since `display()` runs more than once now, doing so would stack duplicate listeners and fire `submit()` (and therefore the clipboard write) multiple times per `Enter` press.
    - Seed every field's initial value from `this.values[variable.name]` on each `display()` call (not `variable.defaultValue`, which is only correct on the very first build) so a rebuild never discards what the user already typed.
    - Compute `const matches = matchingProfiles(this.deps.profiles, this.variables.map(v => v.name))` at the top of `display()`. Render the profile dropdown row only when `matches.length > 0` (options: `""` → "No profile", one option per entry in `matches`, `""` selected by default). On change: if the selected value is non-empty, look up the matching profile, compute `applyProfile(profile.values, this.values, this.variables.map(v => v.name))`, and `Object.assign(this.values, ...)` that result; either way, store the selection and call `this.display()`. Selecting "No profile" changes nothing (FR-14.2), so only branch on non-empty selections.
    - Add a `private savingProfile = false` flag and a "Save as profile…" button, mirroring `PromptModal`'s `addingValueFor`/`NEW_VALUE` inline-toggle pattern exactly: clicking it sets the flag and calls `this.display()`; while true, render an inline text row (prefilled with the currently selected profile's name, if any, to make overwriting easy) with "Save" and "Cancel" buttons. "Save" on a non-blank trimmed name calls `void this.deps.saveProfile(trimmedName, { ...this.values })`, shows a confirmation `Notice`, resets the flag, and calls `this.display()`. "Cancel" just resets the flag and calls `this.display()`.
  - Test: none (UI glue, per the testing boundary above). Manual smoke: open a prompt with variables overlapping a saved profile, confirm the dropdown appears and only lists overlapping profiles; confirm selecting one overwrites matching fields and leaves others; confirm a prompt with no overlapping profile shows no dropdown; confirm "Save as profile…" persists edits and Cancel does not; confirm pressing `Enter` after using the dropdown or the save-as-profile toggle copies exactly once (checks the listener footgun above).

- [ ] **Task 4 — Wiring: `copy.ts`, call sites, `main.ts`**
  - Goal: thread `VariableModalDeps` from the plugin down to `VariableModal` without breaking the two existing call sites.
  - Files: modify `src/ui/copy.ts`, `src/ui/quick-picker.ts`, `src/ui/library-view.ts`, `src/main.ts`.
  - Contract changes (observable-contract staleness — call sites found by grep across the full `src/` tree, listed here so they are not rediscovered):
    - `copyWithVariables(app: App, title: string, body: string, deps: VariableModalDeps): void` in `src/ui/copy.ts` — new required 4th parameter; forwards `deps` into `new VariableModal(app, variables, deps, onSubmit)`.
    - `src/ui/quick-picker.ts:42` — `copyWithVariables(this.app, prompt.title, body);` → add `, this.plugin.variableModalDeps()`.
    - `src/ui/library-view.ts:114` — `copyWithVariables(this.app, prompt.title, this.plugin.index.getBody(prompt.path)),` → add `, this.plugin.variableModalDeps()`.
    - `src/main.ts`: add `async saveVariableProfile(name: string, values: Record<string, string>): Promise<void>` (`this.settings.profiles = upsertProfile(this.settings.profiles, name, values); await this.saveSettings();`) and a public `variableModalDeps(): VariableModalDeps` returning `{ profiles: this.settings.profiles, saveProfile: (name, values) => this.saveVariableProfile(name, values) }`.
  - No other call sites exist for either changed function (grep confirmed: `VariableModal` is constructed only inside `copy.ts`; `copyWithVariables` is imported only by `quick-picker.ts` and `library-view.ts`); no test file references either symbol today, so there are no test assertions of the old 3-argument shape to update.
  - Test: none new. Run the **full** suite after this task (`npm test`, i.e. `vitest run` with no path filter) — a signature change touching `main.ts`/`settings.ts` types can surface as a typecheck failure in unrelated test files even without a behavioral test for these specific functions.

- [ ] **Task 5 — Settings-tab management (FR-14.4)**
  - Goal: rename/delete profiles in the settings tab, following the existing taxonomy-editor pattern.
  - Files: modify `src/ui/settings-tab.ts`. `styles.css`: no change expected (reuses `.promptbox-taxo-row`); only touch it if manual smoke turns up a real visual bug.
  - Implementation notes: add `private renderProfilesEditor(): void`, called from `display()` after the category taxonomy editor. One `Setting` row per profile, `setClass("promptbox-taxo-row")` exactly like `renderTaxonomyEditor`: a text input seeded with `profile.name`, `onChange` trims, no-ops on blank, and on a non-blank value checks `findProfileIndex(profiles, trimmed)` — if it resolves to a different index than the current row, show a `Notice` ("A profile named "…" already exists.") and do not rename; otherwise commit `profiles[i]!.name = trimmed` and `void this.plugin.saveSettings()`. One trash `addExtraButton` that opens a `ConfirmModal` (title/message naming the profile, confirm label "Delete") whose `onConfirm` splices the entry, calls `saveSettings()`, and re-renders via `this.display()`. No move-up/move-down buttons (no ordering requirement) and no inline "add" row (creation is exclusively the variable modal's "Save as profile…", Task 3). When `profiles.length === 0`, render a short empty-state line instead of an empty section.
  - Test: none (UI glue). Manual smoke: rename a profile to a name colliding case-insensitively with another → rejected with a `Notice`, original name unchanged; rename to a free name → persisted, reflected next time the variable modal opens; delete → confirmation dialog appears, cancelling leaves the profile intact, confirming removes it from `data.json` and from the variable modal's dropdown.

- [ ] **Task 6 — Full verification**
  - Goal: confirm the whole feature and the untouched surrounding surface both work.
  - Files: none (verification only).
  - Test: run `npm run build && npm run lint && npm test` (typecheck + production build + lint + the **full** vitest suite — `draft`, `indexer`, `perf`, `placeholders`, `prompt`, `query`, `slug`, `transfer`, plus the new `variable-profiles` — must all stay green, not just the new file). Then walk every acceptance criterion in `SPEC.md` §3 by hand: profile "Acme" `{client, tone}` on a prompt with `{{client}}`/`{{topic}}` shows the dropdown, selecting it fills `client` and leaves `topic`, and the clipboard reflects any edits made after selection; a prompt with no overlapping variable name renders no dropdown; "Save as profile…" under an existing name updates that stored profile; deleting a profile in settings asks for confirmation and removes it from `data.json`; a malformed profile entry (missing `name`) hand-edited into `data.json` is silently ignored without breaking the modal on next load.

## Notes for the coder

- Do not introduce list virtualization, network calls, or any per-prompt default-profile field — all explicitly out of scope (`SPEC.md` §5).
- Do not touch the JSON transfer schema (`src/domain/transfer.ts`, `src/storage/transfer-io.ts`) — profiles are excluded from import/export by design.
- `.claude/test-cmd` is authoritative and must not change.
