# Plan: launcher integration via `obsidian://promptbox` (FR-13)

Source: `SPEC.md` (topic `launcher-uri`), ADR-0008. Branch: `feat/launcher-uri`.

TDD scope: Task 1 is test-first and vitest-covered (`src/domain/*` is the only tested layer in this codebase — confirmed convention). Tasks 2-3 are `main.ts` glue with no automated harness (no `main.test.ts` exists for `PromptboxPlugin` today), verified instead by Task 4's manual smoke pass. This ordering is dependency-driven: Task 3 calls the function Task 1 builds and awaits the promise Task 2 introduces.

## Task 1 — Pure lookup: `src/domain/launcher.ts`

- [ ] Implement `resolveLauncherLookup`, satisfying FR-13.2/13.4/13.5, before touching `main.ts`.

**Files:**
- `src/domain/launcher.ts` (new)
- `tests/launcher.test.ts` (new)

**Contract:**
```ts
export interface LauncherParams { path?: string; title?: string }
export type LauncherLookupResult =
  | { kind: "picker" }
  | { kind: "match"; prompt: Prompt }
  | { kind: "no-match"; source: "path" | "title"; value: string };
export function resolveLauncherLookup(prompts: Prompt[], params: LauncherParams): LauncherLookupResult
```
Rules (ADR-0008): trim `path` and `title` first; both blank/absent → `{ kind: "picker" }`. `path` non-blank → exact `p.path === path` match, else `{ kind: "no-match", source: "path", value: path }`; `title` is **not** consulted when `path` is non-blank, even if it would also match a different prompt. Otherwise, `title` non-blank → case-insensitive, trimmed exact match against `p.title`; zero matches → `{ kind: "no-match", source: "title", value: title }`; two or more matches → the highest `updated` wins, ties broken by `path` ascending. No `obsidian` import in this file (keep it a pure, obsidian-free domain module).

**Test (write first, red before green):** in `tests/launcher.test.ts`, reuse the `normalizePrompt` + small `p(path, fm)` fixture-builder pattern already used in `tests/query.test.ts`. Build a fixture with at least: two prompts sharing a title with different `updated` values, and two prompts sharing a title with the *same* `updated` value (to exercise the secondary tie-break). Cases to cover:
  - no `path`/`title` given → `picker`.
  - blank `path` (`""`) and blank `title` (`""`) → `picker` (whitespace-only counts as blank too).
  - `path` matches an existing prompt → `match`.
  - `path` set to a value no prompt has → `no-match`, `source: "path"`.
  - `path` set (no match) **and** `title` also set to a value that *would* match another prompt → still `no-match/path`; title is never a fallback when path is present.
  - `title` matches case-insensitively and with surrounding whitespace (e.g. `" Code Review "` vs. stored `"Code Review"`) → `match`.
  - `title` set to a value no prompt has → `no-match`, `source: "title"`.
  - `title` shared by two prompts with different `updated` → the newer one wins.
  - `title` shared by two prompts with identical `updated` → `path`-ascending tie-break picks the deterministic winner.

  Run `npm test` (`vitest run`): all new cases green, none of the 8 pre-existing test files regressed.

## Task 2 — `main.ts`: track index readiness

- [ ] Make "the index has completed its first scan" independently awaitable, with zero behavior change to the existing startup sequence.

**Files:** `src/main.ts` (modify only).

**Change:** add `private indexReady!: Promise<void>;` alongside the existing `settings!`/`index!` fields (same definite-assignment style already used there). Wrap the existing `this.app.workspace.onLayoutReady(() => { void this.index.scan(); <4 registerEvent calls> })` block so the whole thing becomes:
```ts
this.indexReady = new Promise<void>((resolve) => {
  this.app.workspace.onLayoutReady(() => {
    void this.index.scan().then(() => resolve());
    // ...the same 4 registerEvent calls (create/delete/rename/changed), unchanged...
  });
});
```
Nothing else in that block changes — this task is a pure wrapper, not a behavior change, so it can be verified in isolation before Task 3 depends on it.

**Test:** no vitest (this is UI/plugin glue, outside this project's tested boundary). Manual check: `npm run dev`, load the plugin in a dev vault, confirm the library view still populates on open exactly as before (scan still completes once layout is ready) and that create/rename/delete/modify still update the index live. `npm run build` must stay green — a promise-executor mistake here is a type error, not just a runtime bug.

## Task 3 — `main.ts`: register the `promptbox` protocol handler

- [ ] Wire FR-13.1/13.2/13.3/13.4 end to end using Task 1's domain function and Task 2's readiness gate.

**Files:** `src/main.ts` (modify only).

**Change:** add imports: `resolveLauncherLookup` from `./domain/launcher`; `copyRaw, copyWithVariables` from `./ui/copy`; `type { ObsidianProtocolData }` from `"obsidian"` (for the handler's parameter type — avoids `any` under `strict: true`). In `onload`, near the other `addCommand` registrations:
```ts
this.registerObsidianProtocolHandler("promptbox", (params) => {
  void this.handleLauncherUri(params);
});
```
New private method:
```ts
private async handleLauncherUri(params: ObsidianProtocolData): Promise<void> {
  await this.indexReady;
  const path = typeof params.path === "string" ? params.path : undefined;
  const title = typeof params.title === "string" ? params.title : undefined;
  const raw = params.raw === "true";
  const result = resolveLauncherLookup(this.index.getAll(), { path, title });
  if (result.kind === "picker") {
    new PromptQuickPicker(this.app, this, raw).open();
    return;
  }
  if (result.kind === "no-match") {
    new Notice(`Promptbox: no prompt matching ${result.source} "${result.value}".`);
    return;
  }
  const body = this.index.getBody(result.prompt.path);
  if (raw) copyRaw(result.prompt.title, body);
  else copyWithVariables(this.app, result.prompt.title, body);
}
```
No changes to `src/ui/copy.ts`, `src/ui/quick-picker.ts`, or `src/storage/indexer.ts`: confirmed by grep that `copyWithVariables(app, title, body)`, `copyRaw(title, body)`, `new PromptQuickPicker(app, plugin, rawMode)`, and `index.getAll()`/`index.getBody(path)` are called here with the exact shapes their existing call sites already use — this task only adds new call sites, it does not change any existing contract, so no other file needs updating for this change.

**Test:** no vitest (same boundary as Task 2). Covered by Task 4's smoke pass.

## Task 4 — Verify: manual smoke pass + full suite

- [ ] Confirm every `SPEC.md` acceptance criterion and close out the cold-start risk before calling this done.

**Files:** none (verification only, no code changes).

**Manual steps**, in a dev vault with the built plugin loaded:
1. Warm-app cases (Obsidian already running and idle): `open "obsidian://promptbox?title=<a-prompt-with-placeholders>"` → Obsidian foregrounds, the variable modal opens, confirm → resolved body on the system clipboard. Repeat with `&raw=true` appended → clipboard gets the body verbatim, no modal. `?path=<vault-relative-path>` → the correct prompt is used regardless of its title. Two prompts sharing a title with different `updated` dates → the newer one is chosen. No parameters at all → the quick picker opens. `?title=Nope` (no such prompt) → a Notice naming the failed lookup, nothing copied.
2. Cold-start case (the risk ADR-0008 calls out specifically): fully quit Obsidian, then run `open "obsidian://promptbox?title=..."` from a terminal — confirm Obsidian launches, the vault opens, and the correct prompt is still resolved with no spurious "no prompt matching" Notice and no empty picker, even though the scan has to run first.
3. Unload check: disable and re-enable the plugin from Obsidian's settings; confirm no leftover behavior or console error tied to the protocol handler (store-guideline resource cleanup, NFR-7).

**Automated:** `npm run build && npm run lint && npm test` must be fully green, including the pre-existing test files, not just `tests/launcher.test.ts` — this change touches `main.ts`, which nothing currently exercises directly, but a regression in `src/domain/launcher.ts` or an accidental signature change elsewhere would still surface in the full run.

**HITL gate:** commit, push, and PR creation are human-approved steps per `CLAUDE.md` (`main` is branch-protected; PR required); this task ends at "ready to commit," not at a merged PR.
