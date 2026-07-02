# Implementation plan — Favorites

| | |
|---|---|
| Date | 3 Jul 2026 |
| Source | `SPEC.md` (FR-9), `docs/adr/0004-favorites.md` |
| Test command | `npm run build && npm run lint && npm test` |

## Testing boundary (read before starting)

Pure domain logic (`src/domain/prompt.ts`, `src/domain/query.ts`) gets exhaustive `vitest` coverage, TDD-style: write the failing test, then the implementation. Obsidian-API-coupled glue (`src/storage/prompt-writer.ts`, `src/ui/*`) has **zero** unit tests anywhere in this codebase today — `createPrompt`, `updatePrompt`, `deletePrompt`, `library-view.ts`, `filter-bar.ts`, and `quick-picker.ts` are all verified only by manual smoke test, because `tests/mocks/obsidian.ts` deliberately stubs the `obsidian` module down to three classes and "domain and indexer code must not import obsidian at all" (its own header comment). This plan follows that existing boundary rather than inventing new App/TFile mocking infrastructure for a handful of small functions; where a task's file falls on the glue side, its "Test" line says so explicitly and points at the manual smoke check instead.

Acceptance criteria → task mapping (all four from `SPEC.md` §3):

- "Toggle a card's star ... star fills ... plain readable note" → Task 4.
- "Enable the Favorites filter with `type=task` ... count updates" → Tasks 2 + 5.
- "Quick picker: favorites appear with star and rank first among equal matches" → Task 6.
- "Malformed value (`favorite: "yes please"`) → treated as false, warning-free render" → Task 1.

Observable-contract check (done up front, not left for the coder to discover): every `Prompt`-typed construction site in the repo goes through `normalizePrompt` (grepped across `src/`, `tests/` — production code via `readPromptFromCache`, every test via a local `p()`/`prompt()`/`makePrompt()`/`fixture()` helper that wraps `normalizePrompt`). No test does a whole-object `toEqual` against a `Prompt`; the only whole-object `toEqual` calls are against `p.custom` (a sub-object, unaffected) and against `ExportedPrompt`/transfer entries (a different, deliberately-untouched type — see ADR-0004). Adding a required `favorite: boolean` field is therefore additive everywhere except the two files this plan already edits (`prompt.ts`, `prompt.test.ts`). `LibraryQuery` is transient view state, never persisted; its only consumers are `query.ts`, `filter-bar.ts`, `library-view.ts`, and `query.test.ts`/`perf.test.ts` — all either edited by this plan or unaffected because they use `emptyQuery()`/spreads rather than field-by-field literals. No other file needs a companion fix.

## Tasks

- [x] **1. Domain: `favorite` field with silent tolerant parsing**
  - Goal: add `favorite: boolean` to the `Prompt` interface in `src/domain/prompt.ts`; add `"favorite"` to `KNOWN_FIELDS`; parse with a strict `value === true` check that **never** pushes to `warnings`, unlike every other field in this file. Add a code comment at the parse site stating this is intentional (FR-9.1's "warning-free render" acceptance criterion), so it is not "corrected" into symmetry later.
    ```ts
    function readFavorite(value: unknown): boolean {
      // Deliberately silent: FR-9.1 requires absent/invalid values to fall back
      // to false with a warning-free render, unlike every other field above.
      return value === true;
    }
    ```
  - Files: `src/domain/prompt.ts` (modify), `tests/prompt.test.ts` (extend).
  - Test (write first): in `tests/prompt.test.ts`, add a `describe("favorite (FR-9.1)")` block asserting — `favorite: true` → `true`, `warnings` empty; absent → `false`, `warnings` unaffected; `favorite: "yes please"` → `false` **and** `warnings` stays exactly what it would be without the key (reproduce the acceptance criterion verbatim); `favorite: 1`, `0`, `null`, `[]`, `{}` → all `false`; a raw object containing `favorite` never leaks it into `p.custom`.

- [x] **2. Domain: filter, sort composition, and picker tie-break**
  - Goal: in `src/domain/query.ts`, add `favoritesOnly: boolean` and `favoritesFirst: boolean` to `LibraryQuery` and `emptyQuery()`; include `favoritesOnly` in `isQueryActive`; add `if (q.favoritesOnly && !p.favorite) return false;` to `runQuery`'s filter chain (AND-combined, FR-9.4); rename the existing `comparator(sort: SortKey)` switch to `baseComparator` and add a wrapping `comparator(q: LibraryQuery)` that composes `favoritesFirst` with whichever `SortKey` is active (FR-9.5) without changing the `SortKey` union:
    ```ts
    function comparator(q: LibraryQuery): (a: Prompt, b: Prompt) => number {
      const base = baseComparator(q.sort);
      if (!q.favoritesFirst) return base;
      return (a, b) => (Number(b.favorite) - Number(a.favorite)) || base(a, b);
    }
    ```
    Update `runQuery`'s call site from `comparator(q.sort)` to `comparator(q)`. Add the exported, generic tie-break used by the quick picker (Task 6):
    ```ts
    /** Stable tie-break (FR-9.3): favorites rank first only among items whose
     * score is exactly equal; relative order is preserved whenever scores
     * differ, so the caller's own relevance ranking is never overridden. */
    export function rankFavoritesFirst<T>(
      items: T[],
      scoreOf: (item: T) => number,
      isFavorite: (item: T) => boolean,
    ): T[] {
      return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
          if (scoreOf(a.item) !== scoreOf(b.item)) return a.index - b.index;
          const favA = isFavorite(a.item);
          const favB = isFavorite(b.item);
          if (favA === favB) return a.index - b.index;
          return favA ? -1 : 1;
        })
        .map(({ item }) => item);
    }
    ```
  - Files: `src/domain/query.ts` (modify).
  - Test (write first): in `tests/query.test.ts`, extend the `PROMPTS` fixture with a mix of `favorite: true/false` entries; add cases for `favoritesOnly` combined with an existing filter (AND, mirrors the existing "combines filters with AND" test) and for `isQueryActive`; add a case per existing `SortKey` value showing `favoritesFirst: true` groups favorites first while preserving that key's within-group order. Add a new `describe("rankFavoritesFirst")` block: equal-score favorite bubbles above a non-favorite; an unequal-score favorite does **not** jump above a higher-scoring non-favorite; multiple ties stay stable in original order.

- [x] **3. Storage: explicit-toggle writer**
  - Goal: add `setFavorite(app, file, value): Promise<void>` to `src/storage/prompt-writer.ts`, alongside `createPrompt`/`updatePrompt`/`deletePrompt`, writing only the `favorite` key via `processFrontMatter` and touching nothing else (no `updated` stamp — this is a metadata-only toggle, not a content edit):
    ```ts
    /** Explicit-toggle write (FR-9.1): unset is represented by the key's
     * absence, matching draftToFrontmatter's "omit empty optionals" convention,
     * so an unfavorited note stays exactly as minimal as before this feature. */
    export async function setFavorite(app: App, file: TFile, value: boolean): Promise<void> {
      await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        if (value) fm["favorite"] = true;
        else delete fm["favorite"];
      });
    }
    ```
  - Files: `src/storage/prompt-writer.ts` (modify).
  - Test: none (glue boundary — see "Testing boundary" above; `createPrompt`/`updatePrompt`/`deletePrompt` in this same file are equally untested today). Verified by Task 4's manual smoke check (toggle a card, open the note, confirm the frontmatter line appears/disappears) and, as a standing regression net that already exists and needs no new code, `draft.test.ts`'s exact-shape assertion on `draftToFrontmatter`'s output — it will fail if a future change ever makes the draft path start emitting a `favorite` key, which is exactly the property this task's "no `updated` stamp, no draft involvement" design relies on.

- [ ] **4. UI: library view star toggle**
  - Goal: in `src/ui/library-view.ts`'s `renderItem`, create a star button as the **first** child of the header (before the title span, not inside `.promptbox-item__actions`), reusing `promptbox-item__action clickable-icon` plus a new `is-favorite` modifier when `prompt.favorite`; set `aria-pressed`, `aria-label`/tooltip ("Add to favorites" / "Remove from favorites"); on click, resolve the `TFile` at click time (same pattern as `confirmDelete`/`openAsNote`) and call `setFavorite`, with a `Notice` only on failure — no success `Notice`, no manual `render()` call, the existing `index.onChange` subscription redraws the view:
    ```ts
    const favoriteBtn = header.createEl("button", {
      cls: "promptbox-item__action clickable-icon" + (prompt.favorite ? " is-favorite" : ""),
    });
    setIcon(favoriteBtn, "star");
    const label = prompt.favorite ? "Remove from favorites" : "Add to favorites";
    favoriteBtn.setAttribute("aria-label", label);
    favoriteBtn.setAttribute("aria-pressed", String(prompt.favorite));
    setTooltip(favoriteBtn, label);
    favoriteBtn.addEventListener("click", () => {
      const file = this.app.vault.getFileByPath(prompt.path);
      if (!file) return;
      void setFavorite(this.app, file, !prompt.favorite).catch(
        (error: unknown) =>
          new Notice(`Promptbox: favorite update failed — ${error instanceof Error ? error.message : String(error)}`),
      );
    });
    ```
    Add to `styles.css`:
    ```css
    .promptbox-item__action.is-favorite { color: var(--text-accent); }
    .promptbox-item__action.is-favorite svg { fill: currentColor; }
    ```
    No new mobile touch-target rule is needed — reusing `promptbox-item__action` already covers the existing `.is-mobile` 44 px rule.
  - Files: `src/ui/library-view.ts` (modify), `styles.css` (modify).
  - Test: none (glue boundary). Manual smoke check: click the star on desktop and on a mobile client, confirm the note's frontmatter gains/loses `favorite: true` within ~1 s, confirm the star's filled/outline state matches, confirm rapid repeated clicks do not corrupt the note (Task 3's writer has no explicit debounce — verify Obsidian's `processFrontMatter` serializes this safely in practice), and confirm disabling the plugin still shows a plain, readable note (US-8).

- [ ] **5. UI: filter bar chip and sort checkbox**
  - Goal: in `src/ui/filter-bar.ts`, add a fixed "★ Favorites" chip (reuses the existing `promptbox-chip`/`is-active` pattern) bound to `query.favoritesOnly`. Unlike the dynamic type/category/tag chip groups, it always renders — it is a fixed filter dimension, not a value discovered from `FilterOptions`, so `FilterOptions` itself does not change. Add a "Favorites first" checkbox next to the sort dropdown in row 1, bound to `query.favoritesFirst`. Both call the existing `onChange` callback; `sync()` gains two lines (`chip.toggleClass("is-active", query.favoritesOnly)`, `favoritesFirstCheckbox.checked = query.favoritesFirst`) matching the existing style used for `clearBtn`/`qualitySelect`/etc. The "Clear filters" button needs no code change — `Object.assign(query, emptyQuery())` already resets both new fields once Task 2 lands.
  - Files: `src/ui/filter-bar.ts` (modify), `styles.css` (modify: a small layout rule for the new checkbox label, plus its mobile tap-target sizing under the existing `.is-mobile` block).
  - Test: none directly (glue boundary); the filtering/sorting behavior itself is fully covered by Task 2's `query.test.ts` additions, since the bar is a thin view over `LibraryQuery`. Manual smoke check: enable "Favorites" with `type=task` active, confirm only favorite task prompts remain and the count updates; toggle "Favorites first" and confirm favorites float to the top within the active sort order; click "Clear filters" and confirm both controls reset.

- [ ] **6. UI: quick picker star indicator and ranking, full verification pass**
  - Goal: in `src/ui/quick-picker.ts`, import `rankFavoritesFirst` and override `getSuggestions`/`renderSuggestion`:
    ```ts
    override getSuggestions(query: string): FuzzyMatch<Prompt>[] {
      return rankFavoritesFirst(super.getSuggestions(query), (m) => m.match.score, (m) => m.item.favorite);
    }

    override renderSuggestion(match: FuzzyMatch<Prompt>, el: HTMLElement): void {
      super.renderSuggestion(match, el);
      if (match.item.favorite) {
        const star = createSpan({ cls: "promptbox-picker__favorite" });
        setIcon(star, "star");
        el.prepend(star);
      }
    }
    ```
    Add `setIcon` to the existing `"obsidian"` import in this file. Add to `styles.css`:
    ```css
    .promptbox-picker__favorite {
      display: inline-flex;
      align-items: center;
      margin-right: var(--size-2-2);
      color: var(--text-accent);
    }
    ```
    In-picker toggling stays out of scope (FR-9.3 marks it COULD).
  - Files: `src/ui/quick-picker.ts` (modify), `styles.css` (modify).
  - Test: the ranking algorithm itself is already fully covered by Task 2's pure-function tests; this override is a thin, glue-boundary wrapper. Close this task with:
    1. Manual smoke check: open the quick picker, confirm favorite prompts show a star and rank above non-favorites among equally-scored matches (e.g. an empty query, or a query matching several titles equally), without out-ranking a clearly better fuzzy match.
    2. Run the **full** suite, not just the new/changed test files: `npm run build && npm run lint && npm test`.
    3. Re-check all four acceptance criteria from `SPEC.md` §3 end to end, on desktop and at least one mobile platform.
