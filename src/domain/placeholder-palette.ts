import { isContextVariable, matchPlaceholders } from "./placeholders";
import type { Prompt } from "./prompt";

export type PaletteEntryKind = "context" | "library" | "template";

export interface PaletteEntry {
	/** Stable key (kind + label); for tests/DOM-keying only, never persisted. */
	id: string;
	/** Text shown in the picker/dropdown. */
	label: string;
	kind: PaletteEntryKind;
	/** Exact text to splice in; never contains a newline (surfaces rely on this). */
	insertText: string;
	/** Offsets within insertText to select after insertion (e.g. the "name" segment
	 *  of a template). Absent = caret lands at the end of insertText (FR-24.7). */
	selection?: { start: number; end: number };
}

// FR-24.1's own listing; no earlier module exports this list in this order.
const CONTEXT_VARIABLE_NAMES = ["@selection", "@title", "@date", "@clipboard"];

// FR-24.1: both templates select the "name" segment, offsets {2, 6} in either string.
const TEMPLATE_INSERTS = ["{{name|default|hint}}", "{{name|a,b,c|hint}}"];
const TEMPLATE_NAME_SELECTION = { start: 2, end: 6 };

function contextEntries(): PaletteEntry[] {
	return CONTEXT_VARIABLE_NAMES.map((name) => ({
		id: `context:${name}`,
		label: name,
		kind: "context",
		insertText: `{{${name}}}`,
	}));
}

function templateEntries(): PaletteEntry[] {
	return TEMPLATE_INSERTS.map((insertText) => ({
		id: `template:${insertText}`,
		label: insertText,
		kind: "template",
		insertText,
		selection: { ...TEMPLATE_NAME_SELECTION },
	}));
}

/** Total occurrence count per well-formed, non-context placeholder name across the library. */
function libraryNameFrequency(prompts: Prompt[], getBody: (path: string) => string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const prompt of prompts) {
		for (const match of matchPlaceholders(getBody(prompt.path))) {
			const name = match.variable?.name;
			if (name === undefined || isContextVariable(name)) continue;
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
	}
	return counts;
}

function libraryEntries(prompts: Prompt[], getBody: (path: string) => string): PaletteEntry[] {
	const counts = libraryNameFrequency(prompts, getBody);
	return [...counts.entries()]
		.sort(([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB))
		.map(([name]) => ({
			id: `library:${name}`,
			label: name,
			kind: "library" as const,
			insertText: `{{${name}}}`,
		}));
}

/**
 * FR-24.1/24.2: context variables (fixed order, FR-24.1's own listing) first,
 * then every distinct well-formed placeholder name harvested from the library
 * via matchPlaceholders (context-variable names excluded, isContextVariable),
 * sorted by total occurrence count descending / name ascending, then the two
 * syntax templates. Never empty: context + templates are unconditional.
 */
export function buildPaletteCatalog(prompts: Prompt[], getBody: (path: string) => string): PaletteEntry[] {
	return [...contextEntries(), ...libraryEntries(prompts, getBody), ...templateEntries()];
}

export interface PlaceholderTrigger {
	/** Offset of the opening "{{" within textBeforeCursor. */
	start: number;
	/** Offset of the cursor itself, i.e. textBeforeCursor.length. */
	end: number;
	/** Text typed after "{{", used to filter the catalog; may be empty. */
	query: string;
}

/**
 * FR-24.4/24.6: given the text from the start of the current line up to the
 * cursor and (optionally) the text from the cursor to the end of the line,
 * returns the innermost open, unclosed "{{" and its partial query, or null
 * when there is none or the construct is already closed by a "}}" (edge case
 * §5). The after-cursor check keeps the suggestion from re-opening right after
 * a template is inserted and its "name" segment is selected, when the cursor
 * sits inside a complete "{{name|default|hint}}".
 */
export function matchPlaceholderTrigger(
	textBeforeCursor: string,
	textAfterCursor = "",
): PlaceholderTrigger | null {
	const start = textBeforeCursor.lastIndexOf("{{");
	if (start === -1) return null;
	const query = textBeforeCursor.slice(start + 2);
	if (query.includes("}}")) return null;
	// Closed just ahead: a "}}" before any new "{{" means this "{{" already has
	// its closer, so the cursor is inside a complete construct, not an open one.
	const close = textAfterCursor.indexOf("}}");
	const reopen = textAfterCursor.indexOf("{{");
	if (close !== -1 && (reopen === -1 || close < reopen)) return null;
	return { start, end: textBeforeCursor.length, query };
}

/**
 * FR-24.4 filter, shared by all four surfaces: case-insensitive substring on
 * label, order-preserving (never re-scores/reorders FR-24.2's canonical
 * order). Empty query returns the catalog unchanged. A query that matches
 * nothing falls back to the context + template entries, so the result is
 * never empty (§5 edge case, AC-5).
 */
export function filterCatalog(catalog: PaletteEntry[], query: string): PaletteEntry[] {
	if (query === "") return catalog;
	const q = query.toLowerCase();
	const matches = catalog.filter((entry) => entry.label.toLowerCase().includes(q));
	return matches.length > 0 ? matches : catalog.filter((entry) => entry.kind !== "library");
}

/**
 * FR-24.7 caret math, shared by both insertion surfaces: projects an entry's
 * selection (or, absent one, a trailing collapsed caret) onto absolute
 * offsets anchored at insertAt (where insertText's first character lands).
 * Every UI surface calls this instead of branching on "span vs trailing"
 * itself.
 */
export function caretRangeAfterInsert(entry: PaletteEntry, insertAt: number): { start: number; end: number } {
	if (!entry.selection) {
		const end = insertAt + entry.insertText.length;
		return { start: end, end };
	}
	return { start: insertAt + entry.selection.start, end: insertAt + entry.selection.end };
}
