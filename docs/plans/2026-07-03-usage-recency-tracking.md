# Plan: Usage recency tracking (FR-23, ADR-0015)

Source: `SPEC.md` (root), `docs/competitive-analysis.md` §6 N4. Design: `docs/adr/0015-usage-recency-tracking.md` (usage in `data.json`, keyed by path). Single remaining schedulable Phase 1.5 feature.

Observable-contract changes are additive only: one new `SortKey` value, one new optional `LibraryQuery` field, one new sort option in the UI, one new `data.json` key (`usage`). No existing function signature, command id, frontmatter shape, settings field, or export/import field changes. `copy.ts` signatures stay stable (ADR-0015 Alt 3); `usage` is excluded from JSON transfer (allowlist unchanged, `schema_version` stays 1).

Full authoritative test command (run after every task, not just task 1's new file): `npm run build && npm run lint && npm test`.

## Task 1 — Domain module: `src/domain/usage.ts` (TDD)

Goal: the pure usage store per ADR-0015. Write the tests first; they fail against a stub, then pass once implemented.

Files:
- `tests/usage.test.ts` (new) — mirror `tests/variable-profiles.test.ts` style (plain fixtures, `describe` per function).
- `src/domain/usage.ts` (new) — exports `UsageEntry`, `UsageStore`, `normalizeUsage`, `recordUsage`, `renameUsage`, `pruneUsage`, `usageRecencyMap`, exact shapes per ADR-0015's Decision section. No Obsidian import.

Test cases (vitest):
- `normalizeUsage`: a valid map round-trips; `null`/`undefined`/a string/an array -> `{}`; an entry missing `count` or `lastUsed`, or with wrong types, is dropped while sibling valid entries survive; a negative or zero `count` is dropped (count must be >= 1).
- `recordUsage`: on an absent path, creates `{ lastUsed: nowISO, count: 1 }`; on an existing path, sets `lastUsed = nowISO` and `count = prev + 1`; returns a **new** object, input not mutated; the supplied `nowISO` is stored verbatim.
- `renameUsage`: moves the entry from old to new key; no-op when old key absent; overwrites new key if it already existed; returns a new object.
- `pruneUsage`: keeps only keys in `knownPaths`; empty `knownPaths` -> `{}`; returns a new object; a store with no orphans is returned equal in content.
- `usageRecencyMap`: maps each path to the epoch-ms of its `lastUsed`; an unparseable `lastUsed` -> `0`; empty store -> `{}`.

Run: `npm test` while iterating; full command before moving on.

## Task 2 — Query comparator: `"recently-used-desc"` (TDD)

Goal: the new sort, injected with usage recency, never-used prompts last, tie-break `updated-desc` (FR-23.5). Extend the existing query tests.

Files:
- `tests/query.test.ts` (modify) — add a `describe("recently-used-desc")`: prompts with distinct `lastUsed` order by recency descending; a never-used prompt sorts after every used one; two never-used prompts fall back to `updated-desc`; two prompts with identical recency fall back to `updated-desc`; absent `usageRecency` (undefined) sorts everything by the `updated-desc` fallback without throwing.
- `src/domain/query.ts` (modify, additive) — add `"recently-used-desc"` to `SortKey`; add optional `usageRecency?: Record<string, number>` to `LibraryQuery`; in `baseComparator`, handle the new key: compare `usageRecency[a.path] ?? 0` vs `?? 0` descending, then delegate to the existing `updated-desc` comparator for ties and for the all-zero case. Every other `SortKey` branch is untouched.

## Task 3 — Plugin wiring: record, persist, prune, rename

Goal: load/persist `usage`, record on every copy path, prune orphans, migrate on rename (FR-23.1-23.4). No note writes.

Files:
- `src/main.ts` (modify):
  - Field `usage: UsageStore`; in `onload` after `loadData`, `this.usage = normalizeUsage(data.usage)`.
  - Wherever `settings`/`profiles` are persisted, include `usage` in the saved object (extend the existing save shape; do not create a second save path). Add a `recordPromptUsage(path: string)` method: `this.usage = recordUsage(this.usage, path, new Date().toISOString())` then a **debounced** save (reuse Obsidian's `debounce`, ~500 ms). Swallow save errors with `console.warn` (FR-23.1).
  - After the first index scan resolves (reuse the existing `indexReady`/first-scan hook from ADR-0008), `this.usage = pruneUsage(this.usage, new Set(this.index.getAll().map((p) => p.path)))` and persist only if it changed.
  - Register `this.registerEvent(this.app.vault.on("rename", (file, oldPath) => { if (file instanceof TFile) { this.usage = renameUsage(this.usage, oldPath, file.path); <debounced save>; } }))`.
  - Call `recordPromptUsage(prompt.path)` after a successful copy in the `copy-prompt` and `copy-prompt-raw` command callbacks and the launcher URI handler (both the variable flow and `raw=true`).
- `src/ui/library-view.ts` (modify): call `this.plugin.recordPromptUsage(prompt.path)` after the two card copy actions succeed; when the active sort is `"recently-used-desc"`, add `usageRecency: usageRecencyMap(this.plugin.usage)` to the `LibraryQuery` it assembles.
- `src/ui/quick-picker.ts` (modify): call `recordPromptUsage(prompt.path)` after the picker's copy completes.

Manual smoke (UI glue, no vitest for these files) — record before done:
- Copy a prompt via each path (card ×2, picker, command ×2, URI); confirm `data.json` gains a `usage` entry with `count` incrementing and `lastUsed` advancing; confirm the note file is unchanged (no new frontmatter, mtime only from unrelated edits).
- Switch the library sort to "Recently used": the just-copied prompt is first; copy another, reopen/re-sort, it takes first.
- Rename a used prompt inside Obsidian: it keeps its recency position. Delete one: after the view refreshes/reloads, no error and the orphan key is gone from `data.json` on next rebuild.
- Corrupt `usage` in `data.json` by hand (set it to `"x"`): reload the plugin — loads clean, no crash (AC-2).

## Task 4 — Transfer exclusion check and full verification

Goal: confirm `usage` never leaks into export/import and nothing regressed (FR-23.6, AC-5).

Files: none (verification only). Do not edit `PROJECT.md` (orchestrator-owned) or `docs/adr/README.md` (updated alongside ADR-0015).

Test:
- Grep the transfer layer (`src/storage/transfer-io.ts`, `src/domain/transfer.ts` or equivalent): confirm `usage`/`lastUsed`/`count` appear in no export mapping and no import allowlist; export a library that has accrued usage and diff it against the pre-feature export shape — byte-identical (AC-5).
- Grep `src/domain/usage.ts` for any Obsidian import or write-capable call — expect none.
- Run the full authoritative command: `npm run build && npm run lint && npm test` — green (typecheck, production build, lint, entire vitest suite, not only the new files).
- Re-walk all 5 SPEC.md acceptance criteria (AC-1..AC-5) in a real or test vault.

## Task checklist

- [ ] Task 1 — `src/domain/usage.ts` pure module, TDD, vitest-covered.
- [ ] Task 2 — `"recently-used-desc"` comparator + `LibraryQuery.usageRecency`, query tests extended.
- [ ] Task 3 — Plugin wiring (record/persist/prune/rename) across main, library-view, quick-picker; manual smoke recorded.
- [ ] Task 4 — Transfer-exclusion confirmed, full build/lint/test green, AC-1..AC-5 re-verified.
