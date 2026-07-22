import { describe, expect, it } from "vitest";
import { normalizePrompt, type Prompt } from "../src/domain/prompt";
import {
	buildExport,
	buildPackExport,
	diffImportEntry,
	lineDelta,
	parsePackHeader,
	planImport,
	validateImport,
	type ExportDoc,
	type ExportedPrompt,
	type PackHeader,
} from "../src/domain/transfer";

function prompt(path: string, fm: Record<string, unknown>): Prompt {
	return normalizePrompt(fm, { path, filename: path, today: "2026-07-02", typeKey: "type", defaultType: "task" });
}

const PROMPTS = [
	prompt("Prompts/a.md", { title: "A", type: "task", quality: 4, tags: ["x"], created: "2026-01-01", updated: "2026-06-01", visibility: "private", version: "1.0" }),
	prompt("Prompts/sub/b.md", { title: "B", type: "system", created: "2026-02-02", updated: "2026-06-02", visibility: "public", version: "2.0" }),
];
const BODIES: Record<string, string> = { "Prompts/a.md": "body A {{var}}", "Prompts/sub/b.md": "body B" };
const getBody = (p: string) => BODIES[p] ?? "";

describe("buildExport (FR-7.1, FR-7.2)", () => {
	it("produces schema v1 with folder-relative paths and bodies", () => {
		const doc = buildExport(PROMPTS, getBody, "Prompts", "2026-07-02T10:00:00Z");
		expect(doc.schema_version).toBe(1);
		expect(doc.prompts.map((p) => p.path)).toEqual(["a.md", "sub/b.md"]);
		expect(doc.prompts[0]?.quality).toBe(4);
		expect(doc.prompts[1]?.quality).toBeUndefined();
		expect(doc.prompts[0]?.body).toBe("body A {{var}}");
	});
});

describe("validateImport — hostile input (FR-7.3, DoD)", () => {
	it("rejects non-object roots and wrong schema versions", () => {
		expect(validateImport("[]").ok).toBe(false);
		expect(validateImport([1, 2]).ok).toBe(false);
		expect(validateImport({ schema_version: 2, prompts: [] }).ok).toBe(false);
		expect(validateImport({ schema_version: 1, prompts: "no" }).ok).toBe(false);
	});

	it("rejects path traversal, absolute paths, backslashes, and non-md files", () => {
		const entry = (path: string): unknown => ({
			schema_version: 1,
			prompts: [{ path, title: "t", type: "task", visibility: "private", version: "1", created: "2026-01-01", updated: "2026-01-01", body: "b" }],
		});
		for (const bad of ["../escape.md", "a/../../b.md", "/abs.md", "win\\path.md", "noext", ""]) {
			const result = validateImport(entry(bad));
			expect(result.ok).toBe(false);
		}
	});

	it("rejects wrong field types with indexed messages", () => {
		const result = validateImport({
			schema_version: 1,
			prompts: [{ path: "ok.md", title: 42, type: "task", visibility: "private", version: "1", created: "d", updated: "d", body: "b", tags: "not-array", quality: 9 }],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join("\n")).toContain("prompts[0].title");
			expect(result.errors.join("\n")).toContain("prompts[0].tags");
			expect(result.errors.join("\n")).toContain("prompts[0].quality");
		}
	});

	it("accepts a well-formed document", () => {
		const doc = buildExport(PROMPTS, getBody, "Prompts", "2026-07-02T10:00:00Z");
		const parsed: unknown = JSON.parse(JSON.stringify(doc));
		const result = validateImport(parsed);
		expect(result.ok).toBe(true);
	});
});

describe("planImport — conflict policies (FR-7.3)", () => {
	const doc = (paths: string[]): ExportDoc => ({
		schema_version: 1,
		exported_at: "",
		prompts: paths.map(
			(path): ExportedPrompt => ({
				path,
				title: path,
				type: "task",
				category: "",
				tags: [],
				use_case: "",
				visibility: "private",
				version: "1.0",
				created: "2026-01-01",
				updated: "2026-01-01",
				body: "b",
			}),
		),
	});

	it("creates when free, applies the chosen policy on conflicts", () => {
		const existing = new Set(["a.md"]);
		expect(planImport(doc(["a.md", "b.md"]), existing, "skip").map((a) => a.kind)).toEqual(["skip", "create"]);
		expect(planImport(doc(["a.md"]), existing, "overwrite").map((a) => a.kind)).toEqual(["overwrite"]);
		const dup = planImport(doc(["a.md"]), existing, "duplicate");
		expect(dup[0]).toMatchObject({ kind: "duplicate", targetPath: "a-1.md" });
	});

	it("handles conflicts within the same import file and nested paths", () => {
		const actions = planImport(doc(["sub/x.md", "sub/x.md"]), new Set(), "duplicate");
		expect(actions.map((a) => a.targetPath)).toEqual(["sub/x.md", "sub/x-1.md"]);
	});
});

describe("lineDelta", () => {
	it("reports no change for identical bodies", () => {
		expect(lineDelta("a\nb\nc", "a\nb\nc")).toEqual({ added: 0, removed: 0 });
	});

	it("reports pure appends as added only", () => {
		expect(lineDelta("a\nb", "a\nb\nc\nd")).toEqual({ added: 2, removed: 0 });
	});

	it("reports one edited line as one added and one removed", () => {
		expect(lineDelta("a\nb\nc", "a\nx\nc")).toEqual({ added: 1, removed: 1 });
	});

	it("reports an empty existing body against N incoming lines as N added", () => {
		expect(lineDelta("", "a\nb\nc")).toEqual({ added: 3, removed: 0 });
	});
});

function exportedPrompt(overrides: Partial<ExportedPrompt> = {}): ExportedPrompt {
	return {
		path: "a.md",
		title: "A",
		type: "task",
		category: "cat",
		tags: ["x"],
		quality: 3,
		use_case: "use",
		visibility: "private",
		version: "1.0",
		created: "2026-01-01",
		updated: "2026-06-01",
		body: "line1\nline2",
		...overrides,
	};
}

describe("diffImportEntry (FR-17.2, FR-17.3)", () => {
	it("surfaces a quality change and a pure body append (SPEC.md §3 first bullet)", () => {
		const existing = exportedPrompt({ quality: 3, body: "line1\nline2" });
		const incoming = exportedPrompt({ quality: 5, body: "line1\nline2\nline3\nline4" });
		const diff = diffImportEntry(existing, incoming);
		expect(diff.fieldChanges).toEqual([{ field: "quality", from: 3, to: 5 }]);
		expect(diff.body).toEqual({ changed: true, added: 2, removed: 0 });
		expect(diff.identical).toBe(false);
	});

	it("labels a byte-identical entry as identical (SPEC.md §3 third bullet)", () => {
		const existing = exportedPrompt();
		const incoming = exportedPrompt();
		const diff = diffImportEntry(existing, incoming);
		expect(diff.fieldChanges).toEqual([]);
		expect(diff.body).toEqual({ changed: false, added: 0, removed: 0 });
		expect(diff.identical).toBe(true);
	});

	it("surfaces tags changes as raw arrays, not joined strings", () => {
		const existing = exportedPrompt({ tags: ["x"] });
		const incoming = exportedPrompt({ tags: ["x", "y"] });
		const diff = diffImportEntry(existing, incoming);
		expect(diff.fieldChanges).toEqual([{ field: "tags", from: ["x"], to: ["x", "y"] }]);
	});

	it("surfaces quality going from defined to undefined and back", () => {
		const defined = exportedPrompt({ quality: 4 });
		const undefinedQuality = exportedPrompt({ quality: undefined });
		expect(diffImportEntry(defined, undefinedQuality).fieldChanges).toEqual([
			{ field: "quality", from: 4, to: undefined },
		]);
		expect(diffImportEntry(undefinedQuality, defined).fieldChanges).toEqual([
			{ field: "quality", from: undefined, to: 4 },
		]);
	});

	it("reports identical: false with no field changes when only the body differs", () => {
		const existing = exportedPrompt({ body: "line1" });
		const incoming = exportedPrompt({ body: "line1\nline2" });
		const diff = diffImportEntry(existing, incoming);
		expect(diff.fieldChanges).toEqual([]);
		expect(diff.identical).toBe(false);
	});

	it("surfaces created/updated differences as field changes", () => {
		const existing = exportedPrompt({ created: "2026-01-01", updated: "2026-06-01" });
		const incoming = exportedPrompt({ created: "2026-01-02", updated: "2026-06-02" });
		const diff = diffImportEntry(existing, incoming);
		expect(diff.fieldChanges).toEqual([
			{ field: "created", from: "2026-01-01", to: "2026-01-02" },
			{ field: "updated", from: "2026-06-01", to: "2026-06-02" },
		]);
	});
});

describe("round trip (FR-7.4)", () => {
	it("export → validate → plan into empty folder reproduces equivalent entries", () => {
		const doc = buildExport(PROMPTS, getBody, "Prompts", "2026-07-02T10:00:00Z");
		const parsed = validateImport(JSON.parse(JSON.stringify(doc)) as unknown);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const actions = planImport(parsed.doc, new Set(), "skip");
		expect(actions.every((a) => a.kind === "create")).toBe(true);
		const materialized = new Map(actions.map((a) => [a.targetPath, a.entry]));
		for (const original of doc.prompts) {
			const restored = materialized.get(original.path);
			expect(restored).toEqual(original);
		}
	});
});

describe("buildPackExport (FR-20.1)", () => {
	it("attaches the given pack header; prompts match buildExport for the same inputs", () => {
		const pack: PackHeader = { name: "Code Review Kit", description: "Prompts for reviewing PRs" };
		const doc = buildPackExport(PROMPTS, getBody, "Prompts", "2026-07-02T10:00:00Z", pack);
		expect(doc.pack).toEqual(pack);
		const plain = buildExport(PROMPTS, getBody, "Prompts", "2026-07-02T10:00:00Z");
		expect(doc.prompts).toEqual(plain.prompts);
	});
});

describe("parsePackHeader (FR-21.1)", () => {
	it("treats undefined and null as absent, no warning", () => {
		expect(parsePackHeader(undefined)).toEqual({ pack: undefined, warning: null });
		expect(parsePackHeader(null)).toEqual({ pack: undefined, warning: null });
	});

	it("parses a well-formed pack verbatim", () => {
		const result = parsePackHeader({ name: "Code Review Kit", description: "For PRs" });
		expect(result).toEqual({ pack: { name: "Code Review Kit", description: "For PRs" }, warning: null });
	});

	it("defaults description to empty string when omitted", () => {
		const result = parsePackHeader({ name: "Code Review Kit" });
		expect(result.warning).toBeNull();
		expect(result.pack?.description).toBe("");
	});

	it("warns and drops the pack on a malformed root type (e.g. a bare string)", () => {
		const result = parsePackHeader("oops");
		expect(result.pack).toBeUndefined();
		expect(result.warning).not.toBeNull();
	});

	it.each([{}, { name: "" }, { name: "   " }, { name: 42 }])(
		"warns and drops the pack for %j",
		(raw) => {
			const result = parsePackHeader(raw);
			expect(result.pack).toBeUndefined();
			expect(result.warning).not.toBeNull();
		},
	);

	it("warns and drops the whole pack when description has the wrong type (no partial repair)", () => {
		const result = parsePackHeader({ name: "ok", description: 42 });
		expect(result.pack).toBeUndefined();
		expect(result.warning).not.toBeNull();
	});

	it("ignores unknown extra keys without warning", () => {
		const result = parsePackHeader({ name: "Code Review Kit", description: "For PRs", extra: "ignored" });
		expect(result.warning).toBeNull();
		expect(result.pack).toEqual({ name: "Code Review Kit", description: "For PRs" });
	});
});

describe("validateImport with pack (FR-21.1, FR-21.2)", () => {
	it("a doc without a pack key stays plain: ok, no warnings, doc.pack undefined", () => {
		const doc = buildExport(PROMPTS, getBody, "Prompts", "2026-07-02T10:00:00Z");
		const result = validateImport(JSON.parse(JSON.stringify(doc)) as unknown);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.warnings).toEqual([]);
		expect(result.doc.pack).toBeUndefined();
	});

	it("a doc with a well-formed pack surfaces it with no warnings", () => {
		const pack: PackHeader = { name: "Code Review Kit", description: "For PRs" };
		const doc = buildPackExport(PROMPTS, getBody, "Prompts", "2026-07-02T10:00:00Z", pack);
		const result = validateImport(JSON.parse(JSON.stringify(doc)) as unknown);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.warnings).toEqual([]);
		expect(result.doc.pack).toEqual(pack);
		expect(result.doc.prompts.length).toBe(2);
	});

	it("a malformed pack ('oops') warns but still imports as plain", () => {
		const doc = buildExport(PROMPTS, getBody, "Prompts", "2026-07-02T10:00:00Z");
		const raw = { ...(JSON.parse(JSON.stringify(doc)) as Record<string, unknown>), pack: "oops" };
		const result = validateImport(raw);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.pack).toBeUndefined();
		expect(result.warnings.length).toBe(1);
	});

	it("pre-existing hard-failure cases still yield ok:false unchanged", () => {
		expect(validateImport({ schema_version: 2, prompts: [] }).ok).toBe(false);
		expect(validateImport({ schema_version: 1, prompts: "no" }).ok).toBe(false);
	});
});

describe("round trip with pack (FR-21.3, extends FR-7.4)", () => {
	it("build → stringify/parse → validate reproduces the pack header and prompts, with no per-prompt pack key", () => {
		const pack: PackHeader = { name: "Code Review Kit", description: "For PRs" };
		const doc = buildPackExport(PROMPTS, getBody, "Prompts", "2026-07-02T10:00:00Z", pack);
		const result = validateImport(JSON.parse(JSON.stringify(doc)) as unknown);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.pack).toEqual(pack);
		expect(result.doc.prompts).toEqual(doc.prompts);
		for (const entry of result.doc.prompts) {
			expect(Object.prototype.hasOwnProperty.call(entry, "pack")).toBe(false);
		}
	});
});
