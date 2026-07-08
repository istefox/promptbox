import { describe, expect, it } from "vitest";
import { scoreLibraryMatch, titleMatchRanges, type SearchFields } from "../src/domain/search";

const fields = (title: string, useCase = "", body = ""): SearchFields => ({ title, useCase, body });

describe("scoreLibraryMatch — token AND & word order (issue #30, FR-2.4)", () => {
	it("matches a multi-word query regardless of token order", () => {
		expect(scoreLibraryMatch("prompt test", fields("test prompt"))).not.toBeNull();
		expect(scoreLibraryMatch("test prompt", fields("test prompt"))).not.toBeNull();
	});

	it("returns null when any query token matches no field", () => {
		expect(scoreLibraryMatch("test zzzz", fields("test prompt"))).toBeNull();
	});

	it("spreads tokens across fields (title + body) via AND", () => {
		expect(scoreLibraryMatch("alpha diff", fields("Alpha", "", "check the diff"))).not.toBeNull();
	});

	it("treats an empty query as a zero-score match", () => {
		expect(scoreLibraryMatch("   ", fields("anything"))).toEqual({ score: 0, titleRanges: [] });
	});
});

describe("scoreLibraryMatch — subsequence, case, diacritics", () => {
	it("matches non-contiguous subsequences", () => {
		expect(scoreLibraryMatch("tmpl", fields("Template Builder"))).not.toBeNull();
	});

	it("is case-insensitive", () => {
		expect(scoreLibraryMatch("ALPHA", fields("alpha"))).not.toBeNull();
	});

	it("folds diacritics on both the query and the fields", () => {
		expect(scoreLibraryMatch("puo", fields("Si può fare"))).not.toBeNull();
		expect(scoreLibraryMatch("café", fields("cafe list"))).not.toBeNull();
	});
});

describe("scoreLibraryMatch — field weighting", () => {
	it("scores a title match above an otherwise-identical body-only match", () => {
		const inTitle = scoreLibraryMatch("checklist", fields("Release checklist"));
		const inBody = scoreLibraryMatch("checklist", fields("Notes", "", "a release checklist"));
		expect(inTitle).not.toBeNull();
		expect(inBody).not.toBeNull();
		expect(inTitle?.score ?? 0).toBeGreaterThan(inBody?.score ?? 0);
	});

	it("rewards a contiguous run over a scattered subsequence", () => {
		const contiguous = scoreLibraryMatch("test", fields("test"));
		const scattered = scoreLibraryMatch("test", fields("t e s t case"));
		expect(contiguous?.score ?? 0).toBeGreaterThan(scattered?.score ?? 0);
	});
});

describe("titleMatchRanges", () => {
	it("returns [] when there is no query", () => {
		expect(titleMatchRanges("", "Test Prompt")).toEqual([]);
	});

	it("collapses adjacent matched chars into contiguous ranges", () => {
		expect(titleMatchRanges("prompt", "test prompt")).toEqual([[5, 11]]);
	});

	it("returns ascending, non-overlapping ranges for a multi-word query", () => {
		expect(titleMatchRanges("test prompt", "test prompt")).toEqual([
			[0, 4],
			[5, 11],
		]);
	});

	it("maps indices back to the original title even with diacritics", () => {
		const title = "può";
		const ranges = titleMatchRanges("puo", title);
		expect(ranges).toEqual([[0, 3]]);
		const [start, end] = ranges[0] ?? [0, 0];
		expect(title.slice(start, end)).toBe("può");
	});

	it("only highlights tokens present in the title", () => {
		// "diff" lives in the body, not the title -> no title range for it.
		expect(titleMatchRanges("alpha diff", "Alpha")).toEqual([[0, 5]]);
	});
});
