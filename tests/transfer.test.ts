import { describe, expect, it } from "vitest";
import { normalizePrompt, type Prompt } from "../src/domain/prompt";
import {
	buildExport,
	planImport,
	validateImport,
	type ExportDoc,
	type ExportedPrompt,
} from "../src/domain/transfer";

function prompt(path: string, fm: Record<string, unknown>): Prompt {
	return normalizePrompt(fm, { path, filename: path, today: "2026-07-02" });
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
