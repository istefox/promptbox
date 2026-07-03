# Project: Promptbox

## Overview
Obsidian plugin: local-first library of AI prompts with categorization, search, and quick reuse. Phase 1 and Phase 2 features map 1:1 to the tiers in `docs/project.md`; a tier starts only when the previous tier's DoD is met. Phase 1.5 features come from `docs/competitive-analysis.md` (§4 implementation project, §6 novel proposals); each entry references its section there.

## Phases

### Phase 1 — MVP (local library, Tiers 0-7)
- [x] Tier 0 toolchain and plugin skeleton  (completed: 2026-07-02)
- [x] Tier 1 domain model and storage layer  (completed: 2026-07-02)
- [x] Tier 2 library view read-only  (completed: 2026-07-02)
- [x] Tier 3 create edit delete  (completed: 2026-07-02)
- [x] Tier 4 reuse engine variables clipboard picker  (completed: 2026-07-02)
- [x] Tier 5 import and export JSON  (completed: 2026-07-02)
- [~] Tier 6 hardening performance resilience  (needs-human: mobile QA iOS/Android, manual dev-vault smoke test; excluded from nightly runs)
- [~] Tier 7 release and store submission  (needs-human: store submission and reviewer feedback loop; excluded from nightly runs)

### Phase 1.5 — Post-MVP: competitive parity and differentiation (source: docs/competitive-analysis.md; local-first, no network, ADR-0001/0002 binding)
- [x] favorites: boolean frontmatter field, star toggle in view and picker, filter chip and favorites-first sort (§4 P0, effort S)  (completed: 2026-07-03)
- [x] context variables: reserved placeholders {{@selection}} {{@title}} {{@date}} {{@clipboard}} resolved at copy time, skipped in the variable modal, copy-raw untouched (§4 P1, effort M)  (completed: 2026-07-03)
- [x] tag and category suggestions: local heuristic scorer, suggestion chips in create/edit modal, never auto-written (§4 P2a, effort M)  (completed: 2026-07-03)
- [x] vault-content transclusion: resolve [[wikilinks]] in prompt body at copy time, depth cap 1, cycle detection, preview step, copy-raw bypasses (§4 P2b, effort L)  (completed: 2026-07-03)
- [x] launcher integration: obsidian://promptbox URI action, lookup by title or path, variable flow, result to clipboard (§6 N1, effort M)  (completed: 2026-07-03)
- [x] saved variable profiles: named placeholder value sets in data.json, selectable in the variable modal (§6 N2, effort M)  (completed: 2026-07-03)
- [x] prompt linter: on-demand per-prompt and library-wide health check, badge plus report modal, never auto-fix (§6 N3, effort S/M)  (completed: 2026-07-03)
- [x] import-conflict diff preview: body/metadata diff before overwrite during JSON import (§6 N5, effort S)  (completed: 2026-07-03)
- [x] related prompts: nearest neighbors by shared tags, category, title/body token overlap (§6 N6, effort S/M)  (completed: 2026-07-03; note: scored on title/use_case per SPEC, not body)
- [x] curated packs export: named pack metadata on top of schema_version 1 JSON, pack-aware import summary (§6 N7, effort S)  (completed: 2026-07-03)
- [x] library statistics view: counts by taxonomy, quality distribution, stale prompts, taxonomy orphans (§6 N8, effort S)  (completed: 2026-07-03)

Parked, not scheduled (do not pick up): template logic (§4 P3a), kanban board view (§4 P3b), usage recency tracking (§6 N4, blocked on a spec ruling: frontmatter write on copy vs data.json state).

### Phase 2 — Community library (Tiers 8-10, requires ADR-0003 accepted)
- [~] Tier 8 community read side  (needs-human: blocked on Tier 7, ADR-0003 acceptance, final license and content policy; excluded from nightly runs)
- [~] Tier 9 community publish side  (needs-human: blocked on Tier 8)
- [~] Tier 10 ratings and feedback  (needs-human: blocked on Tier 9)
