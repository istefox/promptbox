import { describe, expect, it } from "vitest";
import {
	findConflictingVariableNames,
	hasMalformedPlaceholders,
	parsePlaceholders,
	resolvePlaceholders,
} from "../src/domain/placeholders";

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

describe("hasMalformedPlaceholders (L1)", () => {
	it("detects an unclosed opening", () => {
		expect(hasMalformedPlaceholders("Hello {{name")).toBe(true);
	});

	it("detects malformed constructs the parser silently skips", () => {
		expect(hasMalformedPlaceholders("{{}}")).toBe(true);
		expect(hasMalformedPlaceholders("{{ }}")).toBe(true);
		expect(hasMalformedPlaceholders("{{|def}}")).toBe(true);
	});

	it("detects more than three pipe segments", () => {
		expect(hasMalformedPlaceholders("{{a|b|c|d}}")).toBe(true);
	});

	it("detects the dangling brace left behind by a nested construct", () => {
		expect(hasMalformedPlaceholders("{{a{{b}}}}")).toBe(true);
	});

	it("is false for a body with only well-formed placeholders, or none", () => {
		expect(hasMalformedPlaceholders("{{name|def|hint}} well-formed")).toBe(false);
		expect(hasMalformedPlaceholders("no placeholders here")).toBe(false);
	});
});

describe("findConflictingVariableNames (L2)", () => {
	it("flags a name whose occurrences disagree on defaultValue", () => {
		expect(findConflictingVariableNames("{{a|x}} … {{a|y}}")).toEqual(["a"]);
	});

	it("does not flag repeated occurrences with the same value", () => {
		expect(findConflictingVariableNames("{{a|x}} {{a|x}}")).toEqual([]);
	});

	it("flags two independently-conflicting names in first-appearance order", () => {
		expect(findConflictingVariableNames("{{b|1}} {{a|x}} {{b|2}} {{a|y}}")).toEqual(["b", "a"]);
	});

	it("flags a conflict between an option list and a plain default for the same name", () => {
		expect(findConflictingVariableNames("{{t|a,b}} {{t|a}}")).toEqual(["t"]);
	});
});
