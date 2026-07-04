import { describe, expect, it } from "vitest";
import {
	normalizeUsage,
	pruneUsage,
	recordUsage,
	renameUsage,
	usageRecencyMap,
	type UsageStore,
} from "../src/domain/usage";

describe("normalizeUsage (FR-23.2)", () => {
	it("round-trips a valid map", () => {
		const raw = {
			"a.md": { lastUsed: "2026-07-03T21:14:05.000Z", count: 3 },
			"b.md": { lastUsed: "2026-06-01T00:00:00.000Z", count: 1 },
		};
		expect(normalizeUsage(raw)).toEqual(raw);
	});

	it("returns an empty store for non-object input", () => {
		expect(normalizeUsage(undefined)).toEqual({});
		expect(normalizeUsage(null)).toEqual({});
		expect(normalizeUsage("nope")).toEqual({});
		expect(normalizeUsage(["a.md"])).toEqual({});
	});

	it("drops an entry missing count or lastUsed, or with wrong types, keeping valid siblings", () => {
		const raw = {
			"missing-count.md": { lastUsed: "2026-07-03T00:00:00.000Z" },
			"missing-lastUsed.md": { count: 2 },
			"wrong-count-type.md": { lastUsed: "2026-07-03T00:00:00.000Z", count: "3" },
			"wrong-lastUsed-type.md": { lastUsed: 123, count: 1 },
			"valid.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 5 },
		};
		expect(normalizeUsage(raw)).toEqual({
			"valid.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 5 },
		});
	});

	it("drops an entry with a negative or zero count", () => {
		const raw = {
			"zero.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 0 },
			"negative.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: -1 },
			"valid.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 1 },
		};
		expect(normalizeUsage(raw)).toEqual({
			"valid.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 1 },
		});
	});
});

describe("recordUsage (FR-23.1)", () => {
	it("creates a fresh entry on an absent path", () => {
		const store: UsageStore = {};
		const out = recordUsage(store, "a.md", "2026-07-03T00:00:00.000Z");
		expect(out).toEqual({ "a.md": { lastUsed: "2026-07-03T00:00:00.000Z", count: 1 } });
	});

	it("bumps lastUsed and count on an existing path", () => {
		const store: UsageStore = { "a.md": { lastUsed: "2026-06-01T00:00:00.000Z", count: 4 } };
		const out = recordUsage(store, "a.md", "2026-07-03T00:00:00.000Z");
		expect(out).toEqual({ "a.md": { lastUsed: "2026-07-03T00:00:00.000Z", count: 5 } });
	});

	it("returns a new object and does not mutate the input", () => {
		const store: UsageStore = { "a.md": { lastUsed: "2026-06-01T00:00:00.000Z", count: 1 } };
		const out = recordUsage(store, "a.md", "2026-07-03T00:00:00.000Z");
		expect(out).not.toBe(store);
		expect(store).toEqual({ "a.md": { lastUsed: "2026-06-01T00:00:00.000Z", count: 1 } });
	});

	it("stores the supplied nowISO verbatim", () => {
		const out = recordUsage({}, "a.md", "not-really-iso-but-verbatim");
		expect(out["a.md"]?.lastUsed).toBe("not-really-iso-but-verbatim");
	});
});

describe("renameUsage (FR-23.4)", () => {
	it("moves the entry from the old key to the new key", () => {
		const store: UsageStore = { "old.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 2 } };
		const out = renameUsage(store, "old.md", "new.md");
		expect(out).toEqual({ "new.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 2 } });
	});

	it("is a no-op when the old key is absent", () => {
		const store: UsageStore = { "other.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 1 } };
		const out = renameUsage(store, "missing.md", "new.md");
		expect(out).toEqual(store);
	});

	it("overwrites the new key if it already existed", () => {
		const store: UsageStore = {
			"old.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 2 },
			"new.md": { lastUsed: "2026-01-01T00:00:00.000Z", count: 9 },
		};
		const out = renameUsage(store, "old.md", "new.md");
		expect(out).toEqual({ "new.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 2 } });
	});

	it("returns a new object", () => {
		const store: UsageStore = { "old.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 2 } };
		const out = renameUsage(store, "old.md", "new.md");
		expect(out).not.toBe(store);
	});
});

describe("pruneUsage (FR-23.3)", () => {
	it("keeps only keys present in knownPaths", () => {
		const store: UsageStore = {
			"kept.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 1 },
			"orphan.md": { lastUsed: "2026-06-01T00:00:00.000Z", count: 2 },
		};
		const out = pruneUsage(store, new Set(["kept.md"]));
		expect(out).toEqual({ "kept.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 1 } });
	});

	it("returns an empty store when knownPaths is empty", () => {
		const store: UsageStore = { "a.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 1 } };
		expect(pruneUsage(store, new Set())).toEqual({});
	});

	it("returns a new object", () => {
		const store: UsageStore = { "a.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 1 } };
		const out = pruneUsage(store, new Set(["a.md"]));
		expect(out).not.toBe(store);
	});

	it("returns content equal to the input when there are no orphans", () => {
		const store: UsageStore = { "a.md": { lastUsed: "2026-07-01T00:00:00.000Z", count: 1 } };
		expect(pruneUsage(store, new Set(["a.md"]))).toEqual(store);
	});
});

describe("usageRecencyMap (FR-23.5)", () => {
	it("maps each path to the epoch ms of its lastUsed", () => {
		const store: UsageStore = { "a.md": { lastUsed: "2026-07-03T00:00:00.000Z", count: 1 } };
		expect(usageRecencyMap(store)).toEqual({ "a.md": Date.parse("2026-07-03T00:00:00.000Z") });
	});

	it("maps an unparseable lastUsed to 0", () => {
		const store: UsageStore = { "a.md": { lastUsed: "not-a-date", count: 1 } };
		expect(usageRecencyMap(store)).toEqual({ "a.md": 0 });
	});

	it("returns an empty map for an empty store", () => {
		expect(usageRecencyMap({})).toEqual({});
	});
});
