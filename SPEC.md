# SPEC — Context variables (Phase 1.5, from competitive-analysis §4 P1)

**Topic slug:** context-variables

| | |
|---|---|
| Source | `docs/competitive-analysis.md` §4 P1 (approved 2026-07-03), `PROJECT.md` Phase 1.5 |
| Depends on | Tier 4 placeholder parser and copy flow (met); ADR-0001, ADR-0002 binding |
| Effort | M |

## 1. Purpose

Resolve workspace context into prompts at copy time through a reserved placeholder namespace, so prompts can reference the active note, current selection, today's date, or the clipboard without manual filling. Extends FR-4 without touching its conservative contract.

## 2. Requirements

### FR-10 Context variables (MUST)

- FR-10.1 Reserved namespace: a placeholder whose name starts with `@` is a context variable. Supported names: `@selection`, `@title`, `@date`, `@clipboard` (lowercase, exact). A `{{@name}}` with any other `@name` is left untouched in the output, consistent with the conservative parser rule (FR-4.6).
- FR-10.2 Resolution at copy time, from workspace state:
  - `@selection` → current selection of the active Markdown editor; if no editor is focused or the selection is empty, resolve to the empty string and show one Notice naming the unresolved variable.
  - `@title` → active note's basename; empty string plus Notice when no note is active.
  - `@date` → today as `YYYY-MM-DD` (always resolvable).
  - `@clipboard` → current clipboard text via the Obsidian-supported clipboard API; on read failure (platform restrictions), empty string plus Notice (NFR-3 pattern).
- FR-10.3 Context variables never appear in the variable-filling modal (FR-4.2). A prompt whose only placeholders are context variables copies without any modal, after resolution. Defaults and hints on a context variable (e.g. `{{@title|fallback}}`) are ignored; the segment is treated as a plain context variable.
- FR-10.4 Copy raw (FR-4.5) bypasses resolution entirely: `{{@anything}}` reaches the clipboard verbatim.
- FR-10.5 Both copy entry points resolve context: library view copy action and quick picker (FR-5).

## 3. Acceptance criteria

- Body `Review {{@selection}} for {{tone|neutral}}` with text selected in an open editor: copy shows the modal only for `tone`; the clipboard contains the selected text substituted.
- Same body, no editor focused: clipboard has empty string in place of `@selection`, one Notice names it, `tone` modal still shown.
- Body `{{@date}}` copies instantly (no modal) with today's date.
- Copy raw on `{{@title}}` yields `{{@title}}` verbatim.
- `{{@unknown}}` passes through untouched in resolved copy.

## 4. Constraints

- Parser stays a pure function (`src/domain/placeholders.ts`); workspace resolution lives in the UI/copy layer, injected as a resolver, so domain tests need no Obsidian mocks.
- No network (NFR-5). Native primitives (ADR-0002). Desktop and mobile; `@selection`/`@clipboard` availability differences on mobile degrade to empty-plus-Notice, never a crash (NFR-8). `.claude/test-cmd` is authoritative and must not change.

## 5. Out of scope

Additional context names (vault name, frontmatter fields), nested resolution, template logic (parked §4 P3a), Templater interop (NG-7).
