# SPEC — Launcher integration via Obsidian URI (Phase 1.5, from competitive-analysis §6 N1)

**Topic slug:** launcher-uri

| | |
|---|---|
| Source | `docs/competitive-analysis.md` §6 N1 (approved 2026-07-03), `PROJECT.md` Phase 1.5 |
| Depends on | Tier 4 copy flow (met); ADR-0001, ADR-0002 binding |
| Effort | M |

## 1. Purpose

Expose the prompt library to OS-level launchers (Raycast, Alfred, Shortcuts) through an `obsidian://` URI action: look up a prompt, run the normal copy flow, land the result in the clipboard. The library becomes an OS-wide asset without opening the library view first.

## 2. Requirements

### FR-13 URI action (MUST)

- FR-13.1 Register a protocol handler for the action `promptbox` via the official `registerObsidianProtocolHandler` API, cleaned up on unload (NFR-7 lifecycle rule).
- FR-13.2 Supported parameters (all values URI-encoded):
  - `path=<vault-relative path>` → exact lookup in the index.
  - `title=<prompt title>` → case-insensitive exact title match; if several prompts share the title, the most recently updated wins.
  - `raw=true` → copy raw (FR-4.5 semantics) instead of the variable flow.
  - Neither `path` nor `title` present → open the quick picker (FR-5) as fallback.
- FR-13.3 On match: run the standard copy flow — variable modal when placeholders exist (Obsidian comes to foreground for it), instant copy otherwise; confirmation Notice either way (FR-4.3/4.4 semantics unchanged).
- FR-13.4 No match: a Notice naming the failed lookup; never a crash (NFR-8).
- FR-13.5 Lookup is a pure domain function over the index list (path match, title match with updated-date tie-break), vitest-covered.

## 3. Acceptance criteria

- `obsidian://promptbox?title=Code%20review` with a matching prompt containing placeholders: Obsidian foregrounds, the variable modal opens, confirm → resolved body on the system clipboard.
- Same URI with `&raw=true`: clipboard gets the body verbatim, no modal.
- `obsidian://promptbox?path=prompts/review.md`: exact-path lookup works regardless of title.
- Two prompts titled "Draft": the one with the newer `updated` is chosen.
- `obsidian://promptbox` with no parameters: the quick picker opens.
- `obsidian://promptbox?title=Nope`: Notice "No prompt matching …", nothing copied.

## 4. Constraints

- Official Obsidian API only (`registerObsidianProtocolHandler`); handler registered in `onload`, no residue after unload. Desktop and mobile (URI support differs per OS; the handler itself is platform-neutral, NFR-3 clipboard rules apply). No network. `.claude/test-cmd` is authoritative and must not change.

## 5. Out of scope

Return of the resolved text to the caller (x-callback-url `x-success` round-trip), background copy without foregrounding when a modal is needed, URI actions that mutate notes (create/edit stay in-app), custom URI schemes outside `obsidian://`.
