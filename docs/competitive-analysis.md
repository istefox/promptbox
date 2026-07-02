# Promptbox Competitive Analysis

| | |
|---|---|
| Date | 2 Jul 2026 |
| Input | `docs/20260702_Promptbox_RicercaPlugin_v1.md` (competitor research, 8 plugins) |
| Promptbox baseline | `docs/spec.md` (MVP, Tiers 0-5 implemented), `docs/spec-community.md` (Phase 2), `docs/project.md`, ADR-0001/0002/0003, source at commit `a29c3a3` |
| Status | Analysis and proposal only. Nothing here is a requirement until it enters `spec.md` or `project.md`. |

Legend for competitor columns: TG = Text Generator, CP = Copilot for Obsidian, APM = AI Prompt Manager, PL = Prompt Library (karthyick), PC = PromptCrafter, SP = Smart Prompts, MW = Vault Prompt AI-Assistant (Magic Wand), OPL = Obsidian-Prompt-Library (Datacore component, not a plugin). Cell values: Y = offered, N = absent per the research note, ? = UNVERIFIED (the table does not state it either way; MW additionally has an unverified repo).

Promptbox column values: YES (implemented, Tiers 0-5), PLANNED(ID) (specced, not yet built), NO.

## 1. Feature matrix

| # | Feature (normalized) | TG | CP | APM | PL | PC | SP | MW | OPL | Promptbox |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 | Prompts stored as Markdown notes in a vault folder | Y | Y | ? | ? | N (in-note code blocks) | Y | ? | ? | YES (ADR-0001, FR-1) |
| F2 | Categories / structured taxonomy | ? | ? | Y (board columns) | Y | N | N | ? | Y | YES (FR-2.2, FR-8.2) |
| F3 | Tags | ? | ? | ? | Y (auto, 50+) | N | N | ? | Y | YES (native frontmatter tags) |
| F4 | Full-text search over the library | ? | ? | ? | ? | N | N | ? | Y ("advanced search") | YES (FR-2.4) |
| F5 | Combinable filters, sort, result count | N | N | N | ? | N | N | N | ? | YES (FR-2.2, FR-2.5) |
| F6 | Variables with interactive filling on use | Y (Handlebars) | Y (dynamic) | N | Y (`{{placeholder}}`) | Y (mustache) | Y | ? | N | YES (FR-4) |
| F7 | Variable defaults, hints, and choice dropdowns | N | N | N | N | N | N | N | N | YES (FR-4.1) |
| F8 | Context variables (active note, selection, etc.) | ? | Y | N | N | Y (vault content) | Y (`{{CURRENT}}`) | ? | N | NO |
| F9 | Vault-content transclusion / modular prompt composition | N | N | N | N | Y (wikilinks + frontmatter) | N | N | N | NO |
| F10 | Template logic (conditionals, loops, helpers) | Y (Handlebars) | N | N | N | N | N | N | N | NO |
| F11 | One-click copy to clipboard | ? | ? | Y | Y | ? | ? | ? | Y | YES (FR-2.6, FR-4.4) |
| F12 | Copy raw (placeholders untouched, escape hatch) | N | N | N | N | N | N | N | N | YES (FR-4.5) |
| F13 | Quick picker / command-palette recall | ? | Y ("/" command) | N | N | N | Y | ? | N | YES (FR-5, FR-6) |
| F14 | Kanban / board view | N | N | Y | N | N | N | N | N | NO |
| F15 | Prompt version history / iteration tracking | N | N | Y | N | N | N | N | N | NO (spec NG-3, see §5) |
| F16 | Automatic tagging / categorization | N | N | N | Y (mechanism ?) | N | N | N | N | NO |
| F17 | Favorites / pinned prompts | N | N | N | N | N | N | N | Y | NO |
| F18 | Local quality rating (1-5) with filtering | N | N | N | N | N | N | N | N | YES (schema §3.2, FR-2.2) |
| F19 | JSON export / import with conflict policy | N | N | N | N | N | N | N | N | YES (FR-7) |
| F20 | AI execution (send prompt to a provider, chat, inline test) | Y | Y | N | Y (Bedrock/Gemini/Groq) | N | Y (ChatGPT window) | Y | N | NO (spec NG-2, see §5) |
| F21 | Batch prompts / daily-note workflows | N | N | N | N | N | N | Y (?) | N | NO (see §5) |
| F22 | Insert AI response into note | Y | Y | N | N | N | N | Y | N | NO (execution-bound, see §5) |
| F23 | Community catalog: import shared prompts | Y (GitHub package registry) | N | N | N | N | N | N | N | PLANNED (CFR-3, CFR-4, Tier 8) |
| F24 | Community catalog: publish from the plugin | Y (via PR, maintainer merge) | N | N | N | N | N | N | N | PLANNED (CFR-1, Tier 9) |
| F25 | In-app submission with moderation queue, states, roles | N | N | N | N | N | N | N | N | PLANNED (CFR-2, Tier 9) |
| F26 | Community ratings and reporting | N | N | N | N | N | N | N | N | PLANNED (CFR-6, Tier 10) |
| F27 | Per-prompt sharing granularity (not whole packages) | N (package-level) | N | N | N | N | N | N | N | PLANNED (CFR-1.1) |
| F28 | Team sharing via Git of plain notes | Y (implicit) | Y (implicit) | ? | ? | Y (stated) | Y (implicit) | ? | ? | YES (portability, US-8: prompts are plain notes) |
| F29 | Mobile support | ? | ? | ? | ? | ? | ? | ? | N (Datacore) | YES (NFR-3, FR-2.7) |

Reading notes. Rows F1, F11, F28: for plugins storing prompts as plain notes, Git sharing and note portability follow from the storage model even where the research note does not state them. Row F16: the research note does not say whether Prompt Library's auto-tagging is heuristic or AI-based, so the mechanism is UNVERIFIED. MW's whole row is weak evidence, since its repo is unverified.

## 2. MISSING features

Features at least one competitor offers and Promptbox neither implements nor has specced. Ordered as in the matrix.

| ID | Feature | Offered by | Notes |
|---|---|---|---|
| M1 | Context variables: resolve active note title, selected text, or similar at copy time | Smart Prompts (`{{CURRENT}}`), Copilot, PromptCrafter | Fully local. Copilot's exact variable set is UNVERIFIED, but the capability itself is confirmed by Smart Prompts. |
| M2 | Vault-content transclusion: compose a prompt from other notes via wikilinks | PromptCrafter | Fully local, reads through the metadata cache. |
| M3 | Favorites / pinned prompts | Obsidian-Prompt-Library | Verified absent in Promptbox source (no favorite/pin field or UI). |
| M4 | Automatic tagging / categorization | Prompt Library | Mechanism UNVERIFIED. A local heuristic variant is proposable; an AI-based variant conflicts with no-network (see §5). |
| M5 | Kanban / board view | AI Prompt Manager | Doable with native primitives, but see priority rationale in §4. |
| M6 | Template logic (conditionals, loops) | Text Generator (Handlebars) | Local. Overlaps with copy-raw (FR-4.5), which already delegates rich templating to downstream tools. |

Not MISSING despite appearing in the table: community import/publish (F23, F24) is PLANNED (Tiers 8-9); prompt version history (F15) is an explicit spec non-goal (NG-3, §5); AI execution and everything depending on it (F20, F21, F22) is a non-goal (NG-2) and conflicts with no-network (§5).

## 3. ADVANTAGE features

Features Promptbox has (implemented, Tiers 0-5) that no competitor in the table offers.

| ID | Feature | Requirement | Why it matters |
|---|---|---|---|
| A1 | Variable defaults, hints, and choice dropdowns (`{{name\|default\|hint}}`, comma lists as dropdowns) | FR-4.1 | Competitors have plain placeholders at best. Guided filling with prefills is the core reuse UX. |
| A2 | Copy raw escape hatch | FR-4.5 | No competitor addresses prompts that target other templating engines. |
| A3 | JSON export/import with schema validation, conflict policy, round-trip guarantee | FR-7 | No competitor mentions backup or migration at all. |
| A4 | Local quality rating with threshold filter | schema §3.2, FR-2.2 | Only community-side ratings exist elsewhere, none local. |
| A5 | Combinable AND filters + incremental search + sort + result count in one view | FR-2 | Closest competitor (OPL) is a Datacore component, not an installable plugin. |
| A6 | Resilience contract: invalid frontmatter never hides an item or crashes the view | NFR-8 | No competitor states any tolerance behavior. |
| A7 | Declared mobile support | NFR-3, FR-2.7 | UNVERIFIED for all competitors, but none claims it; OPL cannot (Datacore). |
| A8 | Metadata-safe writes exclusively via the official frontmatter API | ADR-0001 | Robustness differentiator, invisible until a competitor corrupts a note. |

Planned advantage (from the research verdict, not yet built): in-app submission with a moderation queue, states and roles, post-publication moderation, per-prompt sharing (F25, F26, F27). The verdict states no plugin offers any of this; Text Generator's hub is package-level and requires GitHub PRs. This is the strongest strategic differentiator of Phase 2 and it is already fully specced (CFR-1..CFR-9).

## 4. Implementation project (MISSING features, prioritized)

Constraints applied to every entry: local-first with no network calls in Tiers 0-7, notes as single source of truth with frontmatter via the official API (ADR-0001), native Obsidian primitives only (ADR-0002), desktop and mobile. Effort: S < M < L. Priorities: P0 = next free slot after Tier 6/7, P1 = strong candidate post-MVP, P2 = worth speccing, P3 = parked.

### P0. M3 Favorites

One-line: boolean `favorite` frontmatter field, star toggle on cards and in the quick picker, "favorites first" sort and a filter chip.
Layers: domain (field in `Prompt` + tolerant parsing), storage (write via frontmatter API on explicit toggle), UI (library view, filter bar, quick picker).
Effort: S. Dependencies: Tiers 1-4 (all met).
Priority rationale: highest value-to-effort ratio in the list. Directly serves US-2/US-7 (find fast, mobile lookup), touches every layer only lightly, and the field stays readable in plain notes (US-8). Only OPL has it, and OPL is not an installable plugin, so this is also a de facto differentiator.

### P1. M1 Context variables

One-line: reserved placeholder namespace (proposal: `{{@selection}}`, `{{@title}}`, `{{@date}}`, `{{@clipboard}}`) resolved at copy time from the workspace state, skipped in the variable modal.
Layers: domain (parser extension in `placeholders.ts`, reserved-name detection), UI (copy flow gains workspace context; variable modal excludes context variables).
Effort: M. Dependencies: Tier 4 parser and copy flow (met).
Priority rationale: three competitors confirm demand. Fully local. Design cautions: the `@` prefix must not collide with FR-4.6 conservative parsing (a literal `{{@foo}}` for a downstream engine still round-trips via copy raw); `{{@selection}}` is empty when copy runs from the library view with no editor focused, so the resolver needs a defined fallback (empty string plus notice). Mobile: title and date always available, selection availability must be QA'd on iOS/Android.

### P2a. M4 Automatic tagging, local heuristic variant

One-line: suggest (never auto-write) tags and category in the create/edit modal from keyword frequency against the existing taxonomy and vault tags.
Layers: domain (suggestion scorer, pure function), UI (suggestion chips in the prompt modal).
Effort: M. Dependencies: Tier 3 modals (met).
Priority rationale: Prompt Library's headline feature, but its mechanism is UNVERIFIED and possibly AI-based. The local variant must stay suggestion-only: the spec rule that the plugin never rewrites frontmatter except on explicit user action forbids silent auto-tagging. Value is moderate at MVP library sizes; rises with library growth.

### P2b. M2 Vault-content transclusion

One-line: resolve `[[wikilink]]` references inside a prompt body to the linked note's content at copy time, with a preview step.
Layers: domain (resolver via metadata cache, cycle detection, depth cap 1), UI (confirmation/preview in the copy flow, size warning).
Effort: L. Dependencies: Tier 4 copy flow (met).
Priority rationale: PromptCrafter's differentiator and genuinely vault-native, a strong fit for positioning. Costly edges push it to P2: recursion and cycles, huge embedded notes, interaction with variable filling order (resolve links first, then variables), and behavior when links are broken. Copy raw must bypass resolution entirely.

### P3a. M6 Template logic

One-line: conditionals and loops in placeholders (Handlebars-like).
Layers: domain (parser rewrite), UI (modal complexity grows).
Effort: L. Dependencies: Tier 4.
Priority rationale: parked. Only one competitor has it, it multiplies parser edge cases against FR-4.6's conservative contract, drags a templating dependency against NFR-4 (minimal runtime dependencies), and copy raw already serves users who need rich templating downstream. Revisit only on repeated user demand.

### P3b. M5 Kanban / board view

One-line: board layout with columns by type or category, drag to re-categorize.
Layers: UI (new view mode, drag-and-drop), storage (category writes on drop).
Effort: L. Dependencies: Tier 2/3.
Priority rationale: parked. Vanilla drag-and-drop that is also touch-friendly (FR-2.7) is expensive, the only competitor offering it appears abandoned (v1.0.0, June 2025), and filters plus sort already cover the underlying need (triage by taxonomy). Weak value signal for the cost.

Suggested sequencing: P0 and P1 fit a single post-MVP tier (candidate "Tier 7.5" before Phase 2 starts, or folded into Tier 6 hardening scope only if the smoke test shows slack, which is unlikely). P2a/P2b each need a short spec addendum with FR IDs before implementation, per working agreements.

## 5. Phase 2+ and conflicting candidates

Competitor features that conflict with binding constraints. Flagged, not adapted.

| Feature | Offered by | Conflict | Disposition |
|---|---|---|---|
| AI execution: chat, generation, inline provider testing, send-to-ChatGPT | TG, CP, PL, SP, MW | Spec NG-2 (explicit non-goal) + no network in Tiers 0-7 + NFR-5 | Out of scope for the product, not just the MVP. Promptbox positions as the library next to these tools, not a replacement. Interop stays possible: prompts are plain notes any AI plugin can read (NG-7 keeps the data layout neutral). |
| Insert AI response into note | TG, CP, MW | Depends on execution (NG-2) | Out with execution. |
| Batch prompts, daily-note workflows | MW (UNVERIFIED repo) | Depends on execution; evidence weak | Out; do not spec against unverified features. |
| Community hub (import/publish) | TG | Network | Already scoped as Phase 2 (Tiers 8-10), opt-in and off by default per CFR-9.2, disclosure per CNFR-4. Promptbox's specced model (in-app submission, moderation queue, per-prompt granularity, ratings) exceeds TG's PR-based package registry. |
| AI-based auto-tagging (if that is PL's mechanism) | PL (mechanism UNVERIFIED) | Network + NFR-5 | Only the local heuristic variant proceeds (§4 P2a). If Phase 2 infrastructure ever hosts server-side tagging, that is a new ADR, not an assumption. |
| Prompt version history | APM | Spec NG-3 (explicit non-goal), not an ADR conflict | Technically feasible locally, but the spec deliberately excludes it: Obsidian File Recovery, Git, and Obsidian Sync already version notes, and prompts are plain notes. Revisit only via a spec change with the `version` field as the designed hook. |

## 6. Novel feature proposals

Proposals, not requirements. None of these appears in the competitor table. Ranked by differentiation value. Each needs interview/spec treatment before entering the plan.

### N1. Launcher integration via Obsidian URI (effort M)

Register an `obsidian://promptbox` URI action: look up a prompt by title or path, run the variable flow, land the result in the clipboard. Raycast, Alfred, and Shortcuts users get vault-stored prompts anywhere in the OS without opening Obsidian first.
Why no competitor has it: all of them assume the consumption point is inside Obsidian (a chat pane, the editor). Nobody treats the library as an OS-wide asset.
Why it fits: pure consumption of local notes, zero network, uses the official URI registration API. It extends "quick reuse" (the spec's stated purpose) beyond the vault boundary. Desktop-first value; a mobile URI path exists but the variable modal UX needs care.

### N2. Saved variable profiles (effort M)

Named value sets for placeholders (e.g. profile "Acme" fills `client`, `tone`, `context`), selectable in the variable modal, stored in `data.json` as reusable input aids, never in the notes.
Why no competitor has it: interactive filling elsewhere is at most a flat input form; nobody persists recurring answers.
Why it fits: directly compounds A1, the strongest implemented advantage. Profiles are ephemeral input helpers, so keeping them out of frontmatter preserves notes as the single source of truth.

### N3. Prompt linter (effort S/M)

An on-demand health check per prompt or library-wide: malformed placeholders that FR-4.6 silently skips, same variable declared with conflicting defaults, missing use_case, empty body, near-duplicate titles. Surfaced as a badge plus a report modal, never as an auto-fix.
Why no competitor has it: no competitor validates prompt quality at all; the only quality mechanisms in the table are community-side.
Why it fits: pure local analysis over the existing index, strengthens NFR-8's "visible warnings" philosophy, and later doubles as the local pre-flight for community submission (CFR-1.2), so it is Phase 2 groundwork disguised as a lint.

### N4. Usage recency tracking (effort S, one design decision required)

Record last-used date (and optionally a use count) on copy, enable "recently used" sort and a stale-prompts view.
Why no competitor has it: none tracks usage locally; cloud tools do, but that requires accounts.
Why it fits: local, tiny, high daily value in the picker. The open decision: a `last_used` frontmatter field keeps notes self-contained but means the plugin writes frontmatter on copy (a stretch of "explicit user action"), while `data.json` keyed by path avoids that but breaks the notes-own-everything rule and goes stale on renames outside vault events. Needs an explicit spec ruling before implementation.

### N5. Import-conflict diff preview (effort S)

When import (FR-7.3) hits a same-path conflict under the overwrite policy, show a body/metadata diff before committing the whole run.
Why no competitor has it: no competitor has import at all.
Why it fits: deepens A3 with pure UI over the already-implemented transfer layer, and directly de-risks the destructive branch of an existing MUST requirement. Also reusable in CFR-5.2 (community update with local modifications), so it is Phase 2 groundwork too.

### N6. Related prompts (effort S/M)

On a prompt's detail or in the edit modal, list nearest neighbors by shared tags, category, and title/body token overlap.
Why no competitor has it: OPL has search, nobody has similarity.
Why it fits: pure index computation, and it builds on the fact that prompts are real notes in a real vault (backlinks and tag structure already exist). Helps curation (US-5) as libraries grow toward the 1,000-prompt target.

### N7. Curated packs export (effort S)

Export a filtered set as a named "pack" (title, description, prompt list) on top of the existing schema_version 1 JSON, and recognize packs on import with a summary screen.
Why no competitor has it: TG's packages are community-hub artifacts requiring the hub; nobody has local pack exchange.
Why it fits: file-based sharing (email, Git, chat) with zero network, and it prototypes the catalog-entry shape Tier 8 needs, reducing Phase 2 risk.

### N8. Library statistics view (effort S)

A stats panel in the library view: counts by type/category/tag, quality distribution, oldest untouched prompts, taxonomy orphans (values used in notes but absent from settings).
Why no competitor has it: no competitor reports on the library as a corpus.
Why it fits: read-only render over the existing index, useful for curation, and taxonomy-orphan detection closes a real gap left by FR-8.2 (removing a taxonomy value never edits notes, so orphans accumulate silently).

Cross-cutting note: N3, N5, and N7 double as Phase 2 groundwork (pre-flight validation, update diffing, catalog entry shape). If Phase 2 remains the strategic bet, they outrank their standalone value.
