import { describe, expect, it } from "vitest";
import { isCustomValue, isReservedTypeKeyCollision, isValidTypeKeyFormat, normalizePrompt } from "../src/domain/prompt";

const CTX = { path: "Prompts/x.md", filename: "x", today: "2026-07-02", typeKey: "type", defaultType: "task" };

describe("normalizePrompt — happy path", () => {
	it("maps a fully valid frontmatter", () => {
		const p = normalizePrompt(
			{
				title: "Review PR",
				type: "task",
				category: "dev",
				tags: ["code", "review"],
				quality: 4,
				use_case: "PR review checklist",
				visibility: "public",
				version: "2.1",
				created: "2026-01-10",
				updated: "2026-06-01",
			},
			CTX,
		);
		expect(p.title).toBe("Review PR");
		expect(p.quality).toBe(4);
		expect(p.visibility).toBe("public");
		expect(p.useCase).toBe("PR review checklist");
		expect(p.warnings).toEqual([]);
	});
});

describe("normalizePrompt — tolerance (NFR-8, never throws)", () => {
	it("handles missing frontmatter entirely", () => {
		const p = normalizePrompt(undefined, CTX);
		expect(p.title).toBe("x");
		expect(p.type).toBe("task");
		expect(p.visibility).toBe("private");
		expect(p.version).toBe("1.0");
		expect(p.created).toBe("2026-07-02");
		expect(p.warnings.length).toBeGreaterThan(0);
	});

	it("handles non-mapping frontmatter", () => {
		for (const hostile of ["just a string", 42, true, ["a", "b"]]) {
			expect(() => normalizePrompt(hostile, CTX)).not.toThrow();
			expect(normalizePrompt(hostile, CTX).title).toBe("x");
		}
	});

	it("degrades wrong-typed scalar fields with warnings", () => {
		const p = normalizePrompt(
			{ title: ["not", "a", "string"], type: { nested: true }, use_case: null },
			CTX,
		);
		expect(p.title).toBe("x");
		expect(p.type).toBe("task");
		expect(p.useCase).toBe("");
		expect(p.warnings).toContain("invalid title: expected string");
		expect(p.warnings).toContain("invalid type: expected string");
	});

	it("coerces numeric title and version", () => {
		const p = normalizePrompt({ title: 123, version: 2 }, CTX);
		expect(p.title).toBe("123");
		expect(p.version).toBe("2");
	});

	it("tolerates hostile tags", () => {
		expect(normalizePrompt({ tags: "a, b ,, c" }, CTX).tags).toEqual(["a", "b", "c"]);
		expect(normalizePrompt({ tags: [1, "x", null, { bad: 1 }] }, CTX).tags).toEqual(["1", "x"]);
		const invalid = normalizePrompt({ tags: 42 }, CTX);
		expect(invalid.tags).toEqual([]);
		expect(invalid.warnings).toContain("invalid tags: expected list or string");
	});

	it("rejects out-of-range or non-integer quality", () => {
		expect(normalizePrompt({ quality: 0 }, CTX).quality).toBeUndefined();
		expect(normalizePrompt({ quality: 6 }, CTX).quality).toBeUndefined();
		expect(normalizePrompt({ quality: 3.5 }, CTX).quality).toBeUndefined();
		expect(normalizePrompt({ quality: "4" }, CTX).quality).toBe(4);
		expect(normalizePrompt({ quality: "high" }, CTX).quality).toBeUndefined();
	});

	it("falls back on invalid visibility and dates", () => {
		const p = normalizePrompt(
			{ visibility: "team", created: "yesterday", updated: "2026-13-99" },
			CTX,
		);
		expect(p.visibility).toBe("private");
		expect(p.created).toBe("2026-07-02");
		expect(p.updated).toBe("2026-07-02");
		expect(p.warnings).toContain("invalid visibility: expected private|public");
	});

	it("accepts out-of-taxonomy type values without blocking (§3.2 rules)", () => {
		const p = normalizePrompt({ type: "meta-prompt" }, CTX);
		expect(p.type).toBe("meta-prompt");
		expect(isCustomValue(p.type, ["system", "task", "agent", "snippet"])).toBe(true);
		expect(isCustomValue("task", ["system", "task", "agent", "snippet"])).toBe(false);
	});

	it("passes unknown and namespaced phase-2 fields through custom", () => {
		const p = normalizePrompt(
			{ title: "t", community_id: "abc-123", promptbox_origin: { repo: "catalog" }, stray: 7 },
			CTX,
		);
		expect(p.custom).toEqual({
			community_id: "abc-123",
			promptbox_origin: { repo: "catalog" },
			stray: 7,
		});
	});
});

describe("favorite (FR-9.1)", () => {
	it("parses true and leaves warnings untouched", () => {
		const p = normalizePrompt({ title: "t", favorite: true }, CTX);
		const baseline = normalizePrompt({ title: "t" }, CTX);
		expect(p.favorite).toBe(true);
		expect(p.warnings).toEqual(baseline.warnings);
	});

	it("defaults to false when absent, without affecting warnings", () => {
		const withoutField = normalizePrompt({ title: "t" }, CTX);
		const baseline = normalizePrompt({ title: "t" }, CTX);
		expect(withoutField.favorite).toBe(false);
		expect(withoutField.warnings).toEqual(baseline.warnings);
	});

	it("treats a malformed value as false with a warning-free render (acceptance criterion)", () => {
		const malformed = normalizePrompt({ title: "t", favorite: "yes please" }, CTX);
		const baseline = normalizePrompt({ title: "t" }, CTX);
		expect(malformed.favorite).toBe(false);
		expect(malformed.warnings).toEqual(baseline.warnings);
	});

	it("rejects every non-true value as false", () => {
		for (const value of [1, 0, null, [], {}, "true", undefined]) {
			expect(normalizePrompt({ favorite: value }, CTX).favorite).toBe(false);
		}
	});

	it("never leaks into custom", () => {
		const p = normalizePrompt({ title: "t", favorite: true }, CTX);
		expect(p.custom).toEqual({});
	});
});

describe("chain (ADR-0018)", () => {
	it("is undefined when the key is absent", () => {
		const p = normalizePrompt({ title: "t" }, CTX);
		expect(p.chain).toBeUndefined();
	});

	it("normalizes a well-formed list and keeps it out of custom", () => {
		const p = normalizePrompt({ title: "t", chain: ["a.md", "b.md"] }, CTX);
		expect(p.chain).toEqual(["a.md", "b.md"]);
		expect(p.custom).not.toHaveProperty("chain");
	});

	it("is present but empty for chain: [], distinct from absence", () => {
		const p = normalizePrompt({ title: "t", chain: [] }, CTX);
		expect(p.chain).toEqual([]);
		expect(p.chain).not.toBeUndefined();
	});

	it("tolerates a scalar value, normalizing to [] without an extra warning", () => {
		const p = normalizePrompt({ title: "t", chain: "a.md" }, CTX);
		const baseline = normalizePrompt({ title: "t" }, CTX);
		expect(p.chain).toEqual([]);
		expect(p.warnings).toEqual(baseline.warnings);
	});
});

describe("excludedPlaceholders", () => {
	it("defaults to [] when the key is absent", () => {
		const p = normalizePrompt({ title: "t" }, CTX);
		expect(p.excludedPlaceholders).toEqual([]);
	});

	it("normalizes a well-formed list and keeps it out of custom", () => {
		const p = normalizePrompt({ title: "t", excluded_placeholders: ["CATEGORY", "TOPIC"] }, CTX);
		expect(p.excludedPlaceholders).toEqual(["CATEGORY", "TOPIC"]);
		expect(p.custom).not.toHaveProperty("excluded_placeholders");
	});

	it("accepts a comma-separated string", () => {
		const p = normalizePrompt({ title: "t", excluded_placeholders: "CATEGORY, TOPIC" }, CTX);
		expect(p.excludedPlaceholders).toEqual(["CATEGORY", "TOPIC"]);
	});

	it("warns and defaults to [] for an invalid type", () => {
		const p = normalizePrompt({ title: "t", excluded_placeholders: { nested: true } }, CTX);
		expect(p.excludedPlaceholders).toEqual([]);
		expect(p.warnings).toContain("invalid excluded_placeholders: expected list or string");
	});
});

describe("configurable type key (issue #46)", () => {
	const CUSTOM_CTX = { ...CTX, typeKey: "prompt_type", defaultType: "note" };

	it("reads the type value from the configured key instead of the literal \"type\"", () => {
		const p = normalizePrompt({ title: "t", prompt_type: "agent" }, CUSTOM_CTX);
		expect(p.type).toBe("agent");
		expect(p.warnings).not.toContain("missing prompt_type");
	});

	it("falls back to the configured default, with a missing-<key> warning, when the key is absent", () => {
		const p = normalizePrompt({ title: "t" }, CUSTOM_CTX);
		expect(p.type).toBe("note");
		expect(p.warnings).toContain("missing prompt_type");
	});

	it("routes a stale literal \"type\" value into custom once the key is renamed away from it", () => {
		const p = normalizePrompt({ title: "t", type: "task" }, CUSTOM_CTX);
		expect(p.custom).toEqual({ type: "task" });
		expect(p.type).toBe("note");
		expect(p.warnings).toContain("missing prompt_type");
	});

	it("keeps the default key's own value out of custom", () => {
		const p = normalizePrompt({ title: "t", type: "task" }, CTX);
		expect(p.custom).toEqual({});
	});
});

describe("isValidTypeKeyFormat (issue #46)", () => {
	it("accepts simple YAML identifiers", () => {
		for (const key of ["type", "prompt_type", "promptbox-type", "_type", "a1"]) {
			expect(isValidTypeKeyFormat(key)).toBe(true);
		}
	});

	it("rejects empty strings, spaces, and keys starting with a digit or symbol", () => {
		for (const key of ["", " ", "prompt type", "1type", "@type", "type!"]) {
			expect(isValidTypeKeyFormat(key)).toBe(false);
		}
	});
});

describe("isReservedTypeKeyCollision (issue #46)", () => {
	it("flags every other field Promptbox reserves", () => {
		for (const key of ["title", "category", "tags", "quality", "use_case", "visibility", "version", "created", "updated", "favorite", "chain", "excluded_placeholders"]) {
			expect(isReservedTypeKeyCollision(key)).toBe(true);
		}
	});

	it("does not flag \"type\" itself or an unrelated custom key", () => {
		expect(isReservedTypeKeyCollision("type")).toBe(false);
		expect(isReservedTypeKeyCollision("prompt_type")).toBe(false);
	});
});
