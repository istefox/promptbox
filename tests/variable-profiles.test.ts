import { describe, expect, it } from "vitest";
import {
	applyProfile,
	findProfileIndex,
	matchingProfiles,
	normalizeProfiles,
	upsertProfile,
	type VariableProfile,
} from "../src/domain/variable-profiles";

describe("normalizeProfiles (FR-14.1)", () => {
	it("returns an empty array for non-array raw input", () => {
		expect(normalizeProfiles(undefined)).toEqual([]);
		expect(normalizeProfiles(null)).toEqual([]);
		expect(normalizeProfiles("nope")).toEqual([]);
		expect(normalizeProfiles({ name: "Acme" })).toEqual([]);
	});

	it("drops entries with a missing, blank, or non-string name", () => {
		const raw = [{ values: {} }, { name: "", values: {} }, { name: "   ", values: {} }, { name: 42, values: {} }];
		expect(normalizeProfiles(raw)).toEqual([]);
	});

	it("keeps an entry with a non-object values as an empty values map", () => {
		expect(normalizeProfiles([{ name: "Acme", values: "nope" }])).toEqual([{ name: "Acme", values: {} }]);
		expect(normalizeProfiles([{ name: "Acme", values: null }])).toEqual([{ name: "Acme", values: {} }]);
		expect(normalizeProfiles([{ name: "Acme", values: [1, 2] }])).toEqual([{ name: "Acme", values: {} }]);
		expect(normalizeProfiles([{ name: "Acme" }])).toEqual([{ name: "Acme", values: {} }]);
	});

	it("drops non-string values entries key-by-key, keeping the string ones", () => {
		const raw = [{ name: "Acme", values: { client: "Acme Corp", tone: 5, context: null, empty: "" } }];
		expect(normalizeProfiles(raw)).toEqual([
			{ name: "Acme", values: { client: "Acme Corp", empty: "" } },
		]);
	});

	it("trims the name", () => {
		expect(normalizeProfiles([{ name: "  Acme  ", values: {} }])).toEqual([{ name: "Acme", values: {} }]);
	});

	it("keeps the first occurrence when names collide case-insensitively", () => {
		const raw = [
			{ name: "Acme", values: { client: "first" } },
			{ name: "ACME", values: { client: "second" } },
		];
		expect(normalizeProfiles(raw)).toEqual([{ name: "Acme", values: { client: "first" } }]);
	});
});

describe("matchingProfiles (FR-14.2)", () => {
	const profiles: VariableProfile[] = [
		{ name: "Acme", values: { client: "Acme Corp", tone: "formal" } },
		{ name: "Other", values: { topic: "unrelated" } },
	];

	it("includes profiles with at least one overlapping key", () => {
		expect(matchingProfiles(profiles, ["client", "topic"])).toEqual([profiles[0], profiles[1]]);
	});

	it("excludes profiles with zero overlap", () => {
		expect(matchingProfiles(profiles, ["nope"])).toEqual([]);
	});

	it("returns an empty array when profiles or variableNames is empty", () => {
		expect(matchingProfiles([], ["client"])).toEqual([]);
		expect(matchingProfiles(profiles, [])).toEqual([]);
	});
});

describe("applyProfile (FR-14.5)", () => {
	it("prefers the profile's value when present, even an explicit empty string", () => {
		const result = applyProfile({ client: "Acme Corp", tone: "" }, { client: "old", topic: "keep" }, [
			"client",
			"tone",
			"topic",
		]);
		expect(result).toEqual({ client: "Acme Corp", tone: "", topic: "keep" });
	});

	it("falls back to current values, then to an empty string, when the profile omits a key", () => {
		const result = applyProfile({}, { client: "old" }, ["client", "topic"]);
		expect(result).toEqual({ client: "old", topic: "" });
	});

	it("never includes profile keys outside variableNames, and the output key set is exactly variableNames", () => {
		const result = applyProfile({ client: "Acme Corp", extra: "unused" }, {}, ["client"]);
		expect(result).toEqual({ client: "Acme Corp" });
		expect(Object.keys(result)).toEqual(["client"]);
	});
});

describe("findProfileIndex", () => {
	const profiles: VariableProfile[] = [
		{ name: "Acme", values: {} },
		{ name: "Other", values: {} },
	];

	it("resolves an exact match", () => {
		expect(findProfileIndex(profiles, "Acme")).toBe(0);
	});

	it("resolves a case-insensitive match to the same index", () => {
		expect(findProfileIndex(profiles, "acme")).toBe(0);
		expect(findProfileIndex(profiles, "ACME")).toBe(0);
	});

	it("trims before comparing", () => {
		expect(findProfileIndex(profiles, "  Acme  ")).toBe(0);
	});

	it("returns -1 when there is no match", () => {
		expect(findProfileIndex(profiles, "Nope")).toBe(-1);
	});
});

describe("upsertProfile (FR-14.3)", () => {
	it("appends a new profile under a case-insensitive-unique name without mutating the input", () => {
		const profiles: VariableProfile[] = [{ name: "Acme", values: { client: "Acme Corp" } }];
		const result = upsertProfile(profiles, "Other", { topic: "x" });
		expect(result).toEqual([
			{ name: "Acme", values: { client: "Acme Corp" } },
			{ name: "Other", values: { topic: "x" } },
		]);
		expect(profiles).toEqual([{ name: "Acme", values: { client: "Acme Corp" } }]);
	});

	it("overwrites an existing case-insensitive match wholesale, adopting the newly typed casing", () => {
		const profiles: VariableProfile[] = [
			{ name: "Acme", values: { client: "Acme Corp", tone: "formal" } },
			{ name: "Other", values: { topic: "x" } },
		];
		const result = upsertProfile(profiles, "acme", { client: "New Corp" });
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ name: "acme", values: { client: "New Corp" } });
		expect(result[1]).toEqual({ name: "Other", values: { topic: "x" } });
	});
});
