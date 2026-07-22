import { describe, expect, it } from "vitest";
import { normalizePrompt, type Prompt } from "../src/domain/prompt";
import { relatedPrompts, similarityScore } from "../src/domain/related";

const CTX_TODAY = "2026-07-03";

function p(path: string, fm: Record<string, unknown>): Prompt {
	return normalizePrompt(fm, { path, filename: path, today: CTX_TODAY, typeKey: "type", defaultType: "task" });
}

describe("similarityScore (FR-18.1)", () => {
	it("returns 0 for two prompts sharing nothing", () => {
		const a = p("a.md", { title: "Alpha", category: "dev", tags: ["code"] });
		const b = p("b.md", { title: "Beta", category: "writing", tags: ["tone"] });
		expect(similarityScore(a, b)).toBe(0);
	});

	it("scores +3 per shared tag, deduplicated within a prompt's own tags", () => {
		const a = p("a.md", { title: "Alpha", tags: ["code", "review", "code"] });
		const b = p("b.md", { title: "Beta", tags: ["code", "review"] });
		expect(similarityScore(a, b)).toBe(6);
	});

	it("scores +2 only when both categories are non-empty and equal", () => {
		const a = p("a.md", { title: "Alpha", category: "dev" });
		const b = p("b.md", { title: "Beta", category: "dev" });
		expect(similarityScore(a, b)).toBe(2);

		const bothEmpty1 = p("c.md", { title: "Gamma", category: "" });
		const bothEmpty2 = p("d.md", { title: "Delta", category: "" });
		expect(similarityScore(bothEmpty1, bothEmpty2)).toBe(0);
	});

	it("scores +1 per distinct shared token from title+use_case, case- and diacritics-insensitive", () => {
		const a = p("a.md", { title: "Città review", use_case: "resume writing" });
		const b = p("b.md", { title: "citta summary", use_case: "RESUME help" });
		// shared tokens: "citta" (title/title), "resume" (use_case/use_case) => 2
		expect(similarityScore(a, b)).toBe(2);
	});

	it("combines tags, category, and token overlap additively", () => {
		const a = p("a.md", { title: "Review checklist", category: "dev", tags: ["code", "review"] });
		const b = p("b.md", { title: "Review notes", category: "dev", tags: ["code", "review"] });
		// 2 shared tags (6) + same category (2) + 1 shared token "review" (1) = 9
		expect(similarityScore(a, b)).toBe(9);
	});

	it("is symmetric", () => {
		const a = p("a.md", { title: "Review checklist", category: "dev", tags: ["code", "review"] });
		const b = p("b.md", { title: "Review notes", category: "dev", tags: ["code"] });
		expect(similarityScore(a, b)).toBe(similarityScore(b, a));
	});

	it("matches tags case-sensitively", () => {
		const a = p("a.md", { title: "Alpha", tags: ["Code"] });
		const b = p("b.md", { title: "Beta", tags: ["code"] });
		expect(similarityScore(a, b)).toBe(0);
	});
});

describe("relatedPrompts (FR-18.2)", () => {
	it("acceptance criterion 1: 2 shared tags + same category outranks 1 shared title token", () => {
		const target = p("target.md", { title: "Review checklist", category: "dev", tags: ["code", "review"] });
		const strong = p("strong.md", { title: "Unrelated", category: "dev", tags: ["code", "review"] });
		const weak = p("weak.md", { title: "Review notes", category: "", tags: [] });
		const out = relatedPrompts(target, [target, strong, weak]);
		expect(out.map((x) => x.path)).toEqual(["strong.md", "weak.md"]);
	});

	it("acceptance criterion 2: fully unique tags, category, and title scores zero and is excluded", () => {
		const target = p("target.md", { title: "Review checklist", category: "dev", tags: ["code", "review"] });
		const unrelated = p("unrelated.md", { title: "Something else entirely", category: "writing", tags: ["tone"] });
		expect(relatedPrompts(target, [target, unrelated])).toEqual([]);
	});

	it("excludes the target itself even when present in all", () => {
		const target = p("target.md", { title: "Review checklist", category: "dev", tags: ["code"] });
		const other = p("other.md", { title: "Other", category: "dev", tags: ["code"] });
		const out = relatedPrompts(target, [target, other]);
		expect(out.map((x) => x.path)).toEqual(["other.md"]);
	});

	it("excludes zero-score prompts, keeping only strictly positive matches", () => {
		const target = p("target.md", { title: "Review checklist", category: "dev", tags: ["code"] });
		const related = p("related.md", { title: "Other", category: "dev", tags: ["code"] });
		const unrelated = p("unrelated.md", { title: "Nothing", category: "", tags: [] });
		const out = relatedPrompts(target, [target, related, unrelated]);
		expect(out.map((x) => x.path)).toEqual(["related.md"]);
	});

	it("ties on score break by newest updated first", () => {
		const target = p("target.md", { title: "Review checklist", category: "dev", tags: [] });
		const older = p("older.md", { title: "X", category: "dev", updated: "2026-01-01" });
		const newer = p("newer.md", { title: "X", category: "dev", updated: "2026-06-01" });
		const out = relatedPrompts(target, [target, older, newer]);
		expect(out.map((x) => x.path)).toEqual(["newer.md", "older.md"]);
	});

	it("ties on score and updated break by path ascending", () => {
		const target = p("target.md", { title: "Review checklist", category: "dev", tags: [] });
		const b = p("b.md", { title: "X", category: "dev", updated: "2026-06-01" });
		const a = p("a.md", { title: "X", category: "dev", updated: "2026-06-01" });
		const out = relatedPrompts(target, [target, b, a]);
		expect(out.map((x) => x.path)).toEqual(["a.md", "b.md"]);
	});

	it("defaults limit to 5 and truncates to top-N by score with an explicit smaller limit", () => {
		const target = p("target.md", { title: "Review checklist", category: "dev", tags: ["code", "review"] });
		const all: Prompt[] = [target];
		for (let i = 0; i < 7; i++) {
			all.push(p(`n${i}.md`, { title: "X", category: "dev", tags: ["code", "review"], updated: `2026-06-0${i + 1}` }));
		}
		expect(relatedPrompts(target, all)).toHaveLength(5);
		expect(relatedPrompts(target, all, 2)).toHaveLength(2);
		expect(relatedPrompts(target, all, 2).map((x) => x.path)).toEqual(["n6.md", "n5.md"]);
	});
});
