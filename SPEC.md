# SPEC: Click actions on prompt cards

**Topic slug:** click-actions

## Objective

Add a right-click (desktop) / long-press (mobile) context menu to each prompt card in the
library view (`ItemView`, `src/ui/library-view.ts`), carrying the card's existing actions as
text-label menu items. Resolves GitHub issue #33.

## Origin and scope boundary

Reported by @craziedde in istefox/promptbox#33. Two follow-ups clarified the ask into a larger
set of ideas (configurable click bindings, a future multi-select mode with bulk actions); the
maintainer's public reply (issue comment, 2026-07-11) explicitly scoped this pass to the
context menu only, deferring the rest to a future issue. This SPEC implements exactly that
scoped commitment. It does not renegotiate it.

**Explicitly out of scope for this feature:**
- User-configurable/remappable click bindings.
- A "Select" / multi-select mode with bulk actions (delete, tag, etc.).
- Any change to `src/ui/quick-picker.ts` (FuzzySuggestModal). That surface already has its own
  Ctrl/Cmd+click convention ("copy raw") and is not part of this SPEC.

## Current state (confirmed during interview)

- `library-view.ts` renders one card per prompt with a header row of 6 icon buttons:
  Favorite toggle (star), Copy with variables, Copy raw, Edit metadata, Open as note, Delete.
- The card container itself (body, preview text, meta pills, title) has **no existing click
  handler.** Only the icon buttons are interactive today, and there is nothing to preserve or
  conflict with on the card body.
- All 6 actions already have working handlers (`addItemAction`, `addFavoriteToggle`,
  `confirmDelete`) that this feature reuses; it does not introduce new business logic for any
  action, only a second entry point to trigger them.

## Scope

1. **New interaction:** right-click (desktop `contextmenu` event) or long-press (mobile touch,
   500ms, cancelled if the touch moves more than 10px) anywhere on a prompt card opens an
   Obsidian `Menu` populated with all 6 actions as text-label items, using Obsidian's native
   `Menu`/`MenuItem` API (`showAtMouseEvent` for desktop, `showAtPosition` for the long-press
   touch point on mobile).
2. **Icon buttons are unchanged.** All 6 remain exactly as they are today, at the same
   position, with the same click behavior, aria-labels, and tooltips. The context menu is a
   fully additive second path to the same actions, so there is zero regression risk on existing behavior.
3. **Menu triggers everywhere on the card**, including when right-clicking directly over an
   icon button (no special-casing of `event.target`; the listener is on the card root and
   always shows the same menu regardless of what's under the pointer).
4. **Menu content and order** (frequency-ordered, one separator before the destructive item):
   1. Copy with variables
   2. Copy raw
   3. Edit metadata
   4. Open as note
   5. Add to favorites / Remove from favorites (label reflects current `prompt.favorite` state)
   6. (separator)
   7. Delete (styled via `MenuItem.setWarning(true)`)
5. **Single click on the card is unaffected.** There is no existing handler to change, and
   this feature does not add one; single-click behavior stays exactly as-is.

## Architecture (ADR-0001 pattern: pure domain + thin UI glue)

- **`src/domain/card-menu.ts`** (new, no Obsidian import, vitest-covered): pure function
  `buildCardMenuEntries(prompt: Prompt): CardMenuEntry[]` returning the ordered, labeled entry
  list above as data, typed as `{ label: string; actionKey: CardMenuActionKey; warning: boolean;
  separatorBefore: boolean }[]`. Contains all logic that can vary (favorite label toggling,
  ordering, which entries apply) so it is independently testable without a DOM or an Obsidian
  `App` instance. Mirrors the existing pattern in `src/domain/related.ts` and
  `src/domain/placeholder-palette.ts`.
- **`src/ui/library-view.ts`** (modified): a new private method (e.g. `attachCardMenu`) wires
  one `contextmenu` listener (desktop) and one long-press touch listener (mobile: `touchstart`
  starts a 500ms timer, `touchmove` beyond 10px or `touchend`/`touchcancel` before the timer
  fires cancels it) onto the card root element created in the existing render path. On trigger:
  call `buildCardMenuEntries(prompt)`, map each `CardMenuEntry` to `menu.addItem(...)`, and
  dispatch `actionKey` to the existing handler methods already used by the icon buttons (no
  duplicated business logic; the menu calls the same functions the icons call).
- No changes to `src/domain/prompt.ts`, frontmatter schema, or any storage/index code. This is
  a pure UI/interaction feature.

## Data model

No new persisted fields. `CardMenuEntry` is an in-memory UI type only (not frontmatter, not
`data.json`), defined in `src/domain/card-menu.ts`.

```
type CardMenuActionKey =
  | "copy-with-variables" | "copy-raw" | "edit-metadata"
  | "open-as-note" | "toggle-favorite" | "delete";

interface CardMenuEntry {
  label: string;
  actionKey: CardMenuActionKey;
  warning: boolean;
  separatorBefore: boolean;
}
```

## UI flow

1. User right-clicks (desktop) or long-presses ≥500ms without moving >10px (mobile) anywhere
   on a prompt card.
2. Native OS/browser context menu is suppressed (`event.preventDefault()`); Obsidian `Menu` is
   shown at the pointer/touch position.
3. Menu shows the 6 entries in the order defined above, Delete visually separated and styled
   as a warning.
4. Selecting an entry runs the same handler the equivalent icon button runs today (including
   the existing delete confirmation modal, unchanged).
5. Menu dismisses on selection, outside click, or Escape (native `Menu` behavior, no custom
   handling needed).

## Edge cases

- **Right-click directly on an icon button:** menu still opens (per interview decision, no
  target-checking). The icon's own click handler is unaffected since `contextmenu` and `click`
  are different events.
- **Long-press that turns into a scroll gesture:** cancelled once touch movement exceeds 10px;
  the list scrolls normally, no menu appears.
- **Long-press released before 500ms (a tap):** timer is cleared on `touchend`; no menu, no
  interference with any future tap behavior.
- **Favorite label:** always reflects live `prompt.favorite` state at menu-open time (same
  data source the star icon already uses), so it can never show a stale toggle direction.
- **Prompt with corruptible/invalid frontmatter (NFR-8):** `buildCardMenuEntries` operates on
  already-tolerantly-parsed `Prompt` data (same object the icons use), so no new failure mode
  is introduced.

## Success criteria / Definition of Done

- `src/domain/card-menu.ts` exists, has no Obsidian import, and has vitest coverage for:
  entry ordering, the favorite label toggling both directions, and the warning/separator flags
  on Delete.
- Right-click on a card in a running dev-build desktop Obsidian instance opens the menu with
  all 6 correctly-labeled entries in the specified order, and each entry triggers the same
  outcome as its corresponding icon button (including the delete confirmation modal).
- Long-press timing/cancel logic (500ms trigger, 10px-move cancel) is verified via Chrome
  DevTools touch-emulation (dispatched `touchstart`/`touchmove`/`touchend` events) against the
  dev build, confirming the menu opens on a stationary long-press and does not open when the
  touch moves past the cancel threshold. Verification on a physical mobile device is a
  follow-up, not a blocker for this cycle.
- All 6 existing icon buttons remain unchanged: same position, same click behavior, same
  aria-labels/tooltips, verified by manual smoke pass alongside the above.
- `npm run build` (typecheck + production build) and `npm run lint` both green.
- No changes to `src/ui/quick-picker.ts`.

## Out of scope / follow-up

- Configurable click-action bindings (tracked as a future issue per the public reply on #33).
- "Select" / multi-select mode with bulk actions (same).
- Extending the context menu to `quick-picker.ts` rows.
- Physical-device mobile verification (noted as a DoD follow-up, not a blocker).
