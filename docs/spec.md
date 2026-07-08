# Promptbox MVP Specification

| | |
|---|---|
| Project | Promptbox, an Obsidian plugin: local-first library of AI prompts with categorization, search, and quick reuse |
| Document version | 0.1 (draft) |
| Date | 2 Jul 2026 |
| Status | Awaiting approval |

## 1. Purpose and scope

Promptbox turns a folder of Markdown notes into a searchable, filterable library of AI prompts inside Obsidian. Each prompt is a plain note with YAML frontmatter, so the library stays readable and portable even without the plugin installed. The MVP covers the private local library only. A shared community library is phase 2 and is addressed at design level in a dedicated ADR (`docs/adr/`), not implemented.

### 1.1 Goals

- Store prompts as portable Markdown notes with structured metadata.
- Find any prompt in seconds through combinable filters and full-text search.
- Reuse prompts via clipboard copy with guided variable filling.
- Keep everything local: no server, no network calls, no telemetry.

### 1.2 Non-goals (explicit)

The MVP will NOT include:

- **NG-1** Community/shared library features (publish, browse, download, moderation). Phase 2, design only.
- **NG-2** Prompt execution against AI providers, API key management, chat UI.
- **NG-3** Version history or diffs. `version` is a single, manually managed field.
- **NG-4** Sync or backup beyond JSON export. Vault sync stays with Obsidian Sync, git, or the user's own tooling.
- **NG-5** Encryption or access control. Security is vault-level, out of scope.
- **NG-6** UI localization. Plugin UI is English only.
- **NG-7** Dedicated integrations with third-party plugins (Templater, Dataview, QuickAdd). The data layout must not prevent them, but no explicit support is built.
- **NG-8** Custom body editor. Prompt bodies are edited in the native Obsidian editor; the plugin edits metadata via modal.

## 2. Users and context

Primary persona: an Obsidian user who works with LLMs daily (developer, consultant, knowledge worker), keeps roughly 50 to 1,000 prompts, and wants them stored in the vault they already back up. Desktop is the main authoring environment; mobile is used mostly for lookup and copy.

## 3. Data model

### 3.1 Prompt note format

- One prompt = one `.md` file inside the configured prompts folder, subfolders included.
- The note body is the prompt text itself. It may contain placeholders (see FR-4).
- Every `.md` file under the prompts folder is a library item. Files with missing or invalid frontmatter are listed with a warning badge and safe fallbacks: never hidden, never a crash.

### 3.2 Frontmatter schema

| Field | Type | Required | Default on creation | Notes |
|---|---|---|---|---|
| `title` | string | yes | file name without extension | Display name; the file name stays stable if the title changes later |
| `type` | string enum | yes | `task` | Default set: `system`, `task`, `agent`, `snippet`; list customizable in settings |
| `category` | string | no | empty | Values managed in settings; unknown values tolerated on read |
| `tags` | string[] | no | `[]` | Native Obsidian frontmatter tags, visible to core tag features |
| `quality` | integer 1–5 | no | unset | Subjective rating |
| `use_case` | string | no | empty | One-line description of intended use |
| `visibility` | `private` \| `public` | yes | `private` | Reserved for phase 2 sharing; fixed enum, not customizable |
| `version` | string | yes | `1.0` | Manually managed; edit modal offers a one-click bump |
| `created` | date `YYYY-MM-DD` | yes | today | Set once by the plugin |
| `updated` | date `YYYY-MM-DD` | yes | today | Refreshed on every save performed through the plugin |

Rules:

- Values outside the configured taxonomy (e.g. a `type` later removed from settings) remain visible, filterable as "custom", and never block the UI.
- External edits (by hand or by other tools) are picked up through vault events. The plugin never rewrites frontmatter except on explicit user actions.

### 3.3 Portability requirement

A vault without Promptbox must still show each prompt as a normal, readable note: standard YAML frontmatter, plain Markdown body, no binary blobs. The only plugin-owned data outside the notes is the settings file (`data.json`).

## 4. Functional requirements

Priorities per MoSCoW: MUST (MVP gate), SHOULD (include if no schedule risk), COULD (nice to have).

### FR-1 Storage and indexing (MUST)

- FR-1.1 The plugin maintains an in-memory index of all prompt notes in the configured folder, built lazily after startup and kept current via vault events (create, modify, delete, rename).
- FR-1.2 Changing the prompts folder in settings triggers a re-index without restart.
- FR-1.3 Notes are the single source of truth; the index is a disposable cache and can always be rebuilt.

### FR-2 Library view (MUST)

- FR-2.1 Dedicated full-tab view (workspace leaf), opened via ribbon icon and command.
- FR-2.2 Filter controls for the categorical frontmatter fields: type, category, tags (multi-select), quality (minimum threshold), visibility. Filters combine with AND.
- FR-2.3 `created`/`updated` are covered by sorting (MUST) and by a date-range filter (SHOULD). `version` is covered by text search (COULD as dedicated filter).
- FR-2.4 Fuzzy search across title, use_case, and note body; incremental while typing; combined with active filters. Matching is subsequence-based (characters in order, not necessarily contiguous) and token-AND: the query splits on whitespace and every token must match at least one field, so word order does not matter (`prompt test` finds "test prompt"). Case-insensitive and diacritic-insensitive. Each match carries a relevance score, weighted title > use_case > body (ADR-0017).
- FR-2.5 Sort by relevance (best match), updated (default, descending), created, title, quality. While a search query is active the list auto-switches to relevance and reverts when the query is cleared; a manually chosen sort is honored. Matched characters in the title are highlighted. Visible result count. One-click "clear all filters".
- FR-2.6 Each list item shows title, type, category, tags, quality, updated date, use_case. Item actions: copy with variables, copy raw, edit metadata, open as note, delete (with confirmation; deletion uses the Obsidian trash mechanism and honors the user's trash preference).
- FR-2.7 The view works on desktop and mobile layouts (single column, touch-friendly targets).

### FR-3 Create and edit (MUST)

- FR-3.1 "New prompt" modal: title, type, category, tags, quality, use_case, visibility, initial body. On confirm, the file is created in the prompts folder with complete frontmatter; the file name derives from a slug of the title; collisions get a numeric suffix.
- FR-3.2 "Edit metadata" modal for existing prompts: same fields except body; `updated` refreshed on save; optional one-click version bump.
- FR-3.3 Body editing happens in the native editor ("open as note"); the modal handles metadata plus initial body only.
- FR-3.4 Taxonomy fields (type, category) render as dropdowns fed by settings; tags as a chips input with suggestions from existing vault tags.

### FR-4 Copy with variables (MUST)

- FR-4.1 Placeholder syntax, pipe-separated, one to three segments:
  - `{{name}}`: empty input field
  - `{{name|default}}`: input prefilled with the default value
  - `{{name|default|hint}}`: prefilled input plus help text under the field (empty default allowed: `{{name||hint}}`)
  - `{{name|option1,option2,...}}`: a default segment with two or more comma-separated values renders a dropdown instead of a free input, with the first option preselected. This means a single default value cannot contain a literal comma.
- FR-4.2 On copy, the plugin parses the body, collects unique variable names in order of first appearance, and shows a single form modal with one field per variable. Repeated occurrences of the same name are asked once and replaced everywhere. If the same name declares different defaults or hints, the first occurrence wins.
- FR-4.3 On confirm, the resolved body (frontmatter stripped) is written to the clipboard and a confirmation notice appears. Cancel copies nothing.
- FR-4.4 Prompts with no placeholders are copied immediately, without a modal.
- FR-4.5 "Copy raw" copies the body verbatim, placeholders untouched. This is the escape hatch for prompts that target other templating systems using `{{ }}`.
- FR-4.6 Malformed constructs (unclosed braces, empty name) are ignored by the parser and left as-is in the output.

### FR-5 Quick picker (MUST)

- FR-5.1 Command "Copy prompt" opens a fuzzy suggester searching across title, category, tags, and use_case; selecting an item triggers the FR-4 copy flow.
- FR-5.2 A secondary action in the picker (modifier key on desktop, secondary button on mobile) triggers copy raw.

### FR-6 Command palette (MUST)

Registered commands: open library view, new prompt, copy prompt (picker), copy prompt raw (picker), export library to JSON, import library from JSON. All commands are assignable to hotkeys through the native Obsidian Hotkeys settings; no default hotkeys are shipped, per plugin guidelines.

- FR-6.1 (SHOULD) When the active note is a prompt, a command "Edit prompt metadata" opens the FR-3.2 modal directly.

### FR-7 Import and export JSON (MUST)

- FR-7.1 Export all prompts, or only the current filtered set when launched from the view, to a single JSON file.
- FR-7.2 JSON schema:

```json
{
  "schema_version": 1,
  "exported_at": "ISO-8601 timestamp",
  "prompts": [
    {
      "path": "relative/path/inside/prompts-folder.md",
      "title": "...", "type": "...", "category": "...",
      "tags": [], "quality": 4, "use_case": "...",
      "visibility": "private", "version": "1.0",
      "created": "YYYY-MM-DD", "updated": "YYYY-MM-DD",
      "body": "full prompt text"
    }
  ]
}
```

- FR-7.3 Import validates the schema before writing anything. On conflicts (same relative path) the user picks one policy for the whole import: skip, overwrite, or duplicate with suffix. Import ends with a summary: created / skipped / overwritten / failed.
- FR-7.4 Round-trip guarantee: export followed by import into an empty folder reproduces equivalent notes.

### FR-8 Settings tab (MUST)

- FR-8.1 Prompts folder selection with folder suggestions.
- FR-8.2 Taxonomy editors: value lists for type and category (add, rename, remove, reorder). Removing a value in use never modifies existing notes.
- FR-8.3 Default type for new prompts. Default sort for the view (COULD).
- FR-8.4 A short pointer to the native Hotkeys tab for key bindings, since commands ship without defaults.

## 5. User stories and acceptance criteria

**US-1 Capture.** As a user I want to save a new prompt without leaving Obsidian, so the library grows with zero friction.
Given the plugin is configured, when I run "New prompt" and fill title and body, then a well-formed note exists in the prompts folder and appears in the view within 1 s.

**US-2 Find.** As a user I want to combine filters and text search, so I find one prompt among hundreds in seconds.
Given 500 prompts, when I combine `type=task` with a text query, then the list updates while typing and shows only matching items with a result count.

**US-3 Reuse.** As a user I want guided variable filling on copy, so I never paste a template with unfilled blanks.
Given a body containing `{{client|Acme|Company name}}`, when I run copy, then a modal shows one field labeled "client", prefilled "Acme", with hint "Company name", and the clipboard receives the body with my value substituted everywhere.

**US-4 Raw reuse.** As a user I want to copy a prompt untouched, because some prompts target another templating engine.
Given a body containing `{{json_schema}}` meant for a downstream tool, when I use copy raw, then the clipboard matches the body exactly.

**US-5 Curate.** As a user I want to edit metadata quickly, so the taxonomy stays clean over time.
Given an existing prompt, when I save the edit modal, then frontmatter is updated, `updated` is refreshed, and the view reflects the change immediately.

**US-6 Backup and migrate.** As a user I want JSON export and import, so I can back up or move the library between vaults.
Given a library, when I export and re-import into another vault, then all prompts exist with identical metadata and bodies.

**US-7 Mobile lookup.** As a user on mobile I want to search and copy a prompt, so I can paste it into another app.
Given the mobile app, when I use the quick picker and pick a prompt, then the variable modal is usable with touch and the resolved text lands in the system clipboard.

**US-8 No lock-in.** As a user I want my prompts readable without the plugin, so I never depend on it.
Given the plugin is disabled, when I open a prompt note, then I see standard frontmatter and the full prompt text as plain Markdown.

## 6. Non-functional requirements

| ID | Requirement | Target / verification |
|---|---|---|
| NFR-1 | Performance at scale | Up to 1,000 prompts: view opens in < 500 ms, search updates in < 100 ms per keystroke on a mid-range desktop. At 5,000 prompts: degraded but responsive, no UI freeze |
| NFR-2 | Startup cost | Index build is deferred and async; no perceptible impact on vault open time |
| NFR-3 | Platforms | Desktop and mobile (`isDesktopOnly: false`); no Node.js or Electron APIs; clipboard via Obsidian-supported API with explicit error notice on failure |
| NFR-4 | Code quality | TypeScript `strict: true`; esbuild build; official Obsidian API only; minimal runtime dependencies, none requiring network access |
| NFR-5 | Privacy | No network calls, no telemetry, no external services in the MVP |
| NFR-6 | Portability | Section 3.3 verified as an acceptance test |
| NFR-7 | Store compliance | Meets Obsidian developer policies and plugin guidelines (manifest correctness, sentence-case UI copy, no default hotkeys, resource cleanup on unload). Checklist re-verified against current official docs at the submission step |
| NFR-8 | Resilience | Malformed YAML, duplicate titles, unexpected files never crash the view; failures degrade to visible warnings |

## 7. MVP acceptance gate

The MVP is releasable when: all MUST requirements are implemented and manually verified on desktop (macOS or Windows) and at least one mobile platform; NFR-1, NFR-3, NFR-4, NFR-5 are verified; US-1 through US-8 pass; the plugin loads and unloads cleanly with no console errors; README and manifest are ready per store guidelines.

## 8. Risks and open points

| Risk | Impact | Mitigation |
|---|---|---|
| Clipboard restrictions on mobile webviews | Copy fails silently | Use the Obsidian-supported clipboard path, test on iOS and Android, show explicit error notice |
| Prompts containing `{{ }}` for other engines | Wrong substitution | Copy raw (FR-4.5) plus conservative parser (FR-4.6) |
| YAML edge cases (quotes, multiline, unicode) | Broken frontmatter | Read and write frontmatter through Obsidian metadata APIs; test with hostile inputs |
| Large libraries | Slow view | In-memory index, debounced search, list virtualization if needed |

Open points deliberately deferred to implementation planning (project.md): file-naming policy when a title changes, list virtualization threshold, export file destination UX on mobile.

## 9. Phase 2 pointer

The community library (a shared public catalog of prompts contributed by plugin users) is specified in `spec-community.md`. The distribution mechanism, a central GitHub repository with a JSON index versus a hosted backend with API, authentication, and moderation, is decided in `docs/adr/0003-community-distribution.md`. Nothing in the MVP data model may conflict with that design; the `visibility` field and tolerance for namespaced extra frontmatter fields (`community_id`, `community_version`, `community_status`, `author`) are the designed hooks.

