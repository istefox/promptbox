# CLAUDE.md

## Project

Promptbox - Obsidian plugin: local-first library of AI prompts with categorization, search, and quick reuse.

See PROJECT_BRIEF.md for full context. The source of truth for requirements and sequencing is `docs/`: `docs/spec.md` (MVP), `docs/spec-community.md` (Phase 2), `docs/project.md` (tiered implementation plan), `docs/adr/` (decisions).

## Stack

- Language/runtime: TypeScript (`strict: true`), Obsidian plugin API (official API only)
- Project type: Obsidian community plugin, desktop and mobile (`isDesktopOnly: false`)
- Tooling: esbuild bundling, ESLint, GitHub Actions CI (set up in Tier 0 per ADR-0002)

## Architecture

- ADR-0001: prompts stored as plain Markdown notes with YAML frontmatter (accepted)
- ADR-0002: UI built on native Obsidian components with vanilla TypeScript, no framework (accepted)
- ADR-0003: community library via GitHub-based catalog with thin submission bridge (proposed, Phase 2)

See `docs/adr/README.md` for the full index.

## Git conventions

- Workflow: GitHub Flow (feature branch → PR → main, main is protected)
- Commits: Conventional Commits v1.0.0 (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`)
- Branches: Conventional Branch (`feature/`, `fix/`, `chore/`, `docs/`, `release/`)
- Default branch: main. Never force-push. Never commit directly to main.

## Commands

```bash
# Available after Tier 0 (toolchain setup); keep in sync with package.json
npm install
npm run dev      # esbuild watch build
npm run build    # typecheck + production build
npm run lint     # eslint
```

## Working agreements

- Run lint and tests before committing.
- Keep commits small and atomic, one logical change each.
- Update PROJECT_BRIEF.md "Status" section when a milestone is reached.
- No network calls anywhere in Tiers 0-7 (MVP is fully local; NG in spec.md §1.2).
- A tier does not start until the previous tier's definition of done is fully met (docs/project.md).
- Every implemented requirement references its ID (FR/NFR/US from spec.md, CFR/CNFR from spec-community.md).
- CI (typecheck, lint, build) must be green at the end of every tier.
