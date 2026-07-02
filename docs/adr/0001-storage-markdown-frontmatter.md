# ADR-0001: Store prompts as plain Markdown notes with YAML frontmatter

| | |
|---|---|
| Status | Accepted |
| Date | 2 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `spec.md` §3, ADR-0003 |

## Context

Promptbox needs persistent storage for prompts and their metadata (taxonomy, quality, dates, versioning) inside an Obsidian vault, on desktop and mobile. Hard constraints from the project brief: data must remain readable without the plugin installed (no lock-in), zero server dependencies, and compatibility with the community plugin store. The storage choice also has to serve phase 2: community prompts must be installable as ordinary local items.

## Decision

Each prompt is one `.md` file in a user-configurable vault folder (subfolders included). Metadata lives in standard YAML frontmatter (schema in `spec.md` §3.2); the note body is the prompt text. The plugin keeps a disposable in-memory index built from Obsidian's metadata cache and vault events; notes are the single source of truth and the index is never persisted.

Frontmatter is read and written exclusively through Obsidian's official metadata APIs (metadata cache for reads, the frontmatter-processing API for writes) rather than hand-rolled YAML parsing, to survive YAML edge cases and stay consistent with other tools operating on the vault.

## Alternatives considered

1. **Single JSON store in the plugin folder (`data.json` or a dedicated file).** Fast, trivially indexed, atomic. Rejected: prompts become invisible to Obsidian search, links, tags, sync conflict resolution, and unreadable without the plugin. Violates the portability constraint outright.
2. **Embedded database (IndexedDB / SQLite via WASM).** Best query performance at scale. Rejected: binary artifacts inside or outside the vault break portability and sync semantics, add heavyweight dependencies, and complicate mobile. Performance targets (~1,000 prompts) do not require it.
3. **Hybrid: notes plus a persisted index file.** Rejected: two sources of truth drift apart (external edits, sync conflicts); a rebuildable in-memory index gives the same speed without the consistency risk.

## Consequences

Positive: full portability and no lock-in (spec US-8); native integration with tags, search, backlinks, Obsidian Sync and git; community prompts in phase 2 install as plain notes with provenance fields; users can bulk-edit with any tool.

Negative and accepted: full-text search must be implemented plugin-side over the in-memory index; frontmatter is user-editable and therefore corruptible, so the UI must tolerate invalid metadata (spec NFR-8); very large libraries (5,000+) may need list virtualization, deferred until measured.
