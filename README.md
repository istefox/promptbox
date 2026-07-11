# Promptbox

A local-first library of AI prompts for Obsidian. Each prompt is a plain Markdown note with YAML frontmatter, so the library stays readable, searchable, and portable even without the plugin. Nothing leaves the vault: no network calls, no accounts, no telemetry. Works on desktop and mobile.

## Features

### Library view

- Full-tab library with fuzzy search: a subsequence matcher scores and ranks results by title, use case, and body, independent of word order, and highlights the matched characters in the title.
- Filters for type, category, tags, quality, visibility, and date, plus sorting by title, date, usage recency, relevance, or favorites-first.
- Each card carries icon-button actions (copy with variables, copy raw, edit metadata, open as note, delete, toggle favorite) and, as of v1.2.0, a right-click (long-press on mobile) context menu with the same actions as text labels, a second way to reach them without cluttering the card further.
- A lint badge appears on any card with a warning; click it to open the full findings for that prompt.

### Creating and editing

- Create and edit prompts from a modal. The frontmatter holds the metadata; the body lives in the note itself, so it opens in the normal Obsidian editor.
- Tag and category fields suggest values already used in the library, ranked by a local keyword-frequency scorer. The plugin never applies suggestions automatically, it only offers them as chips.
- The edit modal shows up to 5 related prompts, ranked by shared tags, category, and title or use-case tokens, so duplicate or near-duplicate prompts are easy to spot.

### Copying and reuse

- Copy with variables: prompts can declare `{{name}}` placeholders, filled through a form before copying. Placeholders support a default value (`{{name|default}}`), a hint (`{{name|default|hint}}`), and a choice dropdown (`{{tone|formal,casual|hint}}`).
- Context variables resolve automatically at copy time: `{{@selection}}` inserts the current editor selection, `{{@title}}` and `{{@date}}` pull from the active note, and `{{@clipboard}}` reads the system clipboard.
- A placeholder insertion palette (the "Insert placeholder" command, inline `{{` autocomplete while typing, and a button in the create/edit modal) lists context variables, names already used elsewhere in the library, and the raw syntax templates, so nothing needs to be memorized.
- Vault transclusion: a `[[wikilink]]` inside a prompt body resolves to the linked note's content at copy time, one level deep. The resolver leaves heading (`#`) and block (`^`) references unresolved by design.
- Variable profiles: save a named set of placeholder values from the fill-in form and reapply it later from a dropdown, useful for prompts that are copied often with the same inputs.

### Quick access outside the library

- A quick picker (fuzzy suggest modal) for reuse without opening the full library tab. Hold Ctrl or Cmd while selecting to copy the raw body instead of resolving variables.
- An `obsidian://promptbox` launcher URI, callable from Raycast, Alfred, Shortcuts, or any other URI-aware tool. Pass `path` or `title` to jump straight to a prompt, `raw=true` to skip the variable form, or no parameters at all to open the picker.

### Keeping the library healthy

- A linter flags common problems on demand: malformed or conflicting placeholder declarations, empty bodies, missing use case or category, and near-duplicate titles. It only reports, it never rewrites a note.
- JSON export and import, with a per-conflict diff preview (old value versus new, field by field) before anything gets overwritten.
- Curated packs bundle a set of prompts with pack-level metadata for sharing a themed collection as a single file; a plain export stays byte-identical for everyone else.
- A read-only statistics modal reports library size, tag and category distribution, and orphaned references, computed on demand.
- The plugin tracks usage locally (last-used date, copy count) to power the "recently used" sort. This lives in the plugin's local data, never in the notes themselves.

## Commands

| Command | Does |
|---|---|
| Open library | Opens the library view |
| New prompt | Opens the create modal |
| Edit prompt metadata | Opens the edit modal for the active note, if it's a prompt |
| Insert placeholder | Opens the placeholder insertion palette at the cursor |
| Copy prompt | Copies the active note with variables resolved |
| Copy prompt (raw) | Copies the active note's body unresolved |
| Export prompts (JSON) | Exports the current filtered set |
| Import prompts (JSON) | Opens the import flow with diff preview |
| Lint library | Runs the linter over the whole library |
| Library statistics | Opens the statistics modal |

None ship with a default hotkey; assign them under Settings, Hotkeys.

## Settings

- **Prompts folder**: the vault folder that holds prompt notes (subfolders included). Changing it re-indexes immediately.
- **Default type for new prompts**: preselected in the create modal.
- **Type and category values**: add, rename, reorder, or remove; these feed the modal dropdowns and the library filters. Removing a value in use never touches existing notes, only the dropdown list.
- **Variable profiles**: rename or delete profiles saved from the copy-with-variables form.

## Usage

1. Open the library from the ribbon icon or the "Open library" command, and set the prompts folder in the plugin settings.
2. Create a prompt with "New prompt". The frontmatter holds the metadata, the note body is the prompt text.
3. Copy a prompt from a card action, the right-click menu, the quick picker, or the `obsidian://promptbox` URI. A form opens for any placeholders; the result goes to the clipboard.
4. While writing a prompt body, run "Insert placeholder" or type `{{` to insert a variable or a syntax template without memorizing the format.

## Installation

Once the plugin is in the community list: Settings, Community plugins, Browse, search for "Promptbox".

Before then, install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat) by adding the repository `istefox/promptbox`.

## Documentation

The full planning package (specification, ADRs, tiered plan) lives in [`docs/`](docs/): [MVP spec](docs/spec.md), [community-library spec](docs/spec-community.md), [implementation plan](docs/project.md), [Architecture Decision Records](docs/adr/README.md).

## License

[MIT](LICENSE)
