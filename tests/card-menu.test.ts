import { describe, expect, it } from "vitest";
import { buildCardMenuEntries } from "../src/domain/card-menu";
import { normalizePrompt, type Prompt } from "../src/domain/prompt";

const CTX_TODAY = "2026-07-11";

function p(fm: Record<string, unknown>): Prompt {
	return normalizePrompt(fm, { path: "a.md", filename: "a.md", today: CTX_TODAY });
}

describe("buildCardMenuEntries (issue #33)", () => {
	it("returns the 6 entries in a fixed order", () => {
		const entries = buildCardMenuEntries(p({ title: "Alpha" }));
		expect(entries.map((e) => e.actionKey)).toEqual([
			"copy-with-variables",
			"copy-raw",
			"edit-metadata",
			"open-as-note",
			"toggle-favorite",
			"delete",
		]);
	});

	it("labels the favorite entry 'Add to favorites' when not favorited", () => {
		const entries = buildCardMenuEntries(p({ title: "Alpha", favorite: false }));
		const favorite = entries.find((e) => e.actionKey === "toggle-favorite");
		expect(favorite?.label).toBe("Add to favorites");
	});

	it("labels the favorite entry 'Remove from favorites' when favorited", () => {
		const entries = buildCardMenuEntries(p({ title: "Alpha", favorite: true }));
		const favorite = entries.find((e) => e.actionKey === "toggle-favorite");
		expect(favorite?.label).toBe("Remove from favorites");
	});

	it("marks only the delete entry as warning and separatorBefore", () => {
		const entries = buildCardMenuEntries(p({ title: "Alpha" }));
		const nonDelete = entries.filter((e) => e.actionKey !== "delete");
		for (const entry of nonDelete) {
			expect(entry.warning).toBe(false);
			expect(entry.separatorBefore).toBe(false);
		}
		const del = entries.find((e) => e.actionKey === "delete");
		expect(del?.warning).toBe(true);
		expect(del?.separatorBefore).toBe(true);
	});
});

describe("buildCardMenuEntries chain awareness (ADR-0018)", () => {
	it("replaces the two copy entries with a single 'Run chain' entry when canRunChain is true", () => {
		const entries = buildCardMenuEntries(p({ title: "Chain", chain: ["b.md", "c.md"] }), true);
		expect(entries.map((e) => e.actionKey)).toEqual([
			"open-chain",
			"edit-metadata",
			"open-as-note",
			"toggle-favorite",
			"delete",
		]);
		expect(entries[0]?.label).toBe("Run chain");
	});

	it("labels the entry 'Edit chain' when canRunChain is false", () => {
		const entries = buildCardMenuEntries(p({ title: "Chain", chain: ["b.md"] }), false);
		const chainEntry = entries.find((e) => e.actionKey === "open-chain");
		expect(chainEntry?.label).toBe("Edit chain");
	});

	it("defaults to 'Edit chain' when canRunChain is omitted", () => {
		const entries = buildCardMenuEntries(p({ title: "Chain", chain: ["b.md", "c.md"] }));
		const chainEntry = entries.find((e) => e.actionKey === "open-chain");
		expect(chainEntry?.label).toBe("Edit chain");
	});

	it("leaves a non-chain prompt's entries untouched even when canRunChain is true", () => {
		const entries = buildCardMenuEntries(p({ title: "Alpha" }), true);
		expect(entries.map((e) => e.actionKey)).toEqual([
			"copy-with-variables",
			"copy-raw",
			"edit-metadata",
			"open-as-note",
			"toggle-favorite",
			"delete",
		]);
	});
});
