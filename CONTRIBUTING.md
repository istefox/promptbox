# Contributing to Promptbox

Thanks for your interest. The project is in early development (no plugin code yet); the planning package in `docs/` defines what gets built and in which order.

## Ground rules

- Read `docs/spec.md` and `docs/project.md` before proposing changes: work is sequenced in tiers, each with a definition of done.
- Architecture decisions live in `docs/adr/`. Decisions are immutable once accepted; propose a new ADR to supersede one.
- TypeScript `strict: true`, official Obsidian API only, no network calls in the MVP.

## Development

1. `npm install`, then `npm run dev` to start the esbuild watch build (esbuild rebuilds `main.js` on save).
2. Create a scratch Obsidian vault for development (do not use your real vault).
3. Link the plugin into the vault so Obsidian picks it up:
   ```bash
   ln -s "$(pwd)" "<vault>/.obsidian/plugins/promptbox"
   ```
   Copying `manifest.json`, `main.js`, and `styles.css` into that folder works too if you prefer not to symlink.
4. Enable Promptbox in Settings → Community plugins. Install the community [Hot-Reload](https://github.com/pjeby/hot-reload) plugin in the dev vault to reload Promptbox automatically on every rebuild; without it, toggle the plugin off and on after each change.
5. `npm run build` runs the typecheck plus a production bundle; `npm run lint` runs ESLint. Both must be green before a PR.

## Workflow

1. Open an issue describing the bug or proposal before writing code.
2. Branch from `main` using Conventional Branch names (`feature/`, `fix/`, `docs/`, `chore/`).
3. Use Conventional Commits v1.0.0 (`feat:`, `fix:`, `docs:`, ...).
4. Open a PR against `main`. CI (typecheck, lint, build) must be green.

## License

By contributing you agree that your contributions are licensed under the MIT license.
