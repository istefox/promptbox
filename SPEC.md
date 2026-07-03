# SPEC — Usage recency tracking (Phase 1.5, from competitive-analysis §6 N4)

**Topic slug:** usage-recency-tracking

| | |
|---|---|
| Source | `docs/competitive-analysis.md` §6 N4 (approved 2026-07-03), `PROJECT.md` Phase 1.5 |
| Depends on | Tier 4 copy flow (met); ADR-0001, ADR-0002 binding; ADR-0009 precedent |
| Design | `docs/adr/0015-usage-recency-tracking.md` (data.json, keyed by path) |
| Effort | S |

## 1. Purpose

Record when each prompt was last copied (and how many times) so the library can sort by "recently used" and the user finds the prompts they actually reach for, not just the ones they last edited. The value grows with the library toward the 1,000-prompt target (NFR-1). The design decision required by §6 N4 is settled in ADR-0015: usage lives in `data.json` keyed by vault path, never in note frontmatter.

## 2. Requirements

### FR-23 Usage recency tracking (SHOULD)

- FR-23.1 **Record on copy.** On every successful copy of a prompt (copy-with-variables, copy-raw, quick picker, launcher URI including `raw=true`, and the `copy-prompt`/`copy-prompt-raw` commands), set the prompt's `lastUsed` to the current time and increment its `count`. Recording is best-effort: it never blocks or fails the copy, and a persistence error is swallowed with at most a console warning (NFR-8 spirit).
- FR-23.2 **Persist in `data.json`.** Usage is stored as `usage: Record<path, { lastUsed: ISO-8601, count: number }>` alongside `settings` and `profiles`, via the existing `loadData`/`saveData`. The save is debounced (one write per copy burst). Load is tolerant: a non-object `usage` degrades to `{}`, and individual malformed entries are dropped, never throwing (mirrors FR-14.1 for profiles).
- FR-23.3 **Prune orphans.** Usage keys whose path is absent from the current index are dropped lazily when the index is (re)built, and once after the first scan on load, bounding staleness left by note deletions or renames done outside Obsidian. Pruning is silent.
- FR-23.4 **Migrate on rename.** On a vault `rename` event the usage entry moves from the old path to the new path, so an in-Obsidian rename preserves the prompt's usage history.
- FR-23.5 **"Recently used" sort.** The library-view sort control gains a "Recently used" option. Prompts sort by `lastUsed` descending; never-used prompts sort last, tie-broken by the existing `updated-desc` order. The comparator is pure and vitest-covered; usage recency is injected into the query, never read from a note.
- FR-23.6 **No note writes, no new surface, no network.** The feature writes only `data.json`. It adds no frontmatter key, no settings-tab row, and no export/import field: `usage` is excluded from JSON transfer (like `favorite`), `schema_version` stays 1, and plain exports remain byte-identical to today.

## 3. Acceptance criteria

- AC-1 Copying a prompt (any of the six paths in FR-23.1), then reopening the library and selecting "Recently used" sort, places that prompt at the top; a later copy of a different prompt takes the top spot.
- AC-2 With a `data.json` whose `usage` is malformed (a string, or an entry missing `count`), the plugin loads normally, the bad data degrades to an empty or partial store, and nothing is thrown or logged as a crash (NFR-8).
- AC-3 Renaming a prompt note inside Obsidian preserves its position under "Recently used" (the usage entry followed the rename). Deleting a prompt, or renaming it outside Obsidian, leaves no visible effect after the next index rebuild (the orphan key is pruned).
- AC-4 A prompt never copied appears below every copied prompt under "Recently used", in the same relative order it would hold under "Recently updated".
- AC-5 A JSON export produced after prompts accrue usage is byte-identical to one produced before this feature (no `usage`, `lastUsed`, or `count` anywhere in the export), and no note file gains any frontmatter from copying.

## 4. Constraints

- Pure domain module `src/domain/usage.ts` (no Obsidian imports, 100% vitest-covered): `normalizeUsage`, `recordUsage(store, path, nowISO)`, `renameUsage`, `pruneUsage`, `usageRecencyMap`. Every function returns a new object; the clock (`nowISO`) is injected, never read inside the module. Mirrors `src/domain/variable-profiles.ts`.
- `src/ui/copy.ts` keeps its current `copyWithVariables` / `copyRaw` signatures; recording happens at the command call sites where `prompt.path` is already in scope (ADR-0015 Alternative 3).
- `src/domain/query.ts` change is additive: one new `SortKey` (`"recently-used-desc"`), one optional `LibraryQuery.usageRecency` field read only by the new comparator; every existing sort is untouched.
- No network calls anywhere (binding, ADR-0001/ADR-0002). No new settings field, no frontmatter, no note writes. `.claude/test-cmd` is authoritative and must not change.

## 5. Out of scope

- Displaying the copy count or last-used date on the card or in the modal (sort only; a visible counter can be a later, separate FR).
- A "stale by usage" or "most used" section in the library-statistics modal (ADR-0014's "10 oldest by `updated`" stays as the only stats staleness view; usage is a different axis).
- Ranking the quick picker by recency (the picker keeps native fuzzy relevance; a recency tiebreak is a possible follow-up).
- Historical backfill: "recently used" reflects only copies made after this feature ships.
- Configurable retention, per-prompt reset, or a "clear usage history" action.
