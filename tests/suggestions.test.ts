import { describe, expect, it } from "vitest";
import { suggestValues } from "../src/domain/suggestions";

describe("suggestValues (FR-11.1)", () => {
	it("matches case-insensitively", () => {
		const result = suggestValues({ title: "Review", useCase: "", body: "" }, ["review"], [], 5);
		expect(result).toEqual(["review"]);
	});

	it("ranks by token frequency, most frequent first", () => {
		const result = suggestValues(
			{ title: "review review review", useCase: "writing", body: "" },
			["review", "writing"],
			[],
			5,
		);
		expect(result).toEqual(["review", "writing"]);
	});

	it("tokenizes multi-token candidates and scores on either sub-token", () => {
		const result = suggestValues({ title: "", useCase: "", body: "code snippet" }, ["code-review"], [], 5);
		expect(result).toEqual(["code-review"]);
	});

	it("excludes candidates already present in selected", () => {
		const result = suggestValues({ title: "review", useCase: "", body: "" }, ["review"], ["review"], 5);
		expect(result).toEqual([]);
	});

	it("excludes zero-score candidates with no token overlap", () => {
		const result = suggestValues({ title: "review", useCase: "", body: "" }, ["review", "unrelated"], [], 5);
		expect(result).toEqual(["review"]);
	});

	it("truncates a larger eligible pool to limit", () => {
		const result = suggestValues(
			{ title: "alpha beta gamma delta", useCase: "", body: "" },
			["alpha", "beta", "gamma", "delta"],
			[],
			2,
		);
		expect(result).toHaveLength(2);
	});

	it("breaks ties deterministically by ascending localeCompare", () => {
		const result = suggestValues({ title: "review", useCase: "", body: "" }, ["zeta-review", "alpha-review"], [], 5);
		expect(result).toEqual(["alpha-review", "zeta-review"]);
	});

	it("returns [] when title, useCase, and body are all empty", () => {
		const result = suggestValues({ title: "", useCase: "", body: "" }, ["review"], [], 5);
		expect(result).toEqual([]);
	});

	it("returns [] for an empty candidates array", () => {
		const result = suggestValues({ title: "review", useCase: "", body: "" }, [], [], 5);
		expect(result).toEqual([]);
	});

	it("never produces duplicate entries from duplicate candidates", () => {
		const result = suggestValues({ title: "review", useCase: "", body: "" }, ["review", "review"], [], 5);
		expect(result).toEqual(["review"]);
	});
});
