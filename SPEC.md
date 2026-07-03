# SPEC — Import-conflict diff preview (Phase 1.5, from competitive-analysis §6 N5)

**Topic slug:** import-diff-preview

| | |
|---|---|
| Source | `docs/competitive-analysis.md` §6 N5 (approved 2026-07-03), `PROJECT.md` Phase 1.5 |
| Depends on | Tier 5 import (met, FR-7); ADR-0001, ADR-0002 binding |
| Effort | S |

## 1. Purpose

De-risk the destructive branch of JSON import: before an import that will overwrite existing notes commits anything, show what changes. Deepens FR-7.3 with pure UI over the existing transfer layer; reusable later for community updates (CFR-5.2 groundwork).

## 2. Requirements

### FR-17 Diff preview on overwrite (MUST)

- FR-17.1 When the user picks the "overwrite" conflict policy and at least one conflict exists, a preview step lists each conflicting path with a per-prompt change summary before anything is written. Confirm proceeds with the whole import; cancel aborts the whole import with nothing written (FR-7.3's all-or-nothing contract preserved).
- FR-17.2 Per-prompt summary: which metadata fields change (old → new, one line per changed field) and a body change indicator (unchanged / changed with +N/−N line counts). Identical incoming prompts (no effective change) are labeled "identical".
- FR-17.3 The diff computation is a pure domain function (existing note's metadata + body vs incoming entry), vitest-covered. Line counts from a minimal line-based comparison (added/removed totals, not a full patch render).
- FR-17.4 The other policies (skip, duplicate with suffix) are untouched: no preview step.
- FR-17.5 The end-of-run summary (created/skipped/overwritten/failed) is unchanged.

## 3. Acceptance criteria

- Import with overwrite policy, one conflict where the incoming body adds 2 lines and changes `quality` 3→5: preview lists that path with `quality: 3 → 5` and `body: +2/−0`; confirm → note overwritten; summary reports 1 overwritten.
- Cancel on the preview: no file modified, summary not shown (import aborted).
- Conflict where incoming is byte-identical: labeled "identical" in the preview.
- Import with skip policy and conflicts: no preview, current behavior.

## 4. Constraints

- Pure diff function in `src/domain/` (vitest-covered); preview is a native `Modal` following the existing import-modal pattern (ADR-0002). No transfer-schema change (`schema_version: 1` untouched). Desktop and mobile. No network. `.claude/test-cmd` is authoritative and must not change.

## 5. Out of scope

Per-item accept/reject (policy stays whole-import, FR-7.3), rendered inline diffs, three-way merge, export-side changes.
