import { describe, expect, it } from "vitest";
import { normalizePrompt, type Prompt } from "../src/domain/prompt";
import { emptyQuery, isQueryActive, rankFavoritesFirst, runQuery, type LibraryQuery, type SortKey } from "../src/domain/query";

const CTX_TODAY = "2026-07-02";

function p(path: string, fm: Record<string, unknown>): Prompt {
	return normalizePrompt(fm, { path, filename: path, today: CTX_TODAY });
}

const PROMPTS: Prompt[] = [
	p("a.md", { title: "Alpha", type: "task", category: "dev", tags: ["code", "review"], quality: 5, use_case: "review PRs", visibility: "private", updated: "2026-06-01", favorite: true }),
	p("b.md", { title: "Beta", type: "system", category: "writing", tags: ["tone"], quality: 3, visibility: "public", updated: "2026-06-15", favorite: false }),
	p("c.md", { title: "Gamma", type: "meta-prompt", category: "dev", tags: ["code"], use_case: "meta things", visibility: "private", updated: "2026-05-20", favorite: true }),
	p("d.md", { title: "Delta", type: "task", category: "", tags: [], quality: 1, visibility: "private", updated: "2026-07-01", favorite: false }),
];

const BODIES: Record<string, string> = {
	"a.md": "Check the diff carefully.",
	"b.md": "You are a helpful editor.",
	"c.md": "Generate prompts about prompts.",
	"d.md": "",
};

const getBody = (path: string) => BODIES[path] ?? "";

function q(partial: Partial<LibraryQuery>): LibraryQuery {
	return { ...emptyQuery(), ...partial };
}

describe("runQuery — filters (FR-2.2, AND combination)", () => {
	it("returns everything sorted by updated desc with the empty query", () => {
		const out = runQuery(PROMPTS, getBody, emptyQuery());
		expect(out.map((x) => x.title)).toEqual(["Delta", "Beta", "Alpha", "Gamma"]);
	});

	it("filters by type, including out-of-taxonomy custom values", () => {
		expect(runQuery(PROMPTS, getBody, q({ types: ["task"] }))).toHaveLength(2);
		expect(runQuery(PROMPTS, getBody, q({ types: ["meta-prompt"] })).map((x) => x.title)).toEqual(["Gamma"]);
	});

	it("filters by category and visibility", () => {
		expect(runQuery(PROMPTS, getBody, q({ categories: ["dev"] }))).toHaveLength(2);
		expect(runQuery(PROMPTS, getBody, q({ visibility: "public" })).map((x) => x.title)).toEqual(["Beta"]);
	});

	it("requires ALL selected tags", () => {
		expect(runQuery(PROMPTS, getBody, q({ tags: ["code"] }))).toHaveLength(2);
		expect(runQuery(PROMPTS, getBody, q({ tags: ["code", "review"] })).map((x) => x.title)).toEqual(["Alpha"]);
	});

	it("applies the quality threshold and excludes unrated prompts", () => {
		expect(runQuery(PROMPTS, getBody, q({ minQuality: 3 })).map((x) => x.title)).toEqual(["Beta", "Alpha"]);
	});

	it("combines filters with AND", () => {
		const out = runQuery(PROMPTS, getBody, q({ types: ["task"], categories: ["dev"], minQuality: 4 }));
		expect(out.map((x) => x.title)).toEqual(["Alpha"]);
	});

	it("applies the updated date range inclusively (FR-2.3)", () => {
		const out = runQuery(PROMPTS, getBody, q({ updatedRange: { from: "2026-06-01", to: "2026-06-15" } }));
		expect(out.map((x) => x.title)).toEqual(["Beta", "Alpha"]);
		const openEnd = runQuery(PROMPTS, getBody, q({ updatedRange: { from: "2026-06-16", to: null } }));
		expect(openEnd.map((x) => x.title)).toEqual(["Delta"]);
	});

	it("filters by favoritesOnly, combined with an existing filter via AND (FR-9.4)", () => {
		expect(runQuery(PROMPTS, getBody, q({ favoritesOnly: true })).map((x) => x.title)).toEqual(["Alpha", "Gamma"]);
		expect(
			runQuery(PROMPTS, getBody, q({ favoritesOnly: true, types: ["task"] })).map((x) => x.title),
		).toEqual(["Alpha"]);
	});
});

describe("runQuery — text search (FR-2.4)", () => {
	it("matches title, use_case, and body, case-insensitive", () => {
		expect(runQuery(PROMPTS, getBody, q({ text: "ALPHA" }))).toHaveLength(1);
		expect(runQuery(PROMPTS, getBody, q({ text: "meta things" }))).toHaveLength(1);
		expect(runQuery(PROMPTS, getBody, q({ text: "helpful editor" })).map((x) => x.title)).toEqual(["Beta"]);
	});

	it("combines search with active filters", () => {
		expect(runQuery(PROMPTS, getBody, q({ text: "prompts", types: ["task"] }))).toHaveLength(0);
		expect(runQuery(PROMPTS, getBody, q({ text: "prompts", types: ["meta-prompt"] }))).toHaveLength(1);
	});

	it("treats whitespace-only text as no search", () => {
		expect(runQuery(PROMPTS, getBody, q({ text: "   " }))).toHaveLength(4);
	});
});

describe("runQuery — sort (FR-2.5)", () => {
	it("sorts by created desc, title asc, quality desc", () => {
		expect(runQuery(PROMPTS, getBody, q({ sort: "title-asc" })).map((x) => x.title)).toEqual([
			"Alpha",
			"Beta",
			"Delta",
			"Gamma",
		]);
		const byQuality = runQuery(PROMPTS, getBody, q({ sort: "quality-desc" })).map((x) => x.quality ?? 0);
		expect(byQuality).toEqual([5, 3, 1, 0]);
	});
});

describe("runQuery — favoritesFirst (FR-9.5)", () => {
	const cases: Array<{ sort: SortKey; expected: string[] }> = [
		{ sort: "updated-desc", expected: ["Alpha", "Gamma", "Delta", "Beta"] },
		{ sort: "created-desc", expected: ["Alpha", "Gamma", "Beta", "Delta"] },
		{ sort: "title-asc", expected: ["Alpha", "Gamma", "Beta", "Delta"] },
		{ sort: "quality-desc", expected: ["Alpha", "Gamma", "Beta", "Delta"] },
	];

	for (const { sort, expected } of cases) {
		it(`groups favorites first while preserving ${sort} within each group`, () => {
			const out = runQuery(PROMPTS, getBody, q({ sort, favoritesFirst: true }));
			expect(out.map((x) => x.title)).toEqual(expected);
		});
	}
});

describe("isQueryActive", () => {
	it("detects default vs active state (drives clear-all visibility)", () => {
		expect(isQueryActive(emptyQuery())).toBe(false);
		expect(isQueryActive(q({ text: "x" }))).toBe(true);
		expect(isQueryActive(q({ minQuality: 2 }))).toBe(true);
		expect(isQueryActive(q({ favoritesOnly: true }))).toBe(true);
	});
});

describe("rankFavoritesFirst", () => {
	it("bubbles a favorite above a non-favorite at equal score", () => {
		const items = [
			{ id: "non-fav", score: 1, favorite: false },
			{ id: "fav", score: 1, favorite: true },
		];
		const out = rankFavoritesFirst(items, (x) => x.score, (x) => x.favorite);
		expect(out.map((x) => x.id)).toEqual(["fav", "non-fav"]);
	});

	it("does not let a favorite jump above a higher-scoring non-favorite", () => {
		const items = [
			{ id: "better-non-fav", score: 2, favorite: false },
			{ id: "worse-fav", score: 1, favorite: true },
		];
		const out = rankFavoritesFirst(items, (x) => x.score, (x) => x.favorite);
		expect(out.map((x) => x.id)).toEqual(["better-non-fav", "worse-fav"]);
	});

	it("keeps multiple ties stable in original order", () => {
		const items = [
			{ id: "a", score: 1, favorite: false },
			{ id: "b", score: 1, favorite: false },
			{ id: "c", score: 1, favorite: true },
			{ id: "d", score: 1, favorite: true },
		];
		const out = rankFavoritesFirst(items, (x) => x.score, (x) => x.favorite);
		expect(out.map((x) => x.id)).toEqual(["c", "d", "a", "b"]);
	});
});
