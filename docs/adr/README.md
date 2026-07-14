# Architecture Decision Records

Decisions are numbered, immutable once accepted (superseded by new ADRs, never edited into something else), and follow a compact MADR-style format: Context, Decision, Alternatives considered, Consequences.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-storage-markdown-frontmatter.md) | Store prompts as plain Markdown notes with YAML frontmatter | Accepted |
| [0002](0002-ui-native-obsidian-components.md) | Build the UI on native Obsidian components with vanilla TypeScript | Accepted |
| [0003](0003-community-distribution.md) | Distribute the community library via a GitHub-based catalog with a thin submission bridge | Proposed |
| [0004](0004-favorites.md) | Favorites as a silent-tolerant Prompt field with orthogonal query flags | Accepted |
| [0005](0005-context-variables.md) | Reserved `@` namespace for context variables, resolved via an isolated UI-layer resolver | Proposed |
| [0006](0006-tag-category-suggestions.md) | Local keyword-frequency scorer for tag and category suggestions | Accepted |
| [0007](0007-vault-transclusion.md) | Wikilink transclusion at copy time via a pure single-pass body assembler | Accepted |
| [0008](0008-launcher-uri.md) | `obsidian://promptbox` launcher URI: pure-function lookup, cold-start-safe registration | Accepted |
| [0009](0009-variable-profiles.md) | Store variable profiles in plugin settings behind a pure domain layer | Accepted |
| [0010](0010-prompt-linter.md) | Prompt linter as pure domain rules with a shared per-render lint pass | Accepted |
| [0011](0011-import-diff-preview.md) | Import-conflict diff preview | Accepted |
| [0012](0012-related-prompts.md) | Related prompts: pure weighted-overlap scorer, surfaced read-only in the edit modal | Accepted |
| [0013](0013-curated-packs.md) | Curated packs: additive pack header for export/import | Accepted |
| [0014](0014-library-statistics.md) | Library statistics as a read-only report modal over a pure domain aggregator | Accepted |
| [0015](0015-usage-recency-tracking.md) | Usage recency tracking as plugin-local state in `data.json` keyed by path | Accepted |
| [0016](0016-placeholder-insertion-palette.md) | Placeholder insertion palette: one pure catalog/trigger module shared across four native UI surfaces | Accepted |
| [0017](0017-fuzzy-search-relevance.md) | Fuzzy library search with relevance ranking | Accepted |
| [0018](0018-prompt-chains.md) | Prompt chains as a vault note discriminated by a `chain` frontmatter field | Accepted |
</content>
