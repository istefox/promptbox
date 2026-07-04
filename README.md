# Promptbox

A local-first library of AI prompts for Obsidian. Each prompt is a plain Markdown note with YAML frontmatter, so your library stays readable, searchable, and portable even without the plugin. Nothing leaves your vault: there are no network calls and no accounts.

## Features

- Library view with full-text search, filters (type, category, tags, quality, visibility, date), and sorting, including favorites-first and recently-used.
- Create and edit prompts from a modal. The body lives in the note, so you edit it with the normal Obsidian editor.
- Copy with variables: fill `{{name}}` placeholders through a form, with defaults, hints, and `{{tone|formal,casual}}` choice dropdowns.
- Context variables resolved at copy time: `{{@selection}}`, `{{@title}}`, `{{@date}}`, `{{@clipboard}}`.
- A placeholder insertion palette: a command, inline `{{` autocomplete in the editor, and a button in the create modal, all offering context variables, names already used in your library, and syntax templates.
- Vault transclusion: `[[wikilinks]]` in a prompt body resolve to the linked note at copy time.
- A quick picker and an `obsidian://promptbox` launcher URI for reuse from outside the library view (Raycast, Alfred, Shortcuts).
- Variable profiles: save named sets of placeholder values and apply them from a dropdown.
- Favorites, a linter for common prompt problems, JSON import/export with curated packs, a statistics view, and usage-recency tracking.

## Usage

1. Open the library from the ribbon icon or the "Open library" command. Set the prompts folder in the plugin settings.
2. Create a prompt with "New prompt". The frontmatter holds the metadata; the note body is the prompt text.
3. Copy a prompt with the card actions, the quick picker, or the `obsidian://promptbox` URI. Placeholders open a fill-in form; the result goes to the clipboard.
4. While writing a prompt body, run "Insert placeholder" (or type `{{`) to insert a variable or a syntax template without memorizing the format.

## Installation

Once the plugin is in the community list: Settings, Community plugins, Browse, search for "Promptbox".

Before then, install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat) by adding the repository `istefox/promptbox`.

## Documentation

The full planning package (specification, ADRs, tiered plan) lives in [`docs/`](docs/): [MVP spec](docs/spec.md), [community-library spec](docs/spec-community.md), [implementation plan](docs/project.md), [Architecture Decision Records](docs/adr/README.md).

## License

[MIT](LICENSE)
