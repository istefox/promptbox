# BRAINSTORM — Prompt chains

**Date:** 2026-07-14
**Requirements source:** requirements discussed in session (no SPEC.md yet for this feature)
**Techniques applied:** first-principles decomposition, assumption-busting, cross-domain analogies, genuinely-different alternatives, inversion/pre-mortem, adjacent ideas

## Reframed problem (first-principles)

Promptbox never calls an LLM and makes no network calls (ADR-0003 constraint holds across all tiers). So a "chain" cannot mean automatic execution against an AI API. The irreducible outcome is: let the user walk through an ordered sequence of existing prompt notes, copying each one out in turn, with the ability to carry the AI's answer from one step forward into the next step's variables — Promptbox orchestrates order and data hand-off, the user still runs each prompt externally and pastes the result back in.

## Challenged assumptions

- Each chain step is an existing prompt note, not free text typed only inside the chain — retained (real). Keeps notes as the single source of truth per ADR-0001, avoids a second place where prompt content can drift.
- The AI's output must be pasted back into Promptbox by hand to feed the next step (e.g. via a reserved variable) — retained (real). Direct consequence of the no-network constraint; Promptbox has no way to observe the external AI's answer on its own.
- Chains are fixed linear sequences, no branching or conditionals — retained (real). Matches the complexity level of every existing feature (all pure, deterministic domain modules) and keeps a first version tractable.
- A chain is its own entity (new note or new data.json record), not a field bolted onto an existing prompt — retained (real). A chain references N prompts by path, conceptually similar to how related-prompts (ADR-0012) already treats prompts as a graph of references.

## Approach alternatives

### Alternative A — Ephemeral chain (no persistence)
- **Idea:** the user composes a chain on the fly (multi-select in library view, or repeated picks via `FuzzySuggestModal`), runs it immediately through a wizard, and it disappears afterward.
- **Axis of difference:** deployment/persistence model — none.
- **Pros:** minimal implementation cost, no new frontmatter schema, no new storage.
- **Cons:** no reusable, nameable, or shareable chains — every run starts from scratch.
- **Indicative cost/time:** low.

### Alternative B — Chain as a vault note
- **Idea:** a new note type (e.g. `type: chain` frontmatter, `steps: [path1, path2, ...]`), living in the same or a dedicated folder, following the same tolerant-parsing rules as prompt notes.
- **Axis of difference:** deployment/persistence model — vault note, version-controlled with the rest of the library.
- **Pros:** consistent with ADR-0001 ("notes are the truth"), portable via git/vault sync, naturally exportable through curated packs (ADR-0013).
- **Cons:** requires a new frontmatter schema, a new create/edit UI surface, and new tolerant-parsing/lint handling for a second note type.
- **Indicative cost/time:** medium-high.

### Alternative C — Chain as a data.json record
- **Idea:** named chains stored in plugin data, each just an ordered list of prompt paths plus a name — the same storage pattern as variable-profiles (ADR-0009) and usage tracking (ADR-0015).
- **Axis of difference:** deployment/persistence model — plugin data, not a vault note.
- **Pros:** lighter to implement, reuses the existing `FuzzySuggestModal` picker pattern, no new note-parsing surface.
- **Cons:** not portable via vault sync/git unless the user also syncs `data.json`; breaks from the "notes are the truth" pattern that governs every content-bearing feature so far.
- **Indicative cost/time:** low-medium.

## Risks emerged (inversion / pre-mortem)

- Chain frontmatter points at prompts that get renamed/moved/deleted, silently breaking mid-execution → mitigation: tolerant parsing per NFR-8, plus a lint rule (ADR-0010 style) flagging chains with orphan steps.
- Manual copy-out/copy-back-in across every step is perceived as more friction than doing it without the plugin, so adoption stalls → mitigation: keep the wizard to the minimum number of clicks per step (one copy action, one paste target, auto-advance).
- A `{{@previous}}`-style variable has to coexist with the already-reserved `@` namespace (ADR-0005: `@selection/@title/@date/@clipboard`) without breaking existing parsing or duplicating what `{{@clipboard}}` already does → needs explicit design in the ADR step, not assumed away.
- A multi-step wizard modal becomes a second UI pattern alongside the existing `Modal` + `Setting` convention, adding a maintenance surface that can drift in style from the rest of the plugin.

## Adjacent ideas emerged

- Chains shown as cards in the library view, filterable/searchable like prompts, with a "chain" badge and step count — in-scope now (tag: to report back to SPEC).
- Shared variable profile carried across all steps of a chain, so the same values don't get re-entered at every step — in-scope now (tag: to report back to SPEC; builds on ADR-0009).
- Chains included in curated packs (ADR-0013) so a whole flow, not just individual prompts, can be exported/imported — future (tag: adjacent, not required for a first version).

## Preliminary recommendation

Alternative B (chain as a vault note) is the preliminary pick: it is the only option consistent with the project's core invariant that notes are the single source of truth, and it gets chain sharing "for free" through the existing export/curated-pack machinery instead of requiring a second sync story for `data.json`. The extra schema/UI cost is real but in line with the cost every other ADR in this project has already paid. This is not a binding decision — the architect should validate it against actual implementation cost before fixing the ADR.

## Notes for the architect

- **`{{@previous}}` vs `{{@clipboard}}` — resolved.** No new reserved variable: `{{@previous}}` resolves to the exact same value as `{{@clipboard}}` (ADR-0005), it is a display alias only. The chain-step variable-fill modal shows it with a dedicated label ("Previous step output") instead of "Clipboard" for clarity. Zero new parsing, zero namespace risk.
- **Step reference stability — resolved.** Chain steps store literal prompt paths (`steps: [path, ...]`), kept in sync via a vault rename-event listener that rewrites paths in chain notes automatically — same pattern already proven by `usage.ts` (ADR-0015). No wikilink-style reference (unverified whether Obsidian's automatic rename-tracking reliably covers frontmatter string arrays, not just body links — do not assume it without checking).
- **Lint coverage — resolved.** Chains get lint rules (orphan/broken step detection, extending ADR-0010) from the first release, not deferred. Directly addresses the top pre-mortem risk (silently broken chains).
- New requirement surfaced but not yet in a SPEC: shared per-chain variable profile across steps, already flagged as in-scope-now in Adjacent ideas — carry it into the interview step so it lands in the SPEC.
