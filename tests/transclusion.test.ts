import { describe, expect, it } from "vitest";
import { resolvePlaceholders } from "../src/domain/placeholders";
import { assembleBody, detectWikilinks } from "../src/domain/transclusion";

describe("detectWikilinks (FR-12.1, FR-12.2)", () => {
	it("parses the three syntax forms", () => {
		expect(detectWikilinks("[[target]]")).toEqual([
			{ raw: "[[target]]", target: "target", alias: null, isEmbed: false, hasSubReference: false },
		]);
		expect(detectWikilinks("[[target|alias]]")).toEqual([
			{ raw: "[[target|alias]]", target: "target", alias: "alias", isEmbed: false, hasSubReference: false },
		]);
		expect(detectWikilinks("![[target]]")).toEqual([
			{ raw: "![[target]]", target: "target", alias: null, isEmbed: true, hasSubReference: false },
		]);
	});

	it("marks heading and block sub-references, alone or combined with an alias", () => {
		expect(detectWikilinks("[[note#heading]]")).toEqual([
			{ raw: "[[note#heading]]", target: "note", alias: null, isEmbed: false, hasSubReference: true },
		]);
		expect(detectWikilinks("[[note^block]]")).toEqual([
			{ raw: "[[note^block]]", target: "note", alias: null, isEmbed: false, hasSubReference: true },
		]);
		expect(detectWikilinks("[[note#heading|alias]]")).toEqual([
			{ raw: "[[note#heading|alias]]", target: "note", alias: "alias", isEmbed: false, hasSubReference: true },
		]);
	});

	it("skips malformed constructs and matches only the innermost of a nested pair", () => {
		expect(detectWikilinks("[[]]")).toEqual([]);
		expect(detectWikilinks("[[   ]]")).toEqual([]);
		expect(detectWikilinks("[[a[[b]]]]").map((l) => l.target)).toEqual(["b"]);
	});

	it("returns one entry per occurrence, not deduplicated by target", () => {
		const links = detectWikilinks("[[a]] text [[a]]");
		expect(links).toHaveLength(2);
		expect(links[0]?.target).toBe("a");
		expect(links[1]?.target).toBe("a");
		expect(links[0]?.raw).toBe(links[1]?.raw);
	});
});

describe("assembleBody (FR-12.6)", () => {
	it("splices a resolved link in at the right position", () => {
		const body = "Context:\n[[style-guide]]\n\nTask: {{task}}";
		const out = assembleBody(body, new Map([["style-guide", "Be concise."]]), { task: "summarize" });
		expect(out).toBe("Context:\nBe concise.\n\nTask: summarize");
	});

	it("leaves an unresolved link verbatim", () => {
		const body = "See [[missing-note]] for context.";
		expect(assembleBody(body, new Map(), {})).toBe(body);
	});

	it("splices a placeholder value alongside a resolved link in the same pass", () => {
		const body = "[[a]] and {{x}}";
		const out = assembleBody(body, new Map([["a", "A-content"]]), { x: "X-value" });
		expect(out).toBe("A-content and X-value");
	});

	it("never re-scans a transcluded link's content for placeholders sharing a name (FR-12.6)", () => {
		const body = "[[note]] {{name}}";
		const out = assembleBody(body, new Map([["note", "literal {{name}} text"]]), { name: "Alice" });
		expect(out).toBe("literal {{name}} text Alice");
	});

	it("never re-scans a placeholder value for wikilinks it happens to contain (FR-12.6)", () => {
		const body = "{{value}} and [[target]]";
		const out = assembleBody(body, new Map([["target", "TARGET CONTENT"]]), { value: "[[target]]" });
		expect(out).toBe("[[target]] and TARGET CONTENT");
	});

	it("resolves an overlap where a placeholder's hint contains a link-shaped substring as one placeholder replacement", () => {
		const body = "{{name||see [[link]] for details}}";
		const out = assembleBody(body, new Map([["link", "LINK CONTENT"]]), { name: "value" });
		expect(out).toBe("value");
	});

	it("resolves an overlap where a link's alias contains a placeholder-shaped substring as one link replacement", () => {
		const body = "[[target|{{ph}}]]";
		const out = assembleBody(body, new Map([["target", "LINK CONTENT"]]), { ph: "value" });
		expect(out).toBe("LINK CONTENT");
	});

	it("produces byte-identical output to resolvePlaceholders for a body with zero wikilinks", () => {
		const body = "Hi {{who}}, again {{who|x}}! {{unknown}}";
		const values = { who: "team" };
		expect(assembleBody(body, new Map(), values)).toBe(resolvePlaceholders(body, values));
	});
});
