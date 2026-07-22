import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings";

describe("mergeSettings — typeKey (issue #46)", () => {
	it("defaults to \"type\" when raw is absent, non-object, or the field is missing", () => {
		expect(mergeSettings(undefined).typeKey).toBe("type");
		expect(mergeSettings(null).typeKey).toBe("type");
		expect(mergeSettings("nope").typeKey).toBe("type");
		expect(mergeSettings({}).typeKey).toBe("type");
	});

	it("trims and keeps a valid persisted value", () => {
		expect(mergeSettings({ typeKey: "  prompt_type  " }).typeKey).toBe("prompt_type");
	});

	it("falls back to the default on a blank or wrong-typed value", () => {
		expect(mergeSettings({ typeKey: "   " }).typeKey).toBe("type");
		expect(mergeSettings({ typeKey: 42 }).typeKey).toBe("type");
		expect(mergeSettings({ typeKey: null }).typeKey).toBe("type");
	});

	it("falls back to the default when the persisted value has an invalid format", () => {
		expect(mergeSettings({ typeKey: "1type" }).typeKey).toBe("type");
		expect(mergeSettings({ typeKey: "prompt type" }).typeKey).toBe("type");
	});

	it("falls back to the default when the persisted value collides with another reserved field (corrupted data.json)", () => {
		expect(mergeSettings({ typeKey: "title" }).typeKey).toBe("type");
		expect(mergeSettings({ typeKey: "chain" }).typeKey).toBe("type");
		expect(mergeSettings({ typeKey: "category" }).typeKey).toBe("type");
	});
});

describe("mergeSettings — previousTypeKeys (issue #46)", () => {
	it("defaults to [] when raw is absent, non-object, or the field is missing", () => {
		expect(mergeSettings(undefined).previousTypeKeys).toEqual([]);
		expect(mergeSettings(null).previousTypeKeys).toEqual([]);
		expect(mergeSettings({}).previousTypeKeys).toEqual([]);
	});

	it("keeps a valid persisted array, trimmed", () => {
		expect(mergeSettings({ previousTypeKeys: ["type", " prompt_type "] }).previousTypeKeys).toEqual([
			"type",
			"prompt_type",
		]);
	});

	it("drops non-string and blank entries", () => {
		expect(mergeSettings({ previousTypeKeys: ["type", "", "  ", 42, null] }).previousTypeKeys).toEqual(["type"]);
	});

	it("deduplicates", () => {
		expect(mergeSettings({ previousTypeKeys: ["type", "type", "prompt_type"] }).previousTypeKeys).toEqual([
			"type",
			"prompt_type",
		]);
	});

	it("falls back to [] on a non-array value", () => {
		expect(mergeSettings({ previousTypeKeys: "type" }).previousTypeKeys).toEqual([]);
	});
});

describe("DEFAULT_SETTINGS (issue #46)", () => {
	it("defaults typeKey to \"type\" and previousTypeKeys to []", () => {
		expect(DEFAULT_SETTINGS.typeKey).toBe("type");
		expect(DEFAULT_SETTINGS.previousTypeKeys).toEqual([]);
	});
});
