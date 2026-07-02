# Promptbox Community Library Specification (Phase 2)

| | |
|---|---|
| Project | Promptbox community library: a shared, public repository of prompts contributed by plugin users |
| Document version | 0.1 (draft) |
| Date | 2 Jul 2026 |
| Status | Awaiting approval |
| Depends on | `spec.md` (MVP), ADR-0003 (distribution mechanism) |

## 1. Vision

The private library (MVP) becomes the on-ramp to one large shared catalog: any Promptbox user can publish a prompt, and every user can browse, search, and install prompts contributed by the community. Quality is protected by review before publication. The local library never depends on the community features: everything remote is additive and optional.

This document defines requirements, flows, and constraints. It is deliberately solution-neutral: the choice between a GitHub-based catalog and a hosted backend is made in `docs/adr/0003-community-distribution.md` against the requirements below.

## 2. Product owner decisions (fixed inputs)

These four decisions were made explicitly and drive the design:

1. **Publishing happens inside the plugin, one click.** No GitHub account or Git knowledge required from contributors.
2. **Contributor identity is an optional nickname.** No mandatory registration of any kind.
3. **Moderation is review before publication.** Nothing appears in the catalog without maintainer approval.
4. **Consumption scope includes all of**: catalog browse and search, one-click install into the vault, updates of installed prompts, ratings and feedback.

## 3. Definitions

- **Catalog**: the public, searchable set of approved community prompts plus its index.
- **Catalog entry**: one approved prompt with metadata (id, title, taxonomy, author nickname, version, dates, aggregate rating).
- **Submission**: a prompt sent from the plugin for review, not yet public.
- **Installed community prompt**: a local copy of a catalog entry inside the user's prompts folder, carrying provenance metadata.

## 4. Functional requirements

### CFR-1 Publish flow (one click, no accounts)

- CFR-1.1 From the library view or the edit modal, a "Publish to community" action is available on any local prompt.
- CFR-1.2 Pre-flight validation runs locally before sending: required frontmatter present, title and body non-empty, size limits respected, taxonomy values normalized.
- CFR-1.3 A confirmation step shows exactly what will be sent (title, metadata, body, optional nickname) and requires acceptance of the contribution license (see CFR-8) and content policy.
- CFR-1.4 On submit, the user receives a submission reference. The local note records provenance in namespaced frontmatter fields (`community_id`, `community_status`).
- CFR-1.5 The user can check submission status from the plugin: pending, approved (with catalog link), or rejected with a human-readable reason.

### CFR-2 Review pipeline (pre-publication)

- CFR-2.1 Every submission enters a moderation queue. It becomes public only after explicit maintainer approval.
- CFR-2.2 Automated checks run before human review: schema validation, size limits, duplicate detection, basic content screening. Failures reject early with a reason.
- CFR-2.3 Maintainers approve or reject with a reason. Target review effort: under 2 minutes per submission (tooling requirement, see CNFR-3).
- CFR-2.4 Approved entries appear in the catalog at the next index publish.

### CFR-3 Catalog browse and search

- CFR-3.1 A "Community" section in the plugin lists catalog entries with search and filters mirroring the local taxonomy (type, category, tags) plus sort by rating, downloads, and recency where available.
- CFR-3.2 Entry detail shows title, full body preview (rendered as plain text, never executed or interpreted), author nickname, version, updated date, aggregate rating.
- CFR-3.3 The catalog index is cached locally; browsing works from cache when offline, with a visible "last refreshed" indicator.

### CFR-4 One-click install

- CFR-4.1 Installing copies the entry into the local prompts folder as a normal prompt note, immediately usable by all MVP features.
- CFR-4.2 Provenance is recorded in frontmatter: `community_id`, `community_version`, `author`. Name collisions follow the MVP import policy (suffix).
- CFR-4.3 Installed prompts remain fully local property: editable, exportable, and untouched by catalog removals.

### CFR-5 Updates of installed prompts

- CFR-5.1 A manual "Check for community updates" command (plus an optional check when the community section opens) compares `community_version` of installed prompts against the catalog.
- CFR-5.2 Updates apply per prompt with one click. If the local body was modified after install, the plugin warns before overwriting and offers "keep mine" or "replace with catalog version".

### CFR-6 Ratings and feedback

- CFR-6.1 Users can rate an entry (1 to 5) and report an entry (with reason category). Both are anonymous and rate-limited.
- CFR-6.2 Aggregate ratings display in the catalog. Reports flag the entry for maintainer re-review.
- CFR-6.3 Rating integrity is best effort at this stage (no accounts): throttling and heuristics, accepted as imperfect. See risk R-1.

### CFR-7 Removal and takedown

- CFR-7.1 Maintainers can remove entries at any time (policy violation, takedown request). Removed entries disappear from the catalog at the next index publish.
- CFR-7.2 Already installed local copies are never touched remotely.

### CFR-8 Licensing of contributions

- CFR-8.1 Submissions are contributed under a permissive dedication (proposed: CC0 1.0) so redistribution through the catalog is legally clean. Final license choice is confirmed before phase 2 implementation.
- CFR-8.2 The license and content policy are shown and accepted at every publish (CFR-1.3).

### CFR-9 Offline and failure behavior

- CFR-9.1 All community features degrade gracefully: clear error notices, no retry storms, no impact on the local library.
- CFR-9.2 The MVP feature set never requires network access; community features are opt-in and disabled until first explicit use.

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| CNFR-1 | Privacy minimization | No accounts, no stored PII beyond the optional nickname; technical data (e.g. IP for rate limiting) kept only transiently for abuse prevention |
| CNFR-2 | Cost | Near-zero fixed monthly cost at launch; documented scale path before any paid tier is needed |
| CNFR-3 | Maintainability | Operable by one person; moderation tooling keeps review under ~2 min per submission; no component requiring routine server administration |
| CNFR-4 | Store compliance | Network use clearly disclosed in README (which remote services, what is sent, why), per Obsidian developer policies; no client-side telemetry; community features off until user opts in |
| CNFR-5 | Security | Catalog content treated as untrusted text: plain-text rendering, size caps, schema validation, no code execution paths |
| CNFR-6 | Availability | Catalog read path served through CDN-grade infrastructure; publish path may queue without data loss |
| CNFR-7 | Transparency | Catalog history and moderation outcomes auditable (mechanism-dependent, preferred) |
| CNFR-8 | Client compatibility | Community API/contract versioned so older plugin versions fail gracefully, never corrupt local data |

## 6. UX flows (reference)

**Publish**: select prompt → "Publish to community" → validation report → preview of payload + nickname field + license/policy checkbox → submit → notice with submission reference → status visible later via "My submissions".

**Browse and install**: open Community section → search/filter → entry detail → "Install" → note created in prompts folder → notice "Installed, available in your library".

**Update**: "Check for community updates" → list of installed prompts with newer catalog versions → per-item "Update" (diff warning if locally modified) → done summary.

**Rate/report**: entry detail → rate 1-5 or "Report" with reason → confirmation notice.

## 7. Content policy (draft, to finalize before phase 2 launch)

Accepted: prompts in any language, any lawful domain, with meaningful title, use_case, and taxonomy. Rejected: malware or harmful-activity instructions, personal data, copyrighted text the contributor cannot license, spam or advertising, duplicates without added value. Maintainer decisions are final; rejected submissions always carry a reason.

## 8. Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R-1 | Anonymous ratings are gameable | Misleading quality signal | Rate limiting, heuristics, display download counts alongside; accept imperfection in v1; revisit if abused |
| R-2 | Moderation bottleneck (single maintainer) | Slow approvals kill contribution momentum | Sub-2-minute review tooling, automated pre-checks, recruit co-maintainers when volume grows |
| R-3 | Spam or abusive submissions | Queue pollution, hosting abuse | Rate limits, size caps, early automated rejection, blocklists |
| R-4 | Legal exposure from contributed content | Takedown requests | License gate (CFR-8), content policy, pre-publication review, fast removal (CFR-7) |
| R-5 | Cost growth if adoption spikes | Unplanned spend | Static-first, CDN-cached reads; scale path documented in ADR-0003 |

## 9. Phasing inside phase 2

- **2a Read side**: catalog, browse, search, install, updates. Delivers user value first with the smallest attack surface.
- **2b Publish side**: in-plugin submission, review pipeline, moderation tooling.
- **2c Ratings and feedback**: rating submission, aggregation, reporting.

## 10. Out of scope for phase 2

Comments and discussion threads, user profiles and follower mechanics, private or team-scoped sharing, editing published entries by third parties (fork-style: install and republish is the model), monetization, and any form of prompt execution.

## 11. Open decisions

Distribution mechanism (option A GitHub-based vs option B hosted backend): decided in ADR-0003. Final contribution license and final content policy text: to confirm before phase 2 implementation starts.
