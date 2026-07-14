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

## Architecture decisions (full detail in `docs/adr/`)

Recurring patterns: pure vitest-covered domain modules in `src/domain/` (no Obsidian import); UI glue in `src/ui/` verified by manual smoke; tolerant parsing (NFR-8); additive `LibraryQuery`/transfer changes (`schema_version` stays 1); minimal frontmatter (omit-on-default). Read the ADR before changing a feature.

- **ADR-0004 favorites** — `favorite` frontmatter field, silent-tolerant, omit-on-false; orthogonal `favoritesOnly`/`favoritesFirst` query flags; excluded from JSON transfer.
- **ADR-0005 context-variables** — reserved `@` namespace (`{{@selection/@title/@date/@clipboard}}`, permanently reserved by FR-10); single parse, partition then merge; `copyWithVariables` signature stable.
- **ADR-0006 tag-category-suggestions** — shared pure `suggestValues` scorer in `src/domain/suggestions.ts`; scoped re-render (never full `display()`); chips never auto-applied.
- **ADR-0007 vault-transclusion** — single-pass `assembleBody` (inserted spans never re-scanned, FR-12.6); `copyWithVariables` gains `sourcePath`; depth cap 1; `#`/`^` refs unresolvable by design.
- **ADR-0008 launcher-uri** — `obsidian://promptbox` (`path`/`title`/`raw`, no-params → picker); readiness gate on `indexReady`; pure `resolveLauncherLookup`; `path` outranks `title`.
- **ADR-0009 variable-profiles** — named value sets in `data.json`, never in notes; pure `variable-profiles.ts`; Enter listener attaches once in `onOpen()`, not `display()`.
- **ADR-0010 prompt-linter** — on-demand rules L1-L7; one shared `lintLibrary` pass (path-keyed Map, no O(n²)); clickable card badge; never auto-fix.
- **ADR-0011 import-diff-preview** — per-conflict old→new preview above `runImport` (untouched); shared `toExportedPrompt` mapper; all ten overwritable fields diff, including dates.
- **ADR-0012 related-prompts** — top-5 neighbors (tags ×3, category ×2, title/use_case token ×1); pure `related.ts` returns ranked `Prompt[]`; `PromptModalDeps.allPrompts` snapshot.
- **ADR-0013 curated-packs** — optional additive `pack` header; `buildPackExport` composes, `runImport` reads only `doc.prompts`; plain exports byte-identical.
- **ADR-0014 library-statistics** — read-only stats modal computed once in `onOpen()`; single `computeLibraryStats` entry point; orphan detection reuses `isCustomValue`.
- **ADR-0015 usage-recency-tracking** — `lastUsed`+`count` in `data.json` keyed by path; pure `usage.ts`; record only on a real copy (`onCopied`); `recently-used-desc` sort; lazy prune + rename migration.
- **ADR-0016 placeholder-insertion-palette** — pure `placeholder-palette.ts` (catalog/trigger/filter/caret); four thin UI surfaces share one `SuggestModal` + `applyEntryToEditor`/`applyEntryToTextarea`; substring filter; textarea needs hand-rolled DOM (`AbstractInputSuggest` rejects `<textarea>`).
- **ADR-0017 fuzzy-search-relevance** — pure `search.ts` subsequence scorer (`scoreLibraryMatch`/`titleMatchRanges`), token-AND word-order independence, field weights title>use_case>body, length-preserving title fold for 1:1 highlight indices; additive `relevance-desc` SortKey threaded through the comparator like `usageRecency`; UI auto-switches to relevance on an active query; `runQuery` signature unchanged; no Obsidian import in domain.
- **ADR-0018 prompt-chains** — chain = mere presence of `chain?: string[]` on `Prompt` (never the free-form `type` field); pure `src/domain/chains.ts` (read/validate/orphan-detection/rename-rewrite/wizard value assembly); `{{@previous}}` is a wizard-scoped alias for `{{@clipboard}}`, never added to `context-variables.ts` resolvers; new lint rule `L8` (orphan steps); excluded from JSON transfer for now, same as `favorite`.
