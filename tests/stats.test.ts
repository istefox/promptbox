import { describe, expect, it } from "vitest";
import { normalizePrompt, type Prompt } from "../src/domain/prompt";
import { computeLibraryStats, type StatsTaxonomy } from "../src/domain/stats";

const CTX_TODAY = "2026-07-03";

function p(path: string, fm: Record<string, unknown>): Prompt {
	return normalizePrompt(fm, { path, filename: path, today: CTX_TODAY, typeKey: "type", defaultType: "task" });
}

const TAXONOMY: StatsTaxonomy = {
	typeValues: ["task", "system", "meta-prompt"],
	categoryValues: ["dev", "writing"],
};

describe("computeLibraryStats — total", () => {
	it("equals prompts.length, counting a prompt degraded by normalizePrompt (NFR-8)", () => {
		const prompts = [
			p("a.md", { title: "Alpha", type: "task", category: "dev", updated: "2026-06-01" }),
			p("b.md", { title: "Beta", type: "system", quality: "bad", updated: "2026-06-02" }),
		];
		expect(prompts[1]?.warnings.length).toBeGreaterThan(0);
		const stats = computeLibraryStats(prompts, TAXONOMY);
		expect(stats.total).toBe(2);
	});
});

describe("computeLibraryStats — byType / byCategory", () => {
	const prompts = [
		p("a.md", { title: "Alpha", type: "task", category: "dev", updated: "2026-06-01" }),
		p("b.md", { title: "Beta", type: "task", category: "dev", updated: "2026-06-02" }),
		p("c.md", { title: "Gamma", type: "task", category: "writing", updated: "2026-06-03" }),
		p("d.md", { title: "Delta", type: "system", category: "", updated: "2026-06-04" }),
		p("e.md", { title: "Epsilon", type: "meta-prompt", category: "writing", updated: "2026-06-05" }),
		p("f.md", { title: "Zeta", type: "meta-prompt", category: "", updated: "2026-06-06" }),
	];
	const stats = computeLibraryStats(prompts, TAXONOMY);

	it("counts every distinct value, uncapped, sorted count-desc then value-asc", () => {
		expect(stats.byType).toEqual([
			{ value: "task", count: 3 },
			{ value: "meta-prompt", count: 2 },
			{ value: "system", count: 1 },
		]);
	});

	it("excludes the empty category from byCategory", () => {
		expect(stats.byCategory).toEqual([
			{ value: "dev", count: 2 },
			{ value: "writing", count: 2 },
		]);
	});
});

describe("computeLibraryStats — topTags", () => {
	it("caps at 10 with 15+ distinct tags, tie-broken alphabetically", () => {
		const tagNames = Array.from({ length: 15 }, (_, i) => `tag${String(i).padStart(2, "0")}`);
		const prompts = tagNames.map((tag, i) => p(`p${i}.md`, { title: `T${i}`, tags: [tag], updated: "2026-06-01" }));
		// Give the first three tags an extra occurrence so their count (2) outranks the rest (1).
		prompts.push(p("extra.md", { title: "Extra", tags: [tagNames[0], tagNames[1], tagNames[2]], updated: "2026-06-02" }));

		const stats = computeLibraryStats(prompts, TAXONOMY);
		expect(stats.topTags).toHaveLength(10);
		expect(stats.topTags.slice(0, 3)).toEqual([
			{ value: "tag00", count: 2 },
			{ value: "tag01", count: 2 },
			{ value: "tag02", count: 2 },
		]);
		expect(stats.topTags.slice(3)).toEqual([
			{ value: "tag03", count: 1 },
			{ value: "tag04", count: 1 },
			{ value: "tag05", count: 1 },
			{ value: "tag06", count: 1 },
			{ value: "tag07", count: 1 },
			{ value: "tag08", count: 1 },
			{ value: "tag09", count: 1 },
		]);
	});
});

describe("computeLibraryStats — quality distribution", () => {
	it("has exactly 5 ascending rating entries plus unset, summing to total", () => {
		const prompts = [
			p("a.md", { title: "A", quality: 1, updated: "2026-06-01" }),
			p("b.md", { title: "B", quality: 3, updated: "2026-06-02" }),
			p("c.md", { title: "C", quality: 3, updated: "2026-06-03" }),
			p("d.md", { title: "D", quality: 5, updated: "2026-06-04" }),
			p("e.md", { title: "E", updated: "2026-06-05" }),
			p("f.md", { title: "F", updated: "2026-06-06" }),
		];
		const stats = computeLibraryStats(prompts, TAXONOMY);
		expect(stats.quality.ratings).toEqual([
			{ value: "1", count: 1 },
			{ value: "2", count: 0 },
			{ value: "3", count: 2 },
			{ value: "4", count: 0 },
			{ value: "5", count: 1 },
		]);
		expect(stats.quality.unset).toBe(2);
		const sum = stats.quality.ratings.reduce((acc, r) => acc + r.count, 0) + stats.quality.unset;
		expect(sum).toBe(stats.total);
	});
});

describe("computeLibraryStats — stale", () => {
	it("returns the 10 oldest by updated, oldest first, tie-broken title-asc", () => {
		const prompts = Array.from({ length: 12 }, (_, i) =>
			p(`p${i}.md`, { title: `Prompt ${String(i).padStart(2, "0")}`, updated: `2026-06-${String(i + 1).padStart(2, "0")}` }),
		);
		const stats = computeLibraryStats(prompts, TAXONOMY);
		expect(stats.stale).toHaveLength(10);
		expect(stats.stale.map((s) => s.updated)).toEqual([
			"2026-06-01",
			"2026-06-02",
			"2026-06-03",
			"2026-06-04",
			"2026-06-05",
			"2026-06-06",
			"2026-06-07",
			"2026-06-08",
			"2026-06-09",
			"2026-06-10",
		]);
	});

	it("ties on updated break by title-asc", () => {
		const prompts = [
			p("a.md", { title: "Zeta", updated: "2026-06-01" }),
			p("b.md", { title: "Alpha", updated: "2026-06-01" }),
		];
		const stats = computeLibraryStats(prompts, TAXONOMY);
		expect(stats.stale.map((s) => s.title)).toEqual(["Alpha", "Zeta"]);
	});

	it("returns all prompts in order when fewer than 10 exist", () => {
		const prompts = [
			p("a.md", { title: "Alpha", updated: "2026-06-02" }),
			p("b.md", { title: "Beta", updated: "2026-06-01" }),
		];
		const stats = computeLibraryStats(prompts, TAXONOMY);
		expect(stats.stale.map((s) => s.title)).toEqual(["Beta", "Alpha"]);
	});
});

describe("computeLibraryStats — orphanTypes / orphanCategories", () => {
	it("flags a used-but-unconfigured type/category with its usage count, never a configured one", () => {
		const narrowTaxonomy: StatsTaxonomy = { typeValues: ["task", "system"], categoryValues: ["dev"] };
		const prompts = [
			p("a.md", { title: "A", type: "task", category: "dev", updated: "2026-06-01" }),
			p("b.md", { title: "B", type: "system", category: "dev", updated: "2026-06-02" }),
			p("c.md", { title: "C", type: "meta-prompt", category: "research", updated: "2026-06-03" }),
			p("d.md", { title: "D", type: "meta-prompt", category: "research", updated: "2026-06-04" }),
		];
		const stats = computeLibraryStats(prompts, narrowTaxonomy);
		expect(stats.orphanTypes).toEqual([{ value: "meta-prompt", count: 2 }]);
		expect(stats.orphanCategories).toEqual([{ value: "research", count: 2 }]);
		expect(stats.orphanTypes.find((e) => e.value === "task")).toBeUndefined();
		expect(stats.orphanTypes.find((e) => e.value === "system")).toBeUndefined();
		expect(stats.orphanCategories.find((e) => e.value === "dev")).toBeUndefined();
	});
});

describe("computeLibraryStats — empty library", () => {
	it("returns a fully-shaped LibraryStats with no throw", () => {
		const stats = computeLibraryStats([], TAXONOMY);
		expect(stats.total).toBe(0);
		expect(stats.byType).toEqual([]);
		expect(stats.byCategory).toEqual([]);
		expect(stats.topTags).toEqual([]);
		expect(stats.stale).toEqual([]);
		expect(stats.orphanTypes).toEqual([]);
		expect(stats.orphanCategories).toEqual([]);
		expect(stats.quality.unset).toBe(0);
		expect(stats.quality.ratings).toEqual([
			{ value: "1", count: 0 },
			{ value: "2", count: 0 },
			{ value: "3", count: 0 },
			{ value: "4", count: 0 },
			{ value: "5", count: 0 },
		]);
	});
});
