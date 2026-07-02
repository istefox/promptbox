import { describe, expect, it } from "vitest";
import { parsePlaceholders, resolvePlaceholders } from "../src/domain/placeholders";

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
