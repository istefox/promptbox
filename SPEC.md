# SPEC — Prompt linter (Phase 1.5, from competitive-analysis §6 N3)

**Topic slug:** prompt-linter

| | |
|---|---|
| Source | `docs/competitive-analysis.md` §6 N3 (approved 2026-07-03), `PROJECT.md` Phase 1.5 |
| Depends on | Tiers 1-4 (met); ADR-0001, ADR-0002 binding |
| Effort | S/M |

## 1. Purpose

An on-demand health check per prompt and library-wide: surface quality problems as a report, never as an auto-fix. Strengthens the NFR-8 "visible warnings" philosophy and doubles later as the local pre-flight for community submission (CFR-1.2 groundwork).

## 2. Requirements

### FR-15 Lint rules (MUST)

Pure domain module; each rule returns findings `{ ruleId, severity: "warning" | "info", message }`:

- L1 malformed placeholder constructs that the FR-4.6 parser silently skips (unclosed `{{`, empty name) — warning.
- L2 same variable name declared with conflicting defaults or hints (first-occurrence-wins situations, FR-4.2) — warning.
- L3 empty body — warning.
- L4 missing `use_case` — info.
- L5 missing `category` — info.
- L6 near-duplicate titles across the library (case-insensitive equality after trimming; exact-duplicate slugs) — warning, library-wide rule.
- L7 frontmatter warnings already collected by the tolerant parser (NFR-8) — surfaced as findings, reusing `prompt.warnings`.

### FR-16 Lint surfaces (MUST)

- FR-16.1 Command "Lint library" opens a report modal: findings grouped by prompt, count per severity, one line per finding; prompts with zero findings omitted. Empty library or zero findings → a "no issues" line.
- FR-16.2 Library view: each card with at least one warning-severity finding shows a small indicator (reuses the existing warning badge pattern); clicking it opens the report modal scoped to that prompt.
- FR-16.3 The linter never modifies notes; it is read-only over the index (spec §3.2 rule).
- FR-16.4 Report modal rows include an "open as note" action per prompt.

## 3. Acceptance criteria

- Body `Hello {{name` → L1 warning listed for that prompt in the report.
- Body `{{a|x}} … {{a|y}}` → L2 warning naming `a`.
- Two prompts titled "draft email" and "Draft Email" → both listed under L6.
- A fully well-formed prompt appears nowhere in the report.
- Running the command on an empty library shows the "no issues" line, no crash.

## 4. Constraints

- All rules are pure functions in `src/domain/` over `Prompt` + body text, vitest-covered; the report modal and command wiring are UI glue (manual smoke per repo convention). Native `Modal` (ADR-0002). Desktop and mobile. No network. `.claude/test-cmd` is authoritative and must not change. No new settings.

## 5. Out of scope

Auto-fixes of any kind, lint-on-save, configurable rule sets, spellchecking, community submission pre-flight itself (Phase 2 wires it to these rules).
