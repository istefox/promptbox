# SPEC — Curated packs export (Phase 1.5, from competitive-analysis §6 N7)

**Topic slug:** curated-packs

| | |
|---|---|
| Source | `docs/competitive-analysis.md` §6 N7 (approved 2026-07-03), `PROJECT.md` Phase 1.5 |
| Depends on | Tier 5 transfer (met, FR-7); ADR-0001, ADR-0002 binding |
| Effort | S |

## 1. Purpose

Export a filtered set as a named "pack" (title, description) layered on the existing JSON schema, and recognize packs on import with a summary screen. File-based sharing with zero network; prototypes the catalog-entry shape Tier 8 needs.

## 2. Requirements

### FR-20 Pack export (MUST)

- FR-20.1 "Export as pack…" from the library view exports the current filtered set with an optional pack header: the existing schema plus a `pack: { name: string, description: string }` object. `schema_version` stays `1` — the pack key is additive and optional; a file without it is a plain export.
- FR-20.2 A small modal collects pack name (required, non-empty) and description (optional) before export; file naming follows the existing export naming with the pack slug.
- FR-20.3 Plain "Export" flows (all/filtered, command palette) are unchanged.

### FR-21 Pack import (MUST)

- FR-21.1 Import validation accepts files with or without the `pack` key; a malformed `pack` value (wrong types) is ignored with a warning line in the import modal, and the file imports as a plain export (tolerant, NFR-8 pattern).
- FR-21.2 When a valid `pack` is present, the import modal shows the pack name, description, and prompt count above the existing policy controls.
- FR-21.3 Import execution, conflict policies, and the end-of-run summary are unchanged (FR-7.3/7.4 intact). Round-trip: pack export → import reproduces equivalent notes, pack header not written into any note.

## 3. Acceptance criteria

- Filter to 4 prompts, "Export as pack…" named "Code Review Kit": JSON contains `pack.name`, 4 prompts; existing export command output is unchanged in shape.
- Importing that file shows "Code Review Kit — 4 prompts" plus the description before the policy choice; import behaves exactly as a plain import.
- Importing a file with `pack: "oops"` (wrong type) warns and imports as plain.
- Round-trip equivalence per FR-7.4 holds for pack files.

## 4. Constraints

- Pure domain changes in `src/domain/transfer.ts` (pack parse/build, vitest-covered); UI additions follow existing export/import modal patterns (manual smoke). `schema_version` stays 1. Native primitives, mobile. No network. `.claude/test-cmd` is authoritative and must not change.

## 5. Out of scope

Pack registry/catalog (Tier 8), multi-pack files, pack versioning, pack-scoped conflict policies, any note frontmatter change.
