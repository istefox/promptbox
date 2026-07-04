import { describe, expect, it } from "vitest";
import { normalizePrompt, type Prompt } from "../src/domain/prompt";
import {
	buildPaletteCatalog,
	caretRangeAfterInsert,
	filterCatalog,
	matchPlaceholderTrigger,
	type PaletteEntry,
} from "../src/domain/placeholder-palette";

const CTX_TODAY = "2026-07-04";

function p(path: string, fm: Record<string, unknown>): Prompt {
	return normalizePrompt(fm, { path, filename: path, today: CTX_TODAY });
}

const CONTEXT_LABELS = ["@selection", "@title", "@date", "@clipboard"];
const TEMPLATE_INSERTS = ["{{name|default|hint}}", "{{name|a,b,c|hint}}"];

describe("buildPaletteCatalog (FR-24.1/24.2)", () => {
	it("returns the 4 context entries followed by the 2 templates for an empty library (AC-5)", () => {
		const catalog = buildPaletteCatalog([], () => "");
		expect(catalog.map((e) => e.kind)).toEqual(["context", "context", "context", "context", "template", "template"]);
		expect(catalog.slice(0, 4).map((e) => e.label)).toEqual(CONTEXT_LABELS);
	});

	it("harvests every distinct well-formed placeholder name, sorted by frequency desc then name asc", () => {
		const prompts = [p("a.md", { title: "A" }), p("b.md", { title: "B" })];
		const bodies: Record<string, string> = {
			"a.md": "{{tone}} {{product}} {{product}}",
			"b.md": "{{product}}",
		};
		const catalog = buildPaletteCatalog(prompts, (path) => bodies[path] ?? "");
		const library = catalog.filter((e) => e.kind === "library");
		expect(library.map((e) => e.label)).toEqual(["product", "tone"]);
	});

	it("counts total occurrences across bodies (a name appearing twice in one body plus once in another totals 3)", () => {
		const prompts = [p("a.md", { title: "A" }), p("b.md", { title: "B" }), p("c.md", { title: "C" })];
		const bodies: Record<string, string> = {
			"a.md": "{{product}} {{product}}",
			"b.md": "{{product}}",
			"c.md": "{{rare}}",
		};
		const catalog = buildPaletteCatalog(prompts, (path) => bodies[path] ?? "");
		const library = catalog.filter((e) => e.kind === "library");
		// product (count 3) sorts before rare (count 1).
		expect(library.map((e) => e.label)).toEqual(["product", "rare"]);
	});

	it("excludes @-prefixed names from the library section", () => {
		const prompts = [p("a.md", { title: "A" })];
		const catalog = buildPaletteCatalog(prompts, () => "{{@selection}} {{@custom}} {{product}}");
		const library = catalog.filter((e) => e.kind === "library");
		expect(library.map((e) => e.label)).toEqual(["product"]);
	});

	it("skips malformed occurrences (empty name, >3 segments) without crashing", () => {
		const prompts = [p("a.md", { title: "A" })];
		const catalog = buildPaletteCatalog(prompts, () => "{{}} {{a|b|c|d}} {{product}}");
		const library = catalog.filter((e) => e.kind === "library");
		expect(library.map((e) => e.label)).toEqual(["product"]);
	});

	it("returns template entries with insertText selecting the name segment", () => {
		const catalog = buildPaletteCatalog([], () => "");
		const templates = catalog.filter((e) => e.kind === "template");
		expect(templates.map((e) => e.insertText)).toEqual(TEMPLATE_INSERTS);
		for (const entry of templates) {
			expect(entry.selection).toEqual({ start: 2, end: 6 });
			expect(entry.insertText.slice(2, 6)).toBe("name");
		}
	});

	it("orders context, then library, then templates, never interleaved", () => {
		const prompts = [p("a.md", { title: "A" })];
		const catalog = buildPaletteCatalog(prompts, () => "{{tone}}");
		expect(catalog.map((e) => e.kind)).toEqual([
			"context",
			"context",
			"context",
			"context",
			"library",
			"template",
			"template",
		]);
	});
});

describe("matchPlaceholderTrigger (FR-24.4/24.6)", () => {
	it("returns null when there is no {{ anywhere", () => {
		expect(matchPlaceholderTrigger("just some text")).toBeNull();
	});

	it("matches a just-typed {{ with an empty query", () => {
		const text = "hello {{";
		const trigger = matchPlaceholderTrigger(text);
		expect(trigger).toEqual({ start: 6, end: text.length, query: "" });
	});

	it("matches a partial query", () => {
		const text = "hello {{pro";
		const trigger = matchPlaceholderTrigger(text);
		expect(trigger).toEqual({ start: 6, end: text.length, query: "pro" });
	});

	it("returns null when the last {{ on the line is already closed by }}", () => {
		expect(matchPlaceholderTrigger("{{done}}")).toBeNull();
	});

	it("matches the later, open {{ when an earlier one is already closed", () => {
		const text = "{{done}} {{pro";
		const trigger = matchPlaceholderTrigger(text);
		expect(trigger).toEqual({ start: 9, end: text.length, query: "pro" });
	});

	it("returns null when the cursor sits inside a construct closed just ahead (template name selected)", () => {
		// caret after "{{name", with "|default|hint}}" still ahead on the line
		expect(matchPlaceholderTrigger("{{name", "|default|hint}}")).toBeNull();
	});

	it("still matches an open {{ when the text ahead reopens before it closes", () => {
		const trigger = matchPlaceholderTrigger("{{pro", " and {{other}}");
		expect(trigger).toEqual({ start: 0, end: 5, query: "pro" });
	});

	it("matches normally when nothing follows the cursor", () => {
		const trigger = matchPlaceholderTrigger("{{pro", "");
		expect(trigger).toEqual({ start: 0, end: 5, query: "pro" });
	});
});

describe("filterCatalog (FR-24.4)", () => {
	const catalog: PaletteEntry[] = [
		{ id: "context:@date", label: "@date", kind: "context", insertText: "{{@date}}" },
		{ id: "library:product", label: "product", kind: "library", insertText: "{{product}}" },
		{
			id: "template:1",
			label: "{{name|default|hint}}",
			kind: "template",
			insertText: "{{name|default|hint}}",
			selection: { start: 2, end: 6 },
		},
	];

	it("returns the catalog unchanged for an empty query", () => {
		expect(filterCatalog(catalog, "")).toEqual(catalog);
	});

	it("matches case-insensitively on label", () => {
		expect(filterCatalog(catalog, "PRO").map((e) => e.label)).toEqual(["product"]);
	});

	it("falls back to context + template entries when nothing matches (AC-5)", () => {
		const result = filterCatalog(catalog, "zzz-no-match");
		expect(result.map((e) => e.kind)).toEqual(["context", "template"]);
	});

	it("preserves the input catalog's relative order", () => {
		const wideCatalog: PaletteEntry[] = [
			{ id: "context:@date", label: "@date", kind: "context", insertText: "{{@date}}" },
			{ id: "library:date-thing", label: "date-thing", kind: "library", insertText: "{{date-thing}}" },
		];
		expect(filterCatalog(wideCatalog, "date").map((e) => e.label)).toEqual(["@date", "date-thing"]);
	});
});

describe("caretRangeAfterInsert (FR-24.7)", () => {
	it("collapses at insertAt + insertText.length when there is no selection", () => {
		const entry: PaletteEntry = { id: "context:@date", label: "@date", kind: "context", insertText: "{{@date}}" };
		expect(caretRangeAfterInsert(entry, 0)).toEqual({ start: 9, end: 9 });
	});

	it("projects the entry's selection for a template", () => {
		const entry: PaletteEntry = {
			id: "template:1",
			label: "{{name|default|hint}}",
			kind: "template",
			insertText: "{{name|default|hint}}",
			selection: { start: 2, end: 6 },
		};
		expect(caretRangeAfterInsert(entry, 0)).toEqual({ start: 2, end: 6 });
	});

	it("computes correctly at a non-zero insertAt (no selection)", () => {
		const entry: PaletteEntry = { id: "context:@date", label: "@date", kind: "context", insertText: "{{@date}}" };
		expect(caretRangeAfterInsert(entry, 10)).toEqual({ start: 19, end: 19 });
	});

	it("computes correctly at a non-zero insertAt (template selection)", () => {
		const entry: PaletteEntry = {
			id: "template:1",
			label: "{{name|default|hint}}",
			kind: "template",
			insertText: "{{name|default|hint}}",
			selection: { start: 2, end: 6 },
		};
		expect(caretRangeAfterInsert(entry, 10)).toEqual({ start: 12, end: 16 });
	});
});
