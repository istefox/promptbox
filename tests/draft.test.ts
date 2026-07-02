import { describe, expect, it } from "vitest";
import { bumpVersion, draftToFrontmatter, type PromptDraft } from "../src/domain/draft";

const FULL: PromptDraft = {
	title: "  Review PR  ",
	type: "task",
	category: "dev",
	tags: ["code", "review"],
	quality: 4,
	useCase: "PR checklist",
	visibility: "public",
	version: "2.1",
	body: "Check the diff.",
};

describe("draftToFrontmatter", () => {
	it("maps all fields and trims strings", () => {
		expect(draftToFrontmatter(FULL)).toEqual({
			title: "Review PR",
			type: "task",
			category: "dev",
			tags: ["code", "review"],
			quality: 4,
			use_case: "PR checklist",
			visibility: "public",
			version: "2.1",
		});
	});

	it("omits empty optionals and defaults version", () => {
		const fm = draftToFrontmatter({
			...FULL,
			category: " ",
			tags: [],
			quality: undefined,
			useCase: "",
			version: "",
		});
		expect(fm).toEqual({
			title: "Review PR",
			type: "task",
			visibility: "public",
			version: "1.0",
		});
	});

	it("copies the tags array defensively", () => {
		const fm = draftToFrontmatter(FULL);
		(fm["tags"] as string[]).push("mutated");
		expect(FULL.tags).toEqual(["code", "review"]);
	});
});

describe("bumpVersion (FR-3.2)", () => {
	it("increments the trailing numeric segment", () => {
		expect(bumpVersion("1.0")).toEqual({ value: "1.1", bumped: true });
		expect(bumpVersion("1.9")).toEqual({ value: "1.10", bumped: true });
		expect(bumpVersion("2")).toEqual({ value: "3", bumped: true });
		expect(bumpVersion("v3")).toEqual({ value: "v4", bumped: true });
	});

	it("returns non-parseable versions unchanged", () => {
		expect(bumpVersion("abc")).toEqual({ value: "abc", bumped: false });
		expect(bumpVersion("1.0-beta")).toEqual({ value: "1.0-beta", bumped: false });
	});
});
