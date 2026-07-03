# ADR-0015: Usage recency tracking as plugin-local state in `data.json` keyed by path

| | |
|---|---|
| Status | Accepted |
| Date | 3 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `SPEC.md` (usage-recency-tracking), `docs/competitive-analysis.md` §6 N4, `PROJECT.md` Phase 1.5, ADR-0001, ADR-0002, ADR-0009, ADR-0004 |

## Context

`docs/competitive-analysis.md` §6 N4 proposes recording each prompt's last-used date (and a copy count) so the library can offer a "recently used" sort and surface prompts the user reaches for most. No competitor tracks usage locally; the cloud tools that do require an account. The value is local and daily: as a library grows toward the 1,000-prompt target (NFR-1), "what did I use last week" beats "what did I edit last."

§6 N4 flags one design decision that had to be settled before implementation: **where the usage state lives.** Two options were on the table.

- A `last_used` (plus `used_count`) **frontmatter field on the note**. Keeps the note self-contained and portable, but means the plugin writes the note file on every copy. Copy's intent is "put text on the clipboard," not "mutate the note"; a write on copy stretches the "explicit user action" principle, produces a file-modification event on every copy (sync churn, git noise, a bumped mtime), and ships a per-machine counter inside a portable artifact where it has no meaning.
- A **`data.json` map keyed by vault path**. No note writes, no sync churn, but it lives outside the notes (against the "notes own everything" instinct of ADR-0001) and a rename or delete done outside Obsidian's vault events leaves a stale key.

This ADR settles that decision and pins the surrounding design so the plan and the coder share one reading.

Binding background, not re-litigated here: ADR-0001 (notes are the source of truth; the in-memory index is disposable), ADR-0002 (native Obsidian UI, vanilla TypeScript, one `styles.css`, no network). Two internal precedents are load-bearing for the decision: ADR-0009 (variable profiles are plugin state stored in `data.json`, "never stored in notes") and ADR-0004 (favorites is a frontmatter field, but favorite is a user-meaningful attribute of the prompt that travels with an export).

## Decision

Store usage state in `data.json`, keyed by vault-relative path, behind a pure domain module. Record on every successful copy at the command call sites. Expose it as one new "Recently used" library sort. Write zero note frontmatter and make zero network calls.

### Persisted shape (`data.json`, alongside `settings` and `profiles`)

```ts
interface UsageEntry {
  lastUsed: string; // ISO 8601, e.g. "2026-07-03T21:14:05.000Z"
  count: number;    // total successful copies, >= 1
}
type UsageStore = Record<string, UsageEntry>; // key = vault-relative path
```

`usage` is plugin-local state, not a user-facing setting: no new row in the settings tab, no frontmatter key, and it is **excluded from JSON export/import** exactly as `favorite` is (transfer allowlist unchanged, `schema_version` stays 1). It is per-vault, per-machine telemetry, not prompt content.

### `src/domain/usage.ts` (new, no Obsidian imports, 100% vitest-covered)

```ts
export interface UsageEntry { lastUsed: string; count: number; }
export type UsageStore = Record<string, UsageEntry>;

/** Tolerant load: non-object input -> {}; malformed entries dropped, never throws (NFR-8, mirrors normalizeProfiles). */
export function normalizeUsage(raw: unknown): UsageStore;

/** Returns a new store with usage[path] = { lastUsed: nowISO, count: (prev.count ?? 0) + 1 }. Pure; caller supplies the timestamp. */
export function recordUsage(store: UsageStore, path: string, nowISO: string): UsageStore;

/** Returns a new store with the entry moved from oldPath to newPath (no-op if oldPath absent; newPath overwritten). */
export function renameUsage(store: UsageStore, oldPath: string, newPath: string): UsageStore;

/** Returns a new store containing only keys present in knownPaths (drops orphans from deletes / out-of-vault renames). */
export function pruneUsage(store: UsageStore, knownPaths: Set<string>): UsageStore;

/** path -> epoch ms of lastUsed, for injection into the query comparator; unparseable/absent -> 0. */
export function usageRecencyMap(store: UsageStore): Record<string, number>;
```

Every function is pure and returns a new object (no in-place mutation), matching the `variable-profiles.ts` style. `nowISO` is a parameter, not read inside the module, so the impurity (the clock) stays in `main.ts`.

### Recording (impure, at the command call sites)

A single `PromptboxPlugin.recordPromptUsage(path: string)` method: `this.usage = recordUsage(this.usage, path, new Date().toISOString())` followed by a **debounced** `saveData` (one write per copy burst, not one per keystroke of a variable modal). Recording is best-effort: any persistence error is swallowed with at most a `console.warn`, and it never blocks or fails the copy (NFR-8 spirit).

It is called after a **successful** copy at each site that lands prompt text on the clipboard, with `prompt.path` already in scope:

- the two library-view card actions (copy-with-variables, copy-raw),
- the quick picker (FR-5),
- the launcher URI handler (FR-13, both the variable flow and `raw=true`),
- the `copy-prompt` / `copy-prompt-raw` command-palette commands.

`copyWithVariables` / `copyRaw` in `src/ui/copy.ts` keep their current signatures unchanged (see Alternative 3).

### Query (`src/domain/query.ts`, additive)

- `SortKey` gains `"recently-used-desc"`.
- `LibraryQuery` gains an optional `usageRecency?: Record<string, number>` (path -> epoch ms), read **only** by the new comparator and ignored by every existing sort. The comparator orders by recency descending; a prompt with no usage entry (value `0`/absent) sorts **last**, tie-broken by the existing `updated-desc` order so never-used prompts keep a stable, familiar arrangement. Pure and vitest-covered; usage is injected, never read from a `Prompt`.

### Wiring (`src/main.ts`, `src/ui/library-view.ts`, `src/ui/filter-bar.ts` — additive)

- `onload`: `this.usage = normalizeUsage(data.usage)`; after the first index scan resolves, `this.usage = pruneUsage(this.usage, new Set(this.index.getAll().map(p => p.path)))` and persist if it changed.
- Register a `vault.on("rename", ...)` handler: `this.usage = renameUsage(this.usage, oldPath, file.path)` + debounced save, so an in-Obsidian rename preserves history. (`delete` needs no special case: the key is pruned on the next index rebuild; adding it to the existing `handleDelete` path is optional cleanup, not required.)
- `filter-bar.ts`: add a "Recently used" option to the sort control. `library-view.ts` builds `usageRecency: usageRecencyMap(this.plugin.usage)` into the `LibraryQuery` it already assembles, only when that sort is active.

## Alternatives considered

1. **`last_used` (+ `used_count`) frontmatter field on the note.** Rejected. It writes the note on every copy: a file-modification event, an mtime bump, sync/git churn, and a semantic stretch of "copy = explicit user action to change this note." Worse, usage is per-machine telemetry with no meaning inside a portable artifact, so it would ride along in every JSON export as noise. The favorites precedent (ADR-0004) does not carry over: `favorite` is a user-meaningful, intentionally-toggled, export-worthy attribute of the prompt; a copy counter is none of those. The variable-profiles precedent (ADR-0009, plugin state in `data.json`, never in notes) is the closer match and points the other way.
2. **In-memory only, on the disposable index entry / a view-model, never persisted.** Rejected. "Recently used" would reset on every Obsidian restart or plugin reload, which is exactly when a user most wants it. ADR-0001 makes the index disposable by design, so durable state cannot live there.
3. **Thread `path` and a timestamp through `copyWithVariables` / `copyRaw` in `copy.ts` and record centrally in the copy layer.** Rejected. `copy.ts` is a thin clipboard writer; recording is an orthogonal side effect. The `Prompt` (hence its path) is already in scope at every call site, so recording there keeps `copy.ts` signatures stable, the same signature-stability reasoning context-variables (ADR-0005) used to avoid touching call sites. `copyRaw(title, body)` does not even receive a path today; widening it would be a contract change for no gain.
4. **Full index rename support (a `handleRename` on `PromptIndex`), reused for usage.** Rejected as scope. The index already tolerates staleness and rebuilds from the metadata cache (ADR-0001); it needs no rename handler to be correct. Usage needs only its own two-line key migration. Bundling a broader index refactor into an effort-S feature is scope creep.
5. **A separate sidecar file (`.promptbox-usage.json`) instead of `data.json`.** Rejected. `data.json` is the sanctioned plugin-state store, already loaded and saved once per session, already holding `settings` and `profiles` (ADR-0009). A second file adds its own I/O, load-tolerance, and lifecycle for zero benefit.
6. **Debounce-free save (persist synchronously on every copy).** Rejected. A variable-modal copy can be one deliberate action, but rapid successive copies (or a picker used in a burst) would each hit disk. A short debounce coalesces a burst into one write; the in-memory `this.usage` is always current for the sort regardless.

## Consequences

**Positive:** zero note writes, so no sync churn, no git noise, no mtime bumps, and no surprise "copy changed my file" behavior. No new frontmatter key and no new settings row, so nothing to corrupt (NFR-8) and no export/import schema change (`schema_version` stays 1, transfer allowlist unchanged, plain exports byte-identical to today). The whole computational surface (normalize, record, rename, prune, recency map, and the new comparator) is pure and vitest-covered with no Obsidian mock, consistent with the project's "domain gets vitest, UI glue gets manual smoke" convention and directly mirroring `variable-profiles.ts`. The decision is consistent with ADR-0009, so the codebase keeps one coherent answer to "where does plugin-local state live."

**Negative and accepted:** a rename or delete performed outside Obsidian (git, Finder) does not fire a vault event, so a usage key can outlive its note until the next `pruneUsage` at index rebuild. This is a soft, self-healing degradation of non-critical telemetry, not corruption, and the lazy prune bounds it, the same disposable-derived-state posture ADR-0001 already takes for the index itself. Usage does not travel with an exported prompt; on a new machine or a fresh import, "recently used" starts empty. This is intended: usage is local, not prompt content. "Recently used" reflects only copies made after this feature ships, with no historical backfill.

**Neutral:** the existing library-statistics "10 oldest by `updated`" (ADR-0014) stays exactly as-is. It measures edit-time staleness, a different axis from usage recency; the two coexist and this feature adds no usage section to the stats modal (out of scope below). `PROJECT.md`'s Phase 1.5 checkbox for this feature is orchestrator-owned bookkeeping and is intentionally out of scope for both this ADR and its plan.

## References

- `SPEC.md` (root, this feature) — FR-23.1 through FR-23.6, acceptance criteria, out-of-scope list.
- `docs/competitive-analysis.md` §6 N4 — original proposal and the "one design decision required" this ADR settles.
- `PROJECT.md` Phase 1.5 — sequencing; this is the single remaining schedulable Phase 1.5 item (template logic, kanban, stay parked).
- ADR-0001 (`docs/adr/0001-storage-markdown-frontmatter.md`) — notes as source of truth, disposable index; binding background and the basis for accepting lazy prune.
- ADR-0002 (`docs/adr/0002-ui-native-obsidian-components.md`) — native UI, vanilla TypeScript, no network; binding background.
- ADR-0009 (`docs/adr/0009-variable-profiles.md`) — the `data.json` plugin-state precedent this decision follows (tolerant load, pure domain module, narrow deps injection).
- ADR-0004 (`docs/adr/0004-favorites.md`) — the frontmatter-field precedent, distinguished here (export-worthy user attribute vs. per-machine telemetry) and the transfer-exclusion pattern reused for `usage`.
- Internal precedent drawn on directly: `src/domain/variable-profiles.ts` (normalize/upsert pure-module shape), `src/domain/query.ts` (`SortKey`, `LibraryQuery`, comparator/tie-break conventions), `src/ui/copy.ts` (signature-stable copy entry points), `src/main.ts` (`registerEvent` vault/metadataCache listeners, `loadData`/`saveData`).
