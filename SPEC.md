# SPEC — Saved variable profiles (Phase 1.5, from competitive-analysis §6 N2)

**Topic slug:** variable-profiles

| | |
|---|---|
| Source | `docs/competitive-analysis.md` §6 N2 (approved 2026-07-03), `PROJECT.md` Phase 1.5 |
| Depends on | Tier 4 variable modal (met); ADR-0001, ADR-0002 binding |
| Effort | M |

## 1. Purpose

Named value sets for placeholders (e.g. profile "Acme" fills `client`, `tone`, `context`), selectable in the variable modal. Recurring answers stop being retyped. Profiles are ephemeral input aids stored in `data.json`, never in the notes — notes stay the single source of truth for prompts.

## 2. Requirements

### FR-14 Variable profiles (MUST)

- FR-14.1 Data model in plugin settings (`data.json`): a list of profiles, each `{ name: string, values: Record<string,string> }`. Profile names unique (case-insensitive); values map placeholder names to fill values. Tolerant load: malformed entries dropped silently, never a crash (NFR-8 pattern).
- FR-14.2 Variable modal: when at least one saved profile has at least one key matching the prompt's variables, a profile dropdown appears at the top ("No profile" default). Selecting a profile prefills matching fields, overwriting their current content; non-matching fields keep their values; the user can still edit every field afterwards. Selecting "No profile" changes nothing.
- FR-14.3 Save-as-profile: a "Save as profile…" action in the variable modal stores the currently entered values under a new or existing name (explicit user action; name prompt inline in the modal). Saving under an existing name overwrites that profile after the same explicit action.
- FR-14.4 Management in settings tab: list existing profiles with rename and delete controls (delete with confirmation), following the existing taxonomy-editor patterns (FR-8.2 style).
- FR-14.5 Profile application is a pure domain function (given profile values + current field values + variable names → next field values), vitest-covered.

## 3. Acceptance criteria

- Profile "Acme" `{client: "Acme Corp", tone: "formal"}`; prompt with `{{client}}` and `{{topic}}`: dropdown appears; selecting "Acme" fills `client`, leaves `topic`; clipboard reflects edits made after application.
- Prompt with no matching variable names: no dropdown rendered.
- "Save as profile…" with name "Acme" after editing values updates the stored profile.
- Deleting a profile in settings asks confirmation and removes it from `data.json`.
- Malformed profile entry in `data.json` (missing name) is ignored without breaking the modal.

## 4. Constraints

- Profiles live exclusively in `data.json` (spec §3.3: the settings file is the only plugin-owned artifact outside notes). Never written into frontmatter or note bodies. Native primitives (ADR-0002); dropdown and buttons follow existing modal patterns; mobile touch targets. No network. `.claude/test-cmd` is authoritative and must not change.

## 5. Out of scope

Per-prompt default profiles, profile export/import (JSON transfer schema stays v1 untouched), context variables interplay (sibling branch), multi-profile merge.
