# CLAUDE.md

## Project

Promptbox - Obsidian plugin: local-first library of AI prompts with categorization, search, and quick reuse.

Source of truth for requirements and sequencing: `docs/spec.md` (MVP), `docs/spec-community.md` (Phase 2), `docs/project.md` (tiered plan, DoD per tier), `docs/adr/` (decisions). Conductor state: `PROJECT.md`.

## Stack

TypeScript `strict: true`, esbuild, ESLint. Official Obsidian plugin API only. Desktop and mobile (`isDesktopOnly: false`).

## Commands

```bash
npm install
npm run dev      # esbuild watch build
npm run build    # typecheck + production build
npm run lint     # eslint
```

## Architecture (ADR-0001, ADR-0002)

- One `.md` file per prompt in a user-configurable vault folder; metadata in YAML frontmatter; note body is the prompt text. Notes are the single source of truth.
- Disposable in-memory index built from Obsidian's metadata cache and vault events. Never persisted.
- UI on native Obsidian primitives, vanilla TS, direct DOM, no framework: `ItemView` (library tab), `Modal` + `Setting` (create/edit, variable filling), `FuzzySuggestModal` (quick picker), `PluginSettingTab` (settings).
- One `styles.css` using Obsidian CSS variables; themes apply automatically.
- Small helper layer (list rendering, filter-state store, debounced search); single render path per view.
- ADR-0003 (community catalog) is Proposed, Phase 2 only. No network calls anywhere in Tiers 0-7.

## Gotchas

- Never hand-parse YAML frontmatter: reads via metadata cache, writes via the official frontmatter-processing API (ADR-0001).
- Frontmatter is user-editable, therefore corruptible: UI must tolerate invalid metadata (NFR-8).
- Store-guideline compliance: clean up all resources on plugin unload; lifecycle maps 1:1 to load/unload.
- Performance target is ~1,000 prompts; list virtualization is deferred until NFR-1 measurements demand it.
- A tier does not start until the previous tier's DoD is met; every implemented requirement references its ID (FR/NFR/US, CFR/CNFR).
- `main` is branch-protected (PR required); CI (typecheck, lint, build) must be green at the end of every tier.

## Decisions from the prompt-linter chain (ADR-0010)

On-demand lint: rules L1-L7 (malformed placeholders, conflicting defaults, empty body, missing use_case/category, duplicate titles, parser warnings), report modal + clickable card badge, never auto-fix.

Key architectural decisions:
- **One shared pass:** `lintLibrary(prompts, getBody)` runs once per command/render; results shared via a path-keyed Map for both badges and report (no O(n²) at NFR-1 scale).
- **Badge replaced, not stacked:** the existing warning badge repoints to the lint map, same CSS, now clickable → scoped report.
- **L1/L2 live in `placeholders.ts`** as additive exports next to the parser; L6 groups by trimmed-lowercase title AND `slugify()` key.

Detail: `docs/adr/0010-prompt-linter.md`.
