# Contributing to Promptbox

Thanks for your interest. The project is in early development (no plugin code yet); the planning package in `docs/` defines what gets built and in which order.

## Ground rules

- Read `docs/spec.md` and `docs/project.md` before proposing changes: work is sequenced in tiers, each with a definition of done.
- Architecture decisions live in `docs/adr/`. Decisions are immutable once accepted; propose a new ADR to supersede one.
- TypeScript `strict: true`, official Obsidian API only, no network calls in the MVP.

## Workflow

1. Open an issue describing the bug or proposal before writing code.
2. Branch from `main` using Conventional Branch names (`feature/`, `fix/`, `docs/`, `chore/`).
3. Use Conventional Commits v1.0.0 (`feat:`, `fix:`, `docs:`, ...).
4. Open a PR against `main`. CI (typecheck, lint, build) must be green.

## License

By contributing you agree that your contributions are licensed under the MIT license.
