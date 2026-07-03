import { describe, expect, it } from "vitest";
import { normalizePrompt, type Prompt } from "../src/domain/prompt";
import { resolveLauncherLookup } from "../src/domain/launcher";

const CTX_TODAY = "2026-07-03";

function p(path: string, fm: Record<string, unknown>): Prompt {
	return normalizePrompt(fm, { path, filename: path, today: CTX_TODAY });
}

const PROMPTS: Prompt[] = [
	p("a.md", { title: "Alpha", updated: "2026-06-01" }),
	p("review.md", { title: "Code Review", updated: "2026-06-01" }),
	p("draft-old.md", { title: "Draft", updated: "2026-06-01" }),
	p("draft-new.md", { title: "Draft", updated: "2026-06-15" }),
	p("same-b.md", { title: "Same", updated: "2026-06-10" }),
	p("same-a.md", { title: "Same", updated: "2026-06-10" }),
];

describe("resolveLauncherLookup (FR-13.2, FR-13.4, FR-13.5)", () => {
	it("falls back to the picker when neither path nor title is given", () => {
		expect(resolveLauncherLookup(PROMPTS, {})).toEqual({ kind: "picker" });
	});

	it("treats blank/whitespace-only path and title as absent", () => {
		expect(resolveLauncherLookup(PROMPTS, { path: "", title: "   " })).toEqual({ kind: "picker" });
	});

	it("matches an exact path", () => {
		const result = resolveLauncherLookup(PROMPTS, { path: "a.md" });
		expect(result).toEqual({ kind: "match", prompt: PROMPTS[0] });
	});

	it("reports no-match/path when the path has no prompt", () => {
		expect(resolveLauncherLookup(PROMPTS, { path: "nope.md" })).toEqual({
			kind: "no-match",
			source: "path",
			value: "nope.md",
		});
	});

	it("never falls back to title when path is set, even if title would match another prompt", () => {
		const result = resolveLauncherLookup(PROMPTS, { path: "nope.md", title: "Code Review" });
		expect(result).toEqual({ kind: "no-match", source: "path", value: "nope.md" });
	});

	it("matches title case-insensitively and trimmed", () => {
		const result = resolveLauncherLookup(PROMPTS, { title: " code review " });
		expect(result).toEqual({ kind: "match", prompt: PROMPTS[1] });
	});

	it("reports no-match/title when the title has no prompt", () => {
		expect(resolveLauncherLookup(PROMPTS, { title: "Nope" })).toEqual({
			kind: "no-match",
			source: "title",
			value: "Nope",
		});
	});

	it("picks the newer updated prompt when title is shared", () => {
		const result = resolveLauncherLookup(PROMPTS, { title: "Draft" });
		expect(result).toEqual({ kind: "match", prompt: PROMPTS[3] });
	});

	it("breaks an updated tie by path ascending", () => {
		const result = resolveLauncherLookup(PROMPTS, { title: "Same" });
		expect(result).toEqual({ kind: "match", prompt: PROMPTS[5] });
	});
});
