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

## Decisions from the curated-packs chain (ADR-0013)

Optional `pack: {name, description}` header on the existing export schema; "Export as pack…" from the filtered view; pack banner on import.

Key architectural decisions:
- **`buildExport`/`runImport` untouched:** `buildPackExport` composes, `runImport` reads only `doc.prompts` — the pack header never reaches notes by construction.
- **Tolerant parse via `warnings: string[]`** on `ValidationResult` (NFR-8 idiom); bad pack values warn, never block.
- **Pack-aware naming derived** from `doc.pack?.name` inside the existing naming helper; plain exports byte-identical to before.
- **`schema_version` stays 1** — the key is additive and optional.

Detail: `docs/adr/0013-curated-packs.md`.

## Decisions from the import-diff-preview chain (ADR-0011)

Overwrite-policy imports show a per-conflict change preview (fields old→new, body +N/−N, "identical") before anything is written.

Key architectural decisions:
- **`toExportedPrompt` extracted from `buildExport`:** one canonical Prompt+body → transfer-shape mapper; both diff sides use it, so Prompt-only fields are excluded automatically.
- **Gate one layer above `runImport`:** `buildOverwritePreview` in `transfer-io.ts` called from the import modal; `runImport` untouched, FR-17.4/17.5 true by construction.
- **All ten overwritable fields diff**, including `created`/`updated` (silent date rewinds are exactly what the preview must surface).

Detail: `docs/adr/0011-import-diff-preview.md`.

## Decisions from the prompt-linter chain (ADR-0010)

On-demand lint: rules L1-L7 (malformed placeholders, conflicting defaults, empty body, missing use_case/category, duplicate titles, parser warnings), report modal + clickable card badge, never auto-fix.

Key architectural decisions:
- **One shared pass:** `lintLibrary(prompts, getBody)` runs once per command/render; results shared via a path-keyed Map for both badges and report (no O(n²) at NFR-1 scale).
- **Badge replaced, not stacked:** the existing warning badge repoints to the lint map, same CSS, now clickable → scoped report.
- **L1/L2 live in `placeholders.ts`** as additive exports next to the parser; L6 groups by trimmed-lowercase title AND `slugify()` key.

Detail: `docs/adr/0010-prompt-linter.md`.

## Decisions from the tag-category-suggestions chain (ADR-0006)

Suggestion chips (tags top-5, category top-3) in the prompt modal, scored locally, never auto-applied.

Key architectural decisions:
- **One shared scorer:** generic pure `suggestValues(text, candidates, selected, limit)` in `src/domain/suggestions.ts` serves both fields; reuse it for future similarity features.
- **Scoped re-render:** debounced keystroke refresh touches only the suggestion containers; `display()` full rebuild stays reserved for click/select events (focus-loss guard).
- **Edit mode scores title + use_case only:** the edit modal has no body by design (FR-3.2); documented gap, not an oversight.
- **No new deps surface:** candidate pools already exist on `PromptModalDeps`; zero `main.ts` changes.

Detail: `docs/adr/0006-tag-category-suggestions.md`.

## Decisions from the variable-profiles chain (ADR-0009)

Named placeholder value sets in `data.json`, applied from a dropdown in the variable modal; never stored in notes.

Key architectural decisions:
- **Pure domain module `src/domain/variable-profiles.ts`:** normalize/match/apply/upsert, vitest-covered; tolerant load drops malformed entries.
- **Narrow deps injection:** `VariableModalDeps` (profiles + saveProfile) built by `variableModalDeps()`, mirroring `PromptModalDeps`.
- **Modal `display()` rebuild refactor:** state in `this.values`; the Enter-to-submit listener attaches once in `onOpen()`, never inside `display()` (duplicate-listener footgun).
- **Dropdown lists only profiles with ≥1 matching key.**

Detail: `docs/adr/0009-variable-profiles.md`.

## Decisions from the vault-transclusion chain (ADR-0007)

Wikilink transclusion at copy time: `[[target]]`/`![[target]]` resolve to the linked note's body (frontmatter stripped), depth cap 1, preview modal with sizes and 50k warning, copy-raw bypass.

Key architectural decisions:
- **Single-pass span assembler:** `assembleBody` splices wikilink and placeholder spans over the pristine original body in one pass; inserted content is never re-scanned for links or placeholders (FR-12.6).
- **`copyWithVariables` gains `sourcePath`:** required for `getFirstLinkpathDest` disambiguation with duplicate basenames; the only signature change, 2 call sites.
- **Resolution + preview in `src/ui/transclusion-modal.ts`;** detection stays pure in `src/domain/transclusion.ts` (vitest-covered).
- **Heading/block refs (`#`, `^`) are unresolvable by design** and share the unresolved-links Notice.

Detail: `docs/adr/0007-vault-transclusion.md`.

## Decisions from the favorites chain (ADR-0004)

Favorites: `favorite` boolean frontmatter field with star toggle, filter chip, favorites-first sort.

Key architectural decisions:
- **Silent tolerant parse:** `favorite` parses as `value === true` and never warns — the one deliberate exception to warn-on-invalid (FR-9.1).
- **Orthogonal query flags:** `LibraryQuery` gains `favoritesOnly`/`favoritesFirst` booleans; no new SortKey variants.
- **Picker ranking:** `rankFavoritesFirst<T>` reorders only at equal fuzzy score, preserving native relevance.
- **Transfer allowlist unchanged:** `favorite` is intentionally excluded from JSON export/import (schema_version 1); revisit trigger in the ADR.
- **Omit-on-false:** the frontmatter key is deleted when false, per the minimal-frontmatter convention.

Detail: `docs/adr/0004-favorites.md`.

## Decisions from the context-variables chain (ADR-0005)

Context variables: reserved `{{@selection}}` `{{@title}}` `{{@date}}` `{{@clipboard}}` resolved at copy time.

Key architectural decisions:
- **Single parse, partition then merge:** one `parsePlaceholders` pass; context and user values merge into one resolution — never substitute-then-reparse (resolved text containing `{{...}}` must not re-parse).
- **Pure classification, impure resolution:** `isContextVariable` lives in `src/domain/placeholders.ts` (vitest-covered); resolution lives in `src/ui/context-variables.ts`.
- **Signature-stable entry points:** `copyWithVariables` keeps its exported signature, so both copy entry points gain the feature with zero call-site edits (FR-10.5).
- **Asymmetric empties:** empty selection = unresolved (Notice); read-but-empty clipboard = resolved (no Notice).
- **Reserved namespace:** bare `@` placeholder names are permanently reserved by FR-10.

Detail: `docs/adr/0005-context-variables.md`.
