# ADR-0005: Reserved `@` namespace for context variables, resolved via an isolated UI-layer resolver

| | |
|---|---|
| Status | Proposed |
| Date | 3 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `SPEC.md` (context-variables), `docs/competitive-analysis.md` §4 P1, ADR-0001, ADR-0002 |

## Context

Promptbox's copy flow (FR-4, ADR-0002) parses placeholders with `parsePlaceholders` and fills them through `VariableModal`. Three competitors in the competitive analysis (Copilot for Obsidian, PromptCrafter, Smart Prompts) resolve some form of workspace context, active note, current selection, a `{{CURRENT}}`-style token, at copy time; Promptbox has no equivalent (`docs/competitive-analysis.md` F8/M1, priority P1). `SPEC.md` FR-10 specifies a reserved `@`-prefixed placeholder namespace covering four names, `@selection`, `@title`, `@date`, `@clipboard`, resolved from Obsidian workspace state at copy time, excluded from the variable-filling modal, and bypassed entirely by copy raw.

Binding constraints: `src/domain/placeholders.ts` must stay a pure function with no Obsidian imports; workspace resolution is injected from the UI layer, so domain tests need no Obsidian mocks; no network calls (NFR-5); desktop and mobile, with `@selection`/`@clipboard` unavailability degrading to empty-string-plus-notice rather than a crash; ADR-0001 (notes as source of truth; this feature adds no frontmatter field) and ADR-0002 (native Obsidian primitives, no framework) remain binding. The feature must extend FR-4's copy flow without altering its existing contract for ordinary, non-`@` variables, and both existing copy entry points, the library view's item action and the quick picker, must gain the new behavior.

## Decision

Extend the existing copy flow with a single-parse, partition-then-merge pipeline, split across three points:

1. `src/domain/placeholders.ts` gains one new pure export, `isContextVariable(name: string): boolean`, returning `name.startsWith("@")`. It has no Obsidian dependency, sits beside `parsePlaceholders`/`resolvePlaceholders`, and does not alter their behavior, return shape, or any existing test. It is the single source of truth for "this placeholder name is reserved," used both to exclude `@` names from the variable modal and to select which parsed variables get resolved from workspace state.

2. A new UI-layer module, `src/ui/context-variables.ts`, owns workspace and browser resolution: `resolveContextVariables(app: App, names: string[]): Promise<Record<string, string>>`. It holds a small internal map from the four reserved names to resolver functions:
   - `@date` → `todayISO()`, reused unmodified from `src/storage/frontmatter.ts`; always resolves, never triggers a notice.
   - `@title` → `app.workspace.getActiveFile()?.basename`; no active file is unresolved.
   - `@selection` → `app.workspace.getActiveViewOfType(MarkdownView)?.editor?.getSelection()`; both "no markdown view" and an empty-string selection count as unresolved, per FR-10.2's explicit wording.
   - `@clipboard` → `navigator.clipboard.readText()`; only a thrown/rejected read is unresolved. A successful read that happens to be the empty string is a resolved empty value, not a notice case, deliberately asymmetric with `@selection` — the two must not share one generic "empty means unresolved" rule.

   Any name outside these four (an unrecognized `@foo`) yields no map entry at all, so it is never resolved and never notified about. Every unresolved known name gets exactly one `Notice` naming it and an empty-string value.

3. `src/ui/copy.ts`'s `copyWithVariables` orchestrates the whole flow. On a non-empty placeholder parse, it splits `parsePlaceholders(body)` into `contextVars` (name matches `isContextVariable`) and `userVars` (the rest), discarding any default or hint the parser attached to a context variable's segment (FR-10.3) by construction, since only `.name` is ever passed onward to the resolver. It calls `resolveContextVariables(app, contextVars.map(v => v.name))` fire-and-forget from the function's own point of view (`void ... .then(...)`, the same idiom already used for `deletePrompt(...).then(...)` in `library-view.ts`), so the function's exported signature, `(app: App, title: string, body: string): void`, is unchanged. When the resolved promise settles: if `userVars` is empty, it writes the clipboard immediately with `resolvePlaceholders(body, contextValues)`, no modal (FR-10.3); otherwise it opens `VariableModal` with only `userVars` and, on submit, resolves the body against `{ ...contextValues, ...userValues }` in one final `resolvePlaceholders` call. The pre-existing zero-placeholder fast path (`variables.length === 0` → immediate copy, FR-4.4) runs before any of this and is untouched. `copyRaw` is untouched: it never parses the body, so it already satisfies FR-10.4 with no code change.

Because both copy entry points, the library view's "Copy with variables" item action (`library-view.ts`) and the quick picker (`quick-picker.ts`), already call the single exported `copyWithVariables`/`copyRaw` with the same signature, FR-10.5 (both entry points resolve context) falls out of this architecture with zero edits to either file. `variable-modal.ts` also needs no change: it already renders whatever `PromptVariable[]` it is constructed with, and now simply receives a pre-filtered list.

## Alternatives considered

1. **Pre-substitution pass.** Run a first substitution pass over the raw body, replacing `{{@name}}` occurrences with resolved values, then re-parse the resulting intermediate body for user-fillable variables with the unmodified FR-4 flow. Rejected: this parses the body twice and, critically, a resolved value's contents are user-controlled text, `@selection` is literally whatever the user has selected. If that text itself contains `{{...}}`-shaped substrings, realistic for prompts about templating, code, or documentation, a second parse over the substituted body would treat the user's own selected content as a brand-new placeholder to fill, corrupting output the user never intended touched. The chosen single-parse-then-merge design parses the original, unmodified body exactly once; every substitution, context and user, happens together in one final `resolvePlaceholders` call, so a resolved value's contents are never re-scanned for placeholder syntax.

2. **Formal dependency-injected resolver**, threaded as a new parameter through `copyWithVariables` and from there into both call sites in `library-view.ts` and `quick-picker.ts`. Rejected: there is exactly one production resolver implementation, and no second one is in scope or foreseeable from SPEC.md's stated out-of-scope list. Threading a parameter through two call sites buys no behavioral flexibility today and adds churn to files the feature does not otherwise need to touch. An internal module import from `copy.ts` satisfies SPEC.md's "injected as a resolver" intent, workspace resolution lives outside the pure parser, in its own unit, without an extensibility seam nothing currently uses.

3. **Bake context-variable classification into `parsePlaceholders`'s return shape**, e.g. an `isContext: boolean` field on `PromptVariable`. Rejected: this touches an established, already-tested parser contract (`tests/placeholders.test.ts`) and its only other consumer (`variable-modal.ts`) for no functional gain, since a standalone `isContextVariable(name)` predicate achieves the same classification without changing `PromptVariable`'s shape or `parsePlaceholders`'s behavior at all. A purely additive change carries less risk than reshaping a proven contract.

4. **Show context variables inside the variable modal as read-only, pre-filled rows** instead of excluding them entirely. Rejected outright by FR-10.3, which requires no modal at all for a prompt whose only placeholders are context variables; this is a spec requirement, not an open design trade-off.

## Consequences

Positive: FR-10.5 (both entry points) is satisfied with zero changes to `library-view.ts` and `quick-picker.ts`, since both already call the single shared, signature-stable `copyWithVariables`/`copyRaw`. `variable-modal.ts` is untouched too. The trickiest logic, which placeholders are reserved and therefore excluded from user input, is a pure, directly vitest-tested function, even though the actual resolution (selection, title, date, clipboard) is Obsidian- and browser-API-coupled and stays under the project's existing manual-smoke-test convention for `src/ui/*`. Adding a future context variable later (e.g. a vault name or a frontmatter-field reference, both explicitly parked in SPEC.md's out-of-scope section) is a one-entry addition to the resolver map in `context-variables.ts`, with no change to `copy.ts`'s orchestration or to either call site. The single-parse-then-merge design also closes off a realistic class of bug (a resolved context value's own content being mis-parsed as a new placeholder) by construction, not by a special case someone has to remember.

Negative and accepted: any pre-existing prompt body that already uses a literal `{{@something}}` construct as an ordinary FR-4 user variable changes behavior. It is now either silently resolved (if it matches one of the four reserved names) or passed through untouched rather than offered in the modal, an accepted trade-off of reserving the namespace, stated in SPEC.md itself. A grep across `src/` and `tests/` found no existing usage of this syntax in the codebase, but vault content is user data the plugin cannot audit ahead of time; this is a one-line release-note item, not a blocker. `MarkdownView.editor.getSelection()` reflects the CodeMirror editor's selection state; whether it tracks a native text selection made while the note is rendered in reading/preview mode rather than editing mode is an Obsidian API behavior SPEC.md does not address, and this decision does not attempt to work around it.

Neutral: reserving the entire `@` prefix, not just the four currently-supported names, forecloses ever using a bare `@`-prefixed name as an ordinary FR-4 user variable, even for a hypothetical future context name not yet on the list. This is an intentional, permanent namespace commitment, consistent with FR-10.1's literal wording, rather than a cost or a benefit on its own.

## References

- MarkdownView / Editor selection API: https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/TypeScript%20API/Editor/getSelection.md
- `Workspace.getActiveViewOfType`: https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/TypeScript%20API/Workspace/getActiveViewOfType.md
