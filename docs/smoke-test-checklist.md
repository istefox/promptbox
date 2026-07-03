# Promptbox Dev-Vault Smoke Test Checklist

Manual verification in a real Obsidian vault. Covers the Tier 0-5 base flow and every Phase 1.5 feature. This is the human gate behind Tier 6 QA and release; the automated suite (typecheck, lint, 208 vitest cases, production build) is green but exercises no UI.

Mark each row `[x]` on pass, note the failure inline on fail. Features flagged by the nightly run as having an outstanding manual smoke: **launcher-uri, import-diff-preview, related-prompts, library-statistics**.

## Setup

- [ ] Dev vault open in Obsidian (desktop, app version >= 1.5.0).
- [ ] Latest `main.js` + `manifest.json` + `styles.css` deployed to `<vault>/.obsidian/plugins/promptbox/`, plugin enabled.
- [ ] Settings > Promptbox: prompt folder set to a known folder; add a few Type and Category values.
- [ ] Seed at least 6 prompts: some sharing tags/category, at least one with `{{placeholders}}`, one with a `[[wikilink]]` in its body, one marked public with a bumped version.

## A. Base flow (Tiers 0-5)

### A1. Library view
- [ ] Ribbon icon (library) opens the Promptbox library tab. Command `Open library` does the same.
- [ ] All seeded prompts render as cards; no console errors.
- [ ] Search box filters by title/use_case as you type.
- [ ] Type/Category/tag filters narrow the list; clearing restores it.
- [ ] Sort control changes card order.

### A2. Create
- [ ] Command `New prompt` opens the create modal.
- [ ] Submitting with an empty Title is blocked (validation message).
- [ ] Fill all fields, submit: a new `.md` file appears in the prompt folder with correct YAML frontmatter; card shows in the view.

### A3. Edit
- [ ] Command `Edit prompt metadata` (or the card edit action) opens the edit modal prefilled.
- [ ] Change Category and add a tag, save: frontmatter updates; card reflects the change.
- [ ] The edit modal does not offer body editing (body lives in the note by design, FR-3.3).

### A4. Delete
- [ ] Delete a prompt from the view: file removed from the folder, card disappears, no orphan in the index.

### A5. Copy with variables
- [ ] `Copy prompt` on a prompt with `{{name}}` placeholders opens the variable modal.
- [ ] Fill values, confirm: resolved text is on the clipboard (paste to verify), placeholders substituted.
- [ ] Enter submits the variable modal (keyboard path).

### A6. Copy raw
- [ ] `Copy prompt (raw)` copies the body verbatim, placeholders and wikilinks unresolved, no modal.

### A7. Quick picker
- [ ] The fuzzy quick picker lists prompts; selecting one runs the copy flow.

### A8. Export / Import (round-trip)
- [ ] `Export prompts (JSON)` writes a JSON file (or opens a save dialog); note the destination path in the Notice.
- [ ] `Import prompts (JSON)` on that same file in a clean folder recreates the prompts faithfully.

## B. Phase 1.5 features

### B1. Favorites (ADR-0004)
- [ ] Star toggle on a card sets `favorite: true` in frontmatter; unstar removes the key (not `favorite: false`).
- [ ] Favorites filter chip shows only starred prompts.
- [ ] With favorites-first sort, starred prompts lead at equal rank.
- [ ] Quick picker floats favorites up only at equal fuzzy score.

### B2. Context variables (ADR-0005)
- [ ] A prompt using `{{@date}}` resolves to today's date on copy, no modal prompt for it.
- [ ] `{{@title}}` resolves to the active note title; `{{@selection}}` to the current editor selection.
- [ ] Empty selection with `{{@selection}}` leaves it unresolved and shows a Notice; empty clipboard with `{{@clipboard}}` resolves silently (no Notice).
- [ ] A user `{{name}}` placeholder alongside a context one still opens the variable modal for the user value only.

### B3. Tag / category suggestions (ADR-0006)
- [ ] Create modal: typing in Title/body surfaces tag chips (top 5) and category chips (top 3).
- [ ] Clicking a chip fills the field; nothing is auto-applied without a click.
- [ ] Typing does not steal focus (chips refresh in place).

### B4. Vault transclusion (ADR-0007)
- [ ] A prompt body with `[[target]]` / `![[target]]`: `Copy prompt` shows the transclusion preview modal with resolved sizes.
- [ ] Confirm: linked note body is spliced in, frontmatter stripped, depth capped at 1 (nested links in the target are not expanded).
- [ ] Unresolved link (missing note, or `#heading`/`^block` ref) shows the unresolved-links Notice.
- [ ] `Copy prompt (raw)` bypasses transclusion entirely.
- [ ] A >50k assembled body triggers the size warning.

### B5. Launcher URI (ADR-0008), nightly flag: cold-start
- [ ] From outside Obsidian, `obsidian://promptbox?title=<known title>` copies that prompt (runs the variable flow if needed).
- [ ] `obsidian://promptbox?path=<vault-relative path>` resolves by path; when both `path` and `title` are given, `path` wins.
- [ ] `obsidian://promptbox?...&raw=true` copies raw (also applies to the picker fallback).
- [ ] `obsidian://promptbox` with no params opens the quick picker.
- [ ] **Cold start:** trigger the URI with Obsidian closed so it launches the app; the lookup still succeeds (waits on the first index scan, no race, no "not found" flash).

### B6. Variable profiles (ADR-0009)
- [ ] Save a set of placeholder values as a named profile from the variable modal; it persists to `data.json` (not into any note).
- [ ] Reopen the variable modal for a matching prompt: the profile dropdown lists only profiles with >= 1 matching key.
- [ ] Selecting a profile fills the matching fields; non-matching fields stay empty.

### B7. Prompt linter (ADR-0010)
- [ ] Command `Lint library` opens the report modal listing rule hits (L1-L7).
- [ ] A prompt with a malformed placeholder / empty body / missing use_case or category / duplicate title appears under the right rule.
- [ ] The card badge is clickable and opens the report scoped to that prompt.
- [ ] Nothing is auto-fixed.

### B8. Import-conflict diff preview (ADR-0011), nightly flag
- [ ] Import a JSON whose prompts collide with existing ones, overwrite policy selected: the per-conflict preview shows before any write.
- [ ] Fields render old -> new; body shows +N/-N line counts; unchanged prompts read "identical".
- [ ] `created` / `updated` date changes are surfaced in the preview (silent date rewinds visible).
- [ ] Cancelling writes nothing; confirming applies exactly what the preview showed.

### B9. Related prompts (ADR-0012), nightly flag: live-vault
- [ ] Open the edit modal on a prompt that shares tags/category with others: a "Related" section lists up to 5 neighbors.
- [ ] Ranking favors shared tags over category over title/use_case token overlap.
- [ ] A prompt with no overlap shows an empty/absent related list, no error.
- [ ] Create mode (new prompt) does not attempt to compute related.

### B10. Curated packs (ADR-0013)
- [ ] "Export as pack…" from a filtered view prompts for pack name/description and writes JSON with a `pack` header.
- [ ] Importing that pack shows the pack banner (name/description) in the import summary.
- [ ] The `pack` header never lands in any created note.
- [ ] A plain (non-pack) export is byte-identical to the pre-pack export format.

### B11. Library statistics (ADR-0014), nightly flag: live-vault
- [ ] Command `Library statistics` opens the stats modal.
- [ ] Totals, top-10 tag counts, and quality distribution render; buckets sum to the total.
- [ ] The 10 oldest prompts list is correct by `created`/`updated`.
- [ ] Orphan taxonomy values (types/categories defined but unused, or custom values) appear with usage counts.

## C. Resilience (NFR-8)

- [ ] Hand-corrupt one prompt's frontmatter (invalid YAML) in the note: the view still renders, that card degrades gracefully, no crash, no console throw.
- [ ] Plugin disable then re-enable: no leaked views, listeners, or duplicate ribbon icons (clean load/unload).

## Result

- [ ] All base (A) rows pass.
- [ ] All Phase 1.5 (B) rows pass, nightly-flagged features confirmed.
- [ ] Resilience (C) rows pass.
- [ ] Failures logged as issues before marking Tier 6 QA complete.
