# SPEC — Favorites (Phase 1.5, from competitive-analysis §4 P0)

**Topic slug:** favorites

| | |
|---|---|
| Source | `docs/competitive-analysis.md` §4 P0 (approved 2026-07-03), `PROJECT.md` Phase 1.5 |
| Depends on | Tiers 1-4 (met); ADR-0001, ADR-0002 binding |
| Effort | S |

## 1. Purpose

Let the user mark prompts as favorites so frequent prompts surface first in the library view and quick picker. Serves US-2 (find fast) and US-7 (mobile lookup). The field stays readable in plain notes (US-8).

## 2. Requirements

### FR-9 Favorites (MUST)

- FR-9.1 New optional frontmatter field `favorite` (boolean). Absent, invalid, or non-boolean values parse as `false` and never crash the view (NFR-8). The field is written only on an explicit user toggle, via the official frontmatter API (ADR-0001).
- FR-9.2 Library view: each card shows a star toggle (filled = favorite). Toggling updates the note frontmatter and the view reflects the change within 1 s. Tooltip on the control.
- FR-9.3 Quick picker: favorite prompts display a star indicator and rank above non-favorites at equal fuzzy score. Toggling from inside the picker is COULD, not MUST.
- FR-9.4 Filter bar: a "Favorites" filter chip; combines with existing filters in AND (FR-2.2 pattern).
- FR-9.5 Sort: "favorites first" option; within each group the current sort order applies (FR-2.5 pattern).

## 3. Acceptance criteria

- Toggle a card's star: frontmatter gains `favorite: true`; the star fills; disabling the plugin still shows a plain readable note (US-8).
- Enable the Favorites filter with `type=task`: only favorite task prompts listed, count updates.
- Quick picker: favorites appear with star and rank first among equal matches.
- Malformed value (`favorite: "yes please"`) → treated as false, warning-free render.

## 4. Constraints

- No network (NFR-5). Native Obsidian primitives only (ADR-0002). Desktop and mobile touch targets (FR-2.7). No default hotkeys (NFR-7). Frontmatter writes exclusively via official API (ADR-0001). Tests via existing vitest suite; `.claude/test-cmd` is authoritative and must not change.

## 5. Out of scope

Favorite counts or usage tracking (parked N4), per-device favorites, sync semantics beyond the note field itself.
