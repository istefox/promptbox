# ADR-0009: Store variable profiles in plugin settings behind a pure domain layer

| | |
|---|---|
| Status | Accepted |
| Date | 3 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `SPEC.md` FR-14, `docs/competitive-analysis.md` §6 N2, ADR-0001, ADR-0002 |

## Context

Phase 1.5 (`docs/competitive-analysis.md` §6 N2, tracked in `PROJECT.md`) adds named, reusable sets of variable-modal answers ("profiles"), e.g. profile "Acme" fills `client`, `tone`, `context`, so recurring answers stop being retyped. `SPEC.md` FR-14 fixes the shape of the feature: a `{name, values}` list living exclusively in `data.json` with unique, case-insensitive names and tolerant load (FR-14.1); a dropdown in the variable modal that appears only when at least one profile overlaps the current prompt's variables and prefills matching fields on selection (FR-14.2); an explicit "Save as profile…" action (FR-14.3); rename/delete management in the settings tab following the existing taxonomy-editor pattern (FR-14.4); and a pure, vitest-covered function for applying a profile to the current field values (FR-14.5).

ADR-0001 and ADR-0002 are binding and constrain the design further: notes stay the single source of truth and `data.json` is the only other plugin-owned artifact (ADR-0001), and the UI stays native Obsidian primitives with a single render path per view (ADR-0002). The feature depends on the Tier 4 variable modal, already met: `VariableModal` (`src/ui/variable-modal.ts`) currently takes `(app, variables, onSubmit)` and builds its form exactly once inside `onOpen()`; it holds no persisted state across renders and has no re-render path. `copyWithVariables` (`src/ui/copy.ts`) is the sole place that constructs it, called from two sites (`src/ui/quick-picker.ts`, `src/ui/library-view.ts`).

No SPEC.md/ARCH.md ambiguity beyond two details the requirements leave open, both resolved in this ADR because they change what the coder implements and what the tests assert: whether the dropdown should list every saved profile or only the ones that actually overlap the current prompt's variables, and whether "Save as profile…" onto an existing name (typed with different casing) keeps the old stored casing or adopts the newly typed one.

## Decision

1. **Storage.** Add `profiles: VariableProfile[]` to `PromptboxSettings` (`src/settings.ts`), where `VariableProfile = { name: string; values: Record<string, string> }`. `DEFAULT_SETTINGS.profiles = []`. Tolerant parsing of the persisted value is a new pure function, `normalizeProfiles(raw: unknown)`, in a new domain module `src/domain/variable-profiles.ts`; `mergeSettings` calls it exactly the way it already calls the local `stringArray` helper for `typeValues`/`categoryValues`. Placing the tolerant-load logic in `src/domain/*` (rather than inline in `settings.ts`, where today's equivalent `stringArray` helper sits untested) gives FR-14.1 real vitest coverage, consistent with this project's convention that pure helpers backing a UI feature live in the domain layer so they can be tested, even when the surrounding glue (`settings.ts` itself) stays outside the tested boundary.

2. **Domain functions.** All pure, all in `variable-profiles.ts`, all vitest-covered:
   - `matchingProfiles(profiles, variableNames)` — profiles sharing at least one key with `variableNames`; this single predicate both gates the dropdown's existence (FR-14.2: rendered only when the result is non-empty) and defines the dropdown's option list (see resolved detail below).
   - `applyProfile(profileValues, currentValues, variableNames)` — the function FR-14.5 explicitly names: for every name in `variableNames`, the profile's value wins when the key is present (even an explicit empty string), otherwise the current value is kept.
   - `findProfileIndex(profiles, name)` — case-insensitive, trimmed name lookup, `-1` when absent.
   - `upsertProfile(profiles, name, values)` — FR-14.3's save-as-profile: inserts a new profile or replaces the case-insensitive match, using `findProfileIndex` internally. The settings-tab rename guard (FR-14.4) reuses `findProfileIndex` directly, so "what counts as the same profile name" has exactly one implementation.

3. **Modal integration.** `VariableModal`'s constructor gains a `deps: VariableModalDeps` parameter, `{ profiles: VariableProfile[]; saveProfile: (name: string, values: Record<string, string>) => Promise<void> }`, defined and exported from `variable-modal.ts` itself, mirroring the existing `PromptModalDeps` convention (`src/ui/prompt-modal.ts`) rather than injecting the whole plugin. `copyWithVariables` (`src/ui/copy.ts`) gains the same `deps` parameter and forwards it to `VariableModal`. Its two call sites build `deps` via a new `PromptboxPlugin.variableModalDeps()` method (public, since it is called from two different `ui/` files; mirrors the existing private `modalDeps()` already used for `PromptModal`).

4. **Re-render strategy.** `VariableModal.onOpen()` becomes a one-time setup (build `contentEl`, attach the Enter-to-submit keydown listener exactly once) plus a `private display()` method that empties and rebuilds `contentEl` from `this.values`, a field that already persists across the object's lifetime. This mirrors `PromptModal.display()`'s existing "loss-free rebuild because state lives in a field, not the DOM" idiom, used today for its inline "new taxonomy value" toggle. Selecting a profile from the dropdown, or toggling the inline "Save as profile…" name row, calls `this.display()`. Every field's initial value on each rebuild is seeded from `this.values[variable.name]` (changed from today's `variable.defaultValue`, which would otherwise reset every field to its default on every rebuild and defeat the point of a loss-free rebuild).

5. **Settings tab (FR-14.4).** A new `renderProfilesEditor()` in `settings-tab.ts`, styled with the existing `.promptbox-taxo-row` class exactly like `renderTaxonomyEditor`: one row per profile with an inline rename text input (collision-checked via `findProfileIndex`, a `Notice` on collision, no-op on empty input, exactly mirroring the taxonomy row's own empty/duplicate guards) and a trash button that opens the existing `ConfirmModal` before removing the entry. No reorder controls (not required by FR-14.4) and no inline "add" row here: creation is exclusively the variable modal's "Save as profile…" action (FR-14.3; per-prompt default profiles and any other creation path are explicitly out of scope, `SPEC.md` §5). An empty-state line is shown when there are no profiles, since unlike the taxonomy lists this section has no "Add…" row to fall back on visually.

**Resolved detail 1 — dropdown membership.** The dropdown lists only the profiles returned by `matchingProfiles` (at least one overlapping key), not every saved profile. A profile with zero overlapping keys could not change any field if selected, so listing it would be pure clutter with a false affordance; the gate condition and the option-list condition are therefore the same predicate.

**Resolved detail 2 — overwrite casing.** `upsertProfile`'s overwrite path replaces the stored profile's name with exactly the string the user typed, not the previous casing (e.g. saving "acme" over a stored "Acme" renames it to "acme"). This is a deliberate "last write wins" rule, documented here so it is not "fixed" by accident later.

## Alternatives considered

1. **Persist profiles in note frontmatter** (e.g. a `variable_profiles` field on some designated note, or scattered per-prompt entries). Rejected: `SPEC.md` FR-14.1 and its constraints section explicitly forbid this ("never in the notes"), and more fundamentally it would break ADR-0001's single-source-of-truth model. Profiles are cross-prompt, reusable input aids, not per-prompt content; they have no natural note to live in without inventing a synthetic "profiles note" that nothing else in the vault model expects, and that a user could accidentally edit, rename, or delete outside the plugin's control.

2. **Pass the whole `PromptboxPlugin` instance into `copyWithVariables`/`VariableModal`** instead of a narrow `VariableModalDeps` object. Both `quick-picker.ts` and `library-view.ts` already hold `this.plugin`, so this would shrink the two call-site edits slightly. Rejected: it breaks the codebase's established DI convention for modals needing plugin state (`PromptModalDeps` exists precisely to avoid coupling a modal to the full plugin class), and it would give `VariableModal` implicit access to unrelated plugin surface (the index, commands, the rest of settings), enlarging its blast radius and its test/mount surface for no behavioral benefit. The one-time cost of a `variableModalDeps()` builder method (mirroring the private `modalDeps()` already in `main.ts`) buys a materially smaller, more legible, and more testable contract for the modal.

3. **Keep `VariableModal.onOpen()` single-pass and patch individual field components in place** (store a `Map<string, TextComponent | DropdownComponent>` built during the first render, then call `.setValue()` on the affected entries when a profile is applied) instead of introducing a `display()` rebuild. Rejected: this is more code for no behavioral gain, since `PromptModal` already proves the full-rebuild-from-a-field approach is loss-free once state lives outside the DOM, and patching in place does not remove any real risk, it just trades one footgun (the keydown listener re-stacking on rebuild, which is explicitly called out and mitigated in this ADR) for a second, divergent "render a field" code path that has to be kept in sync by hand across two mutation strategies. A single, already-understood rebuild idiom is cheaper to maintain than two different ones inside the same file.

## Consequences

**Positive:**
- Profile handling is a stand-alone, fully pure, fully vitest-covered module (`src/domain/variable-profiles.ts`), giving FR-14.1's tolerant load and FR-14.5's apply function real automated coverage rather than relying on manual smoke testing, consistent with this project's existing testing boundary (only `src/domain/*` is vitest-covered; UI glue is smoke-tested).
- `VariableModalDeps` and `variableModalDeps()` keep the dependency-injection shape consistent with the already-established `PromptModalDeps`/`modalDeps()` pattern, so a contributor who understands one modal's plumbing already understands the other's.
- The `display()` refactor gives `VariableModal` a real, extensible re-render path for free, useful for any future field addition to that modal without another structural rewrite.
- The settings-tab profile list reuses `.promptbox-taxo-row` verbatim; no new CSS is expected.

**Negative and accepted:**
- `copyWithVariables` and `VariableModal`'s constructor both gain a required parameter, an observable-contract change touching two production call sites (`src/ui/quick-picker.ts:42`, `src/ui/library-view.ts:114`, both grepped and confirmed as the only call sites besides the definition itself). Both are simple, mechanical call-site edits, but they must land together with the modal changes in one task to avoid an intermediate non-compiling state.
- The `display()` rebuild introduces a real footgun the current single-pass `onOpen()` never had: the existing raw `contentEl.addEventListener("keydown", …)` call, if left inside `display()`, would re-attach on every rebuild and fire the Enter-to-submit handler multiple times per keypress (duplicate clipboard writes, duplicate `Notice`s). The implementation plan calls this out explicitly: the listener must be attached exactly once, in `onOpen()`, not inside `display()`.
- `upsertProfile`'s overwrite-casing rule (resolved detail 2 above) is a judgment call under-specified by `SPEC.md`; it is cheap to change later since it is isolated to one function, but a future spec reviewer disagreeing with it should treat it as a deliberate decision to revisit, not a bug.

**Neutral:**
- Profiles are not surfaced anywhere in the library view, filter bar, or quick picker; they exist solely as variable-modal and settings-tab concepts, matching `SPEC.md` §5's explicit out-of-scope list (no per-prompt default profiles, no export/import, no usage tracking, no multi-profile merge).
- The dropdown-membership resolution (resolved detail 1 above) means a prompt with variables that overlap zero saved profiles renders no dropdown at all, identical in appearance to having zero saved profiles; this is intentional and matches the acceptance criterion "Prompt with no matching variable name: no dropdown rendered."

## References

- `SPEC.md` FR-14 (root-level topic spec for this chain; `docs/spec.md` is the Phase 1 MVP spec and does not define FR-14)
- `docs/competitive-analysis.md` §6 N2
- `docs/adr/0001-storage-markdown-frontmatter.md`
- `docs/adr/0002-ui-native-obsidian-components.md`
- `docs/adr/README.md` (index updated with this ADR's row)
- `src/ui/prompt-modal.ts` (`PromptModalDeps`, `addingValueFor`/`NEW_VALUE` inline-toggle pattern, `display()` rebuild)
- `src/ui/settings-tab.ts` (`renderTaxonomyEditor`, FR-8.2 pattern)
