# ADR-0002: Build the UI on native Obsidian components with vanilla TypeScript

| | |
|---|---|
| Status | Accepted |
| Date | 2 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `spec.md` FR-2..FR-6, ADR-0001 |

## Context

The MVP needs a full-tab library view (filter bar, incremental search, sortable list with item actions), create/edit modals, a variable-filling form modal, a fuzzy quick picker, and a settings tab. Constraints: desktop and mobile, TypeScript strict, esbuild, minimal bundle and dependencies, store-guideline compliance (load performance, resource cleanup on unload). The choice is the UI implementation approach: framework or native.

## Decision

Use the Obsidian API's own UI primitives with vanilla TypeScript and direct DOM composition:

- Library view: `ItemView` in a workspace leaf (tab), opened by ribbon icon and command.
- Create/edit and variable-filling dialogs: `Modal` with the `Setting` component builder for form rows.
- Quick picker: `FuzzySuggestModal` over the in-memory index (ADR-0001).
- Settings: `PluginSettingTab` with `Setting` rows; folder selection via a suggest input.
- Styling: one `styles.css` using Obsidian CSS variables, so light/dark themes and community themes apply automatically.
- A small internal helper layer (list rendering, filter-state store, debounced search) keeps view code tidy without importing a framework. List virtualization is added only if the NFR-1 measurements demand it.

## Alternatives considered

1. **React.** Familiar component model, rich ecosystem. Rejected: adds a runtime dependency and bundle weight for a plugin with one main view; mixes two lifecycles (React tree vs Obsidian leaf/modal lifecycle), a known source of leak bugs; farther from the API's own patterns.
2. **Svelte (compile-time).** Near-zero runtime, good ergonomics. Rejected: extra toolchain complexity on top of esbuild and a second mental model for contributors; the UI surface is small enough that the benefit does not pay for the cost.
3. **Web components.** Standards-based encapsulation. Rejected: shadow-DOM styling fights Obsidian theming, little gain over plain DOM here.

## Consequences

Positive: smallest possible bundle and dependency surface (helps NFR-2 startup and store review); UI inherits Obsidian look, theming, and accessibility behavior on desktop and mobile for free; lifecycle management maps 1:1 to plugin load/unload, easing guideline-compliant cleanup.

Negative and accepted: more verbose imperative DOM code than a declarative framework; state-to-DOM updates are manual, so the helper layer must stay disciplined (single render path per view); contributor onboarding assumes comfort with the raw Obsidian API.
