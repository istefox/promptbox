import { describe, expect, it } from "vitest";
import { normalizePrompt, type Prompt } from "../src/domain/prompt";
import { emptyQuery, isQueryActive, runQuery, type LibraryQuery } from "../src/domain/query";

const CTX_TODAY = "2026-07-02";

function p(path: string, fm: Record<string, unknown>): Prompt {
	return normalizePrompt(fm, { path, filename: path, today: CTX_TODAY });
}

const PROMPTS: Prompt[] = [
	p("a.md", { title: "Alpha", type: "task", category: "dev", tags: ["code", "review"], quality: 5, use_case: "review PRs", visibility: "private", updated: "2026-06-01" }),
	p("b.md", { title: "Beta", type: "system", category: "writing", tags: ["tone"], quality: 3, visibility: "public", updated: "2026-06-15" }),
	p("c.md", { title: "Gamma", type: "meta-prompt", category: "dev", tags: ["code"], use_case: "meta things", visibility: "private", updated: "2026-05-20" }),
	p("d.md", { title: "Delta", type: "task", category: "", tags: [], quality: 1, visibility: "private", updated: "2026-07-01" }),
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

describe("isQueryActive", () => {
	it("detects default vs active state (drives clear-all visibility)", () => {
		expect(isQueryActive(emptyQuery())).toBe(false);
		expect(isQueryActive(q({ text: "x" }))).toBe(true);
		expect(isQueryActive(q({ minQuality: 2 }))).toBe(true);
	});
});
