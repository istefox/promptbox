import { describe, expect, it } from "vitest";
import {
	buildStepValues,
	chainOrphanSteps,
	isSaveableChain,
	MIN_CHAIN_STEPS,
	partitionStepVariables,
	readChain,
	renameChainSteps,
} from "../src/domain/chains";

describe("readChain (NFR-8 tolerance)", () => {
	it("keeps a well-formed list in order", () => {
		expect(readChain(["a.md", "b.md"])).toEqual(["a.md", "b.md"]);
	});

	it("preserves duplicates without dedup", () => {
		expect(readChain(["a.md", "a.md"])).toEqual(["a.md", "a.md"]);
	});

	it("tolerates an empty list and a single-entry list at read time", () => {
		expect(readChain([])).toEqual([]);
		expect(readChain(["a.md"])).toEqual(["a.md"]);
	});

	it("returns [] for a non-list scalar, never throws", () => {
		for (const hostile of ["a.md", 42, null, undefined, {}]) {
			expect(() => readChain(hostile)).not.toThrow();
			expect(readChain(hostile)).toEqual([]);
		}
	});

	it("drops non-string and empty-string entries, keeping order otherwise", () => {
		expect(readChain(["a.md", 42, "", "b.md", null, {}])).toEqual(["a.md", "b.md"]);
	});
});

describe("isSaveableChain", () => {
	it("is false below MIN_CHAIN_STEPS", () => {
		expect(MIN_CHAIN_STEPS).toBe(2);
		expect(isSaveableChain([])).toBe(false);
		expect(isSaveableChain(["a.md"])).toBe(false);
	});

	it("is true at or above MIN_CHAIN_STEPS, including an all-duplicate 2-entry chain", () => {
		expect(isSaveableChain(["a.md", "b.md"])).toBe(true);
		expect(isSaveableChain(["a.md", "b.md", "c.md"])).toBe(true);
		expect(isSaveableChain(["a.md", "a.md"])).toBe(true);
	});
});

describe("chainOrphanSteps", () => {
	it("returns entries absent from knownPaths, order preserved, duplicates reported per occurrence", () => {
		const known = new Set(["a.md", "b.md"]);
		expect(chainOrphanSteps(["a.md", "x.md", "b.md", "x.md"], known)).toEqual(["x.md", "x.md"]);
	});

	it("returns [] when every step resolves", () => {
		const known = new Set(["a.md", "b.md"]);
		expect(chainOrphanSteps(["a.md", "b.md"], known)).toEqual([]);
	});

	it("returns every entry when none resolve", () => {
		const known = new Set<string>();
		expect(chainOrphanSteps(["a.md", "b.md"], known)).toEqual(["a.md", "b.md"]);
	});
});

describe("renameChainSteps", () => {
	it("replaces every occurrence of oldPath with newPath", () => {
		expect(renameChainSteps(["a.md", "b.md", "a.md"], "a.md", "z.md")).toEqual(["z.md", "b.md", "z.md"]);
	});

	it("returns an array equal in content to the input when there is no occurrence", () => {
		const steps = ["a.md", "b.md"];
		expect(renameChainSteps(steps, "missing.md", "z.md")).toEqual(steps);
	});

	it("does not touch non-matching entries, preserves order and length", () => {
		const out = renameChainSteps(["a.md", "b.md", "c.md"], "b.md", "z.md");
		expect(out).toEqual(["a.md", "z.md", "c.md"]);
		expect(out).toHaveLength(3);
	});
});

describe("partitionStepVariables", () => {
	it("separates context names, @previous, and user variables", () => {
		const out = partitionStepVariables("{{@date}} {{name}} {{@previous}}");
		expect(out.contextNames).toEqual(["@date"]);
		expect(out.usesPrevious).toBe(true);
		expect(out.userVariables.map((v) => v.name)).toEqual(["name"]);
	});

	it("usesPrevious is false when @previous is absent", () => {
		const out = partitionStepVariables("{{@date}} {{name}}");
		expect(out.usesPrevious).toBe(false);
	});

	it("dedupes @previous out of both buckets even when it appears multiple times", () => {
		const out = partitionStepVariables("{{@previous}} body {{@previous}}");
		expect(out.usesPrevious).toBe(true);
		expect(out.contextNames).toEqual([]);
		expect(out.userVariables).toEqual([]);
	});

	it("handles a body whose only variable is @previous", () => {
		const out = partitionStepVariables("{{@previous}}");
		expect(out.contextNames).toEqual([]);
		expect(out.usesPrevious).toBe(true);
		expect(out.userVariables).toEqual([]);
	});
});

describe("buildStepValues", () => {
	it("maps @previous to the exact clipboard value when usesPrevious is true", () => {
		const clipboardValue = "the copied answer";
		const out = buildStepValues({}, clipboardValue, true, {});
		expect(out["@previous"]).toBe(clipboardValue);
	});

	it("omits @previous when usesPrevious is false", () => {
		const out = buildStepValues({}, "whatever", false, {});
		expect(out).not.toHaveProperty("@previous");
	});

	it("merges context and user values, user values winning on collision", () => {
		const out = buildStepValues({ "@date": "2026-07-14", shared: "context" }, "clip", false, {
			shared: "user",
			name: "Ada",
		});
		expect(out).toEqual({ "@date": "2026-07-14", shared: "user", name: "Ada" });
	});
});
