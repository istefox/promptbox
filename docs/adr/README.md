# Architecture Decision Records

Decisions are numbered, immutable once accepted (superseded by new ADRs, never edited into something else), and follow a compact MADR-style format: Context, Decision, Alternatives considered, Consequences.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-storage-markdown-frontmatter.md) | Store prompts as plain Markdown notes with YAML frontmatter | Accepted |
| [0002](0002-ui-native-obsidian-components.md) | Build the UI on native Obsidian components with vanilla TypeScript | Accepted |
| [0003](0003-community-distribution.md) | Distribute the community library via a GitHub-based catalog with a thin submission bridge | Proposed |
| [0004](0004-favorites.md) | Favorites as a silent-tolerant Prompt field with orthogonal query flags | Accepted |
| [0005](0005-context-variables.md) | Reserved `@` namespace for context variables, resolved via an isolated UI-layer resolver | Proposed |
| [0007](0007-vault-transclusion.md) | Wikilink transclusion at copy time via a pure single-pass body assembler | Accepted |
| [0009](0009-variable-profiles.md) | Store variable profiles in plugin settings behind a pure domain layer | Accepted |
