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

## Decisions from the import-diff-preview chain (ADR-0011)

Overwrite-policy imports show a per-conflict change preview (fields old→new, body +N/−N, "identical") before anything is written.

Key architectural decisions:
- **`toExportedPrompt` extracted from `buildExport`:** one canonical Prompt+body → transfer-shape mapper; both diff sides use it, so Prompt-only fields are excluded automatically.
- **Gate one layer above `runImport`:** `buildOverwritePreview` in `transfer-io.ts` called from the import modal; `runImport` untouched, FR-17.4/17.5 true by construction.
- **All ten overwritable fields diff**, including `created`/`updated` (silent date rewinds are exactly what the preview must surface).

Detail: `docs/adr/0011-import-diff-preview.md`.
