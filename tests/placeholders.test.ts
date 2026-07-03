import { describe, expect, it } from "vitest";
import { isContextVariable, matchPlaceholders, parsePlaceholders, resolvePlaceholders } from "../src/domain/placeholders";

describe("parsePlaceholders (FR-4.1, FR-4.2)", () => {
	it("parses the three syntax forms", () => {
		expect(parsePlaceholders("{{name}}")).toEqual([{ name: "name", defaultValue: "", hint: "" }]);
		expect(parsePlaceholders("{{name|def}}")).toEqual([{ name: "name", defaultValue: "def", hint: "" }]);
		expect(parsePlaceholders("{{name|def|hint text}}")).toEqual([
			{ name: "name", defaultValue: "def", hint: "hint text" },
		]);
	});

	it("allows an empty default with a hint", () => {
		expect(parsePlaceholders("{{name||fill me}}")).toEqual([{ name: "name", defaultValue: "", hint: "fill me" }]);
	});

	it("collects unique names in order of first appearance, first occurrence wins", () => {
		const vars = parsePlaceholders("{{b|1}} {{a}} {{b|2|other}} {{a|late}}");
		expect(vars).toEqual([
			{ name: "b", defaultValue: "1", hint: "" },
			{ name: "a", defaultValue: "", hint: "" },
		]);
	});

	it("handles unicode names and adjacency", () => {
		expect(parsePlaceholders("{{città}}{{日本語|デフォルト}}").map((v) => v.name)).toEqual(["città", "日本語"]);
	});

	it("skips malformed constructs (FR-4.6)", () => {
		expect(parsePlaceholders("{{}} {{ }} {{|def}} {{a|b|c|d}} {{unclosed")).toEqual([]);
	});

	it("extracts only the innermost well-formed placeholder when braces nest", () => {
		expect(parsePlaceholders("{{a{{b}}}}").map((v) => v.name)).toEqual(["b"]);
	});

	it("parses a comma-separated default as dropdown options, first preselected", () => {
		expect(parsePlaceholders("{{tone|formale,informale,tecnico|Registro}}")).toEqual([
			{ name: "tone", defaultValue: "formale", hint: "Registro", options: ["formale", "informale", "tecnico"] },
		]);
		expect(parsePlaceholders("{{x|a, b , c}}")[0]?.options).toEqual(["a", "b", "c"]);
	});

	it("keeps non-list defaults verbatim: trailing or empty comma segments are not options", () => {
		expect(parsePlaceholders("{{x|a,}}")[0]).toEqual({ name: "x", defaultValue: "a,", hint: "" });
		expect(parsePlaceholders("{{x|,}}")[0]).toEqual({ name: "x", defaultValue: ",", hint: "" });
		expect(parsePlaceholders("{{x|solo}}")[0]?.options).toBeUndefined();
	});

	it("first occurrence wins between options and plain declarations", () => {
		const vars = parsePlaceholders("{{t|a,b}} {{t|later}}");
		expect(vars).toHaveLength(1);
		expect(vars[0]?.options).toEqual(["a", "b"]);
	});

	it("resolves option placeholders like any other value", () => {
		expect(resolvePlaceholders("Say {{t|a,b}}!", { t: "b" })).toBe("Say b!");
	});

	it("trims the name but preserves default and hint verbatim", () => {
		expect(parsePlaceholders("{{ name | keep spaces | hint }}")).toEqual([
			{ name: "name", defaultValue: " keep spaces ", hint: " hint " },
		]);
	});
});

describe("resolvePlaceholders (FR-4.2, FR-4.6)", () => {
	it("replaces all occurrences of the same name", () => {
		expect(resolvePlaceholders("Hi {{who}}, again {{who|x}}!", { who: "team" })).toBe("Hi team, again team!");
	});

	it("leaves malformed constructs and unknown names untouched", () => {
		const body = "{{}} {{a|b|c|d}} {{known}} {{unknown}} {{unclosed";
		expect(resolvePlaceholders(body, { known: "V" })).toBe("{{}} {{a|b|c|d}} V {{unknown}} {{unclosed");
	});

	it("supports empty replacement values", () => {
		expect(resolvePlaceholders("[{{gap}}]", { gap: "" })).toBe("[]");
	});

	it("keeps raw bodies for other templating systems intact when no values are provided", () => {
		const jinja = "{% for x in items %}{{ x }}{% endfor %}";
		expect(resolvePlaceholders(jinja, {})).toBe(jinja);
	});
});

describe("matchPlaceholders", () => {
	it("returns raw text, start/end offsets, and the parsed variable for each match", () => {
		const body = "Hi {{name}}!";
		expect(matchPlaceholders(body)).toEqual([
			{ raw: "{{name}}", start: 3, end: 11, variable: { name: "name", defaultValue: "", hint: "" } },
		]);
	});

	it("returns a null variable for malformed constructs, still with correct offsets", () => {
		const body = "{{}} {{known}}";
		const matches = matchPlaceholders(body);
		expect(matches).toHaveLength(2);
		expect(matches[0]).toEqual({ raw: "{{}}", start: 0, end: 4, variable: null });
		expect(matches[1]?.variable?.name).toBe("known");
	});

	it("returns one entry per occurrence, not deduplicated by name", () => {
		const matches = matchPlaceholders("{{who}} and {{who}}");
		expect(matches).toHaveLength(2);
		expect(matches[0]?.variable?.name).toBe("who");
		expect(matches[1]?.variable?.name).toBe("who");
	});
});

describe("isContextVariable (FR-10.1)", () => {
	it("recognizes the four supported reserved names", () => {
		expect(isContextVariable("@selection")).toBe(true);
		expect(isContextVariable("@title")).toBe(true);
		expect(isContextVariable("@date")).toBe(true);
		expect(isContextVariable("@clipboard")).toBe(true);
	});

	it("rejects ordinary names", () => {
		expect(isContextVariable("selection")).toBe(false);
		expect(isContextVariable("")).toBe(false);
		expect(isContextVariable("client")).toBe(false);
	});

	it("reserves the whole @ namespace, not just the four known names", () => {
		expect(isContextVariable("@")).toBe(true);
		expect(isContextVariable("@unknown")).toBe(true);
	});

	it("stays agnostic of @: the parser still returns @-names unchanged, ignoring is the caller's job", () => {
		expect(parsePlaceholders("{{@title|fallback|hint}}")).toEqual([
			{ name: "@title", defaultValue: "fallback", hint: "hint" },
		]);
	});
});
