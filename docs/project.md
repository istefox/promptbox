# Promptbox Implementation Plan

| | |
|---|---|
| Document version | 0.1 (draft) |
| Date | 2 Jul 2026 |
| Derived from | `spec.md`, `spec-community.md`, ADR-0001, ADR-0002, ADR-0003 |
| Scope of this session | Documentation only; no code written yet |

## How to read this plan

The project is split into **programming tiers**: incremental blocks that build on each other. Every tier ends with a verifiable output (something you can run, click, or measure) and a definition of done (DoD). A tier does not start until the previous tier's DoD is fully met. Size is relative effort: S < M < L.

Working agreements for all tiers:

- CI (typecheck, lint, build) green at the end of every tier.
- From Tier 2 onward, manual smoke test on desktop and at least one mobile platform before closing a tier.
- TypeScript `strict: true` from day one; official Obsidian API only; no network calls anywhere in Tiers 0-7.
- Every requirement ID (FR/NFR/US from `spec.md`, CFR/CNFR from `spec-community.md`) is referenced by the tier that discharges it.

Tier dependency chain:

```
T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7   [MVP complete]
                              T7 → T8 → T9 → T10   [Phase 2]
```

---

## Tier 0: Toolchain and plugin skeleton

Size S. Depends on: nothing.

Goal: a loadable, empty plugin with a professional build chain (ADR-0002 stack).

Steps:

1. Repository scaffold following the official sample-plugin layout: `manifest.json` (`isDesktopOnly: false`), `versions.json`, `styles.css`, entry point.
2. esbuild bundling, TypeScript `strict`, ESLint, `.editorconfig`, npm scripts (`dev`, `build`).
3. GitHub Actions CI: typecheck + lint + build on every push.
4. Development vault with a hot-reload workflow documented in `CONTRIBUTING.md`.

Verifiable output: the plugin installs in the dev vault, enables and disables cleanly, and shows one placeholder command in the palette.

DoD: CI green; plugin loads with zero console errors and unloads leaving no listeners behind; README stub, license, and `.gitignore` in place.

## Tier 1: Domain model and storage layer (ADR-0001)

Size M. Depends on: T0.

Goal: prompts on disk and a live in-memory index, no UI yet.

Steps:

1. `Prompt` domain type mirroring the frontmatter schema (`spec.md` §3.2), including tolerant parsing of unknown/invalid values (NFR-8) and namespaced phase-2 fields passthrough.
2. Settings store: prompts folder path, taxonomy value lists (type, category), default type. Defaults per spec.
3. Frontmatter read/write exclusively via Obsidian metadata APIs; `created`/`updated` handling; slug-based file naming with collision suffix (FR-3.1).
4. Indexer: initial async scan of the configured folder (deferred, NFR-2), then incremental updates from vault events (create, modify, delete, rename) (FR-1); folder change triggers re-index (FR-1.2).
5. Unit tests: frontmatter tolerance (hostile YAML fixtures), slug collisions, index consistency after event storms.

Verifiable output: a temporary debug command dumps the index; editing a note by hand updates the dump without reload.

DoD: FR-1 fully discharged; test suite covers parser and indexer edge cases and passes in CI; 1,000-prompt fixture vault indexes without blocking the UI thread.

## Tier 2: Library view, read-only (ADR-0002)

Size L. Depends on: T1.

Goal: browse, filter, search, sort. No editing yet.

Steps:

1. `ItemView` registered in a workspace tab; ribbon icon and "Open library" command (FR-2.1).
2. List rendering with title, type, category, tags, quality, updated, use_case (FR-2.6 display part).
3. Filter bar: type, category, tags multi-select, quality threshold, visibility; AND combination; clear-all (FR-2.2, FR-2.5).
4. Incremental full-text search over title, use_case, body, debounced, combined with filters (FR-2.4).
5. Sort control and result count (FR-2.5); date-range filter if schedule allows (FR-2.3 SHOULD).
6. Mobile layout pass: single column, touch targets (FR-2.7).
7. Performance measurement harness against the 1,000-prompt fixture (NFR-1).

Verifiable output: on the fixture vault, view opens under 500 ms, search updates under 100 ms per keystroke, measured and recorded in the PR description.

DoD: FR-2 (read-only parts) discharged; NFR-1 numbers recorded; smoke test desktop + mobile passed.

## Tier 3: Create, edit, delete

Size M. Depends on: T2.

Goal: full CRUD through the plugin.

Steps:

1. "New prompt" modal with all metadata fields plus initial body; dropdowns fed by taxonomy settings; tags chips with vault suggestions (FR-3.1, FR-3.4).
2. "Edit metadata" modal with `updated` refresh and one-click version bump (FR-3.2).
3. Item actions in the view: edit, open as note, delete with confirmation via Obsidian trash (FR-2.6 actions part); "Edit prompt metadata" command on active prompt note (FR-6.1 SHOULD).
4. Settings tab: folder picker, taxonomy editors (add, rename, remove, reorder), default type, hotkeys pointer (FR-8).

Verifiable output: create → edit → delete round trip from the view; taxonomy edits reflect in modals and filters immediately.

DoD: FR-3 and FR-8 discharged; US-1 and US-5 acceptance criteria pass; no default hotkeys shipped (NFR-7).

## Tier 4: Reuse engine (variables, clipboard, quick picker)

Size M. Depends on: T3.

Goal: the core value action: copy with guided variable filling.

Steps:

1. Placeholder parser for `{{name}}`, `{{name|default}}`, `{{name|default|hint}}` with the conservative rules of FR-4.1/4.2/4.6 (first occurrence wins, malformed left untouched). Pure function, exhaustively unit-tested.
2. Variable form modal: one field per unique variable, prefilled defaults, hint text; prompts without variables copy instantly (FR-4.2..4.4).
3. Clipboard write with confirmation notice and explicit mobile-safe error path (NFR-3).
4. "Copy raw" action (FR-4.5).
5. `FuzzySuggestModal` quick picker searching title, category, tags, use_case; secondary action for raw copy (FR-5).
6. Final command palette set: open library, new prompt, copy prompt, copy prompt raw, export JSON, import JSON (FR-6).

Verifiable output: US-3 and US-4 scenarios executed as written, on desktop and mobile.

DoD: FR-4, FR-5, FR-6 discharged; parser test suite includes unicode, nesting, adjacency, and empty-segment cases; US-3, US-4, US-7 pass.

## Tier 5: Import and export JSON

Size S. Depends on: T4.

Goal: backup and migration.

Steps:

1. Export all or the current filtered set to versioned JSON (`schema_version: 1`) (FR-7.1, FR-7.2).
2. Import with upfront schema validation, whole-import conflict policy (skip / overwrite / duplicate), and end-of-run summary (FR-7.3).
3. Round-trip automated test: export → import into empty folder → equivalence check (FR-7.4).

Verifiable output: US-6 executed between two real vaults, plus the automated round-trip test in CI.

DoD: FR-7 discharged; malformed and hostile JSON rejected with clear messages, nothing partially written.

## Tier 6: Hardening, performance, resilience

Size M. Depends on: T5.

Goal: the plugin behaves like store-quality software under abuse.

Steps:

1. Resilience pass: hostile YAML, duplicate titles, foreign files in the folder, folder renames, vault-wide operations (NFR-8).
2. Performance pass at 5,000 prompts; introduce list virtualization only if measurements demand it (NFR-1, spec §8 open point).
3. Mobile QA on iOS and Android: layouts, clipboard, modals (NFR-3).
4. Startup audit: deferred index, no blocking work on load (NFR-2).
5. Portability audit: disable plugin, verify notes fully readable; `data.json` is the only plugin-owned artifact (NFR-6, US-8).

Verifiable output: written QA checklist with results committed to the repo (`docs/qa/mvp-hardening.md`).

DoD: all NFRs verified with recorded evidence; zero console errors across the QA matrix.

## Tier 7: Release and store submission (MVP gate)

Size S. Depends on: T6.

Goal: public release conforming to Obsidian's requirements.

Steps:

1. Compliance checklist against the current official docs (developer policies, plugin guidelines, submission requirements): manifest correctness, description style, sentence-case UI copy, no default hotkeys, resource cleanup, README completeness. Re-verify the live process at execution time since requirements evolve.
2. Release automation: GitHub Action producing tagged releases with `manifest.json`, `main.js`, `styles.css`.
3. README with feature tour, screenshots, and (for phase 2 later) the network-use disclosure section placeholder.
4. Submission via the official process (PR to the community catalog / community portal) and iteration on reviewer feedback.

Verifiable output: public GitHub release installable via BRAT; submission filed.

DoD: `spec.md` §7 MVP acceptance gate fully satisfied; submission accepted or feedback loop actively in progress.

---

## Phase 2 tiers (community library, per ADR-0003 option A+)

Phase 2 starts only after the MVP gate and after ADR-0003 is formally accepted. Each tier maps to the phasing in `spec-community.md` §9.

## Tier 8: Community read side (2a)

Size L. Depends on: T7, ADR-0003 accepted, final license and content policy confirmed (`spec-community.md` §11).

Steps:

1. Public catalog repository: prompt file layout, JSON schema for `catalog.json`, CI validation, GitHub Action building the index on merge.
2. CDN read path (jsDelivr) with local cache and "last refreshed" indicator (CFR-3.3).
3. Community section in the plugin: browse, search, filters, plain-text entry detail (CFR-3, CNFR-5).
4. One-click install with provenance frontmatter and collision policy (CFR-4).
5. Update check and per-prompt update with local-modification warning (CFR-5).
6. Opt-in gate and README network disclosure (CFR-9.2, CNFR-4).

Verifiable output: a seeded catalog of test prompts browsable and installable from a clean vault, fully offline-tolerant.

DoD: CFR-3, CFR-4, CFR-5, CFR-9 discharged; catalog contract versioned (CNFR-8); network disclosure merged into README.

## Tier 9: Community publish side (2b)

Size L. Depends on: T8.

Steps:

1. Submission bridge (serverless worker): payload validation, size caps, rate limiting, PR creation via bot token; secrets confined to the bridge (ADR-0003).
2. In-plugin publish flow: pre-flight validation, payload preview, nickname, license and policy acceptance, submission reference, status check (CFR-1).
3. Review pipeline: PR template, CI pre-checks (schema, duplicates, content screening), maintainer playbook targeting sub-2-minute reviews (CFR-2, CNFR-3).
4. Takedown procedure (CFR-7).

Verifiable output: end-to-end publish from a clean vault: submit → PR appears → approve → entry live in catalog → status visible in plugin.

DoD: CFR-1, CFR-2, CFR-7, CFR-8 discharged; abuse tests (oversize, spam bursts) rejected at the bridge; bot token never present client-side.

## Tier 10: Ratings and feedback (2c)

Size M. Depends on: T9.

Steps:

1. Rate and report endpoints on the bridge, throttled and batched within free-tier write limits (ADR-0003).
2. Aggregation job writing rating summaries into the index; display in catalog UI alongside download counts (CFR-6).
3. Report-triggered re-review flow for maintainers (CFR-6.2).

Verifiable output: ratings submitted from two clients converge into the public index; a report flags the entry for review.

DoD: CFR-6 discharged with documented integrity limits (spec R-1); revisit triggers from ADR-0003 added to the maintainer playbook.

---

## Requirement coverage map

| Requirement block | Tier |
|---|---|
| FR-1 storage/indexing | T1 |
| FR-2 library view | T2 (+ actions in T3) |
| FR-3 create/edit, FR-8 settings | T3 |
| FR-4 variables, FR-5 picker, FR-6 commands | T4 |
| FR-7 import/export | T5 |
| NFR-1..8 | T2 (measure), T6 (verify), T7 (compliance) |
| US-1..8 | T2, T3, T4, T5, T6 (final check in T7 gate) |
| CFR-3/4/5/9 | T8 |
| CFR-1/2/7/8 | T9 |
| CFR-6 | T10 |

## Out of scope of this plan

Anything listed in `spec.md` §1.2 and `spec-community.md` §10, plus any code in the current documentation session.

