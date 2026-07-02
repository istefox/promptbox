import { describe, expect, it } from "vitest";
import { resolveCollision, slugify } from "../src/domain/slug";

describe("slugify", () => {
	it("lowercases and hyphenates", () => {
		expect(slugify("Review PR Checklist")).toBe("review-pr-checklist");
	});

	it("strips diacritics", () => {
		expect(slugify("Città è già qui")).toBe("citta-e-gia-qui");
	});

	it("collapses symbol runs and trims edges", () => {
		expect(slugify("  --Hello!!! World?? ")).toBe("hello-world");
	});

	it("falls back for empty or symbol-only titles", () => {
		expect(slugify("")).toBe("untitled");
		expect(slugify("!!!")).toBe("untitled");
		expect(slugify("日本語")).toBe("untitled");
	});
});

describe("resolveCollision (FR-3.1)", () => {
	it("returns the slug when free", () => {
		expect(resolveCollision("alpha", () => false)).toBe("alpha");
	});

	it("appends incrementing numeric suffixes", () => {
		const taken = new Set(["alpha", "alpha-1", "alpha-2"]);
		expect(resolveCollision("alpha", (s) => taken.has(s))).toBe("alpha-3");
	});
});
