import { describe, expect, it } from "vitest";
import { findChainOrphanFindings, findDuplicateTitleFindings, lintLibrary, lintPrompt } from "../src/domain/lint";
import { normalizePrompt, type Prompt } from "../src/domain/prompt";

const CTX_TODAY = "2026-07-03";

function p(path: string, fm: Record<string, unknown>, typeKey = "type"): Prompt {
	return normalizePrompt(fm, { path, filename: path, today: CTX_TODAY, typeKey, defaultType: "task" });
}

const BODIES: Record<string, string> = {
	"a.md": "Check the diff carefully.",
};

const getBody = (path: string) => BODIES[path] ?? "";

const WELL_FORMED = p("a.md", {
	title: "Alpha",
	type: "task",
	category: "dev",
	use_case: "review PRs",
	visibility: "private",
	version: "1.0",
	created: "2026-06-01",
	updated: "2026-06-01",
});

describe("lintPrompt — single-prompt rules (L1-L5, L7)", () => {
	it("L1: flags an unclosed placeholder", () => {
		const prompt = p("x.md", { title: "X", category: "dev", use_case: "u" });
		const findings = lintPrompt(prompt, "Hello {{name");
		const l1 = findings.find((f) => f.ruleId === "L1");
		expect(l1?.severity).toBe("warning");
		expect(typeof l1?.message).toBe("string");
	});

	it("L2: flags a conflicting variable name", () => {
		const prompt = p("x.md", { title: "X", category: "dev", use_case: "u" });
		const findings = lintPrompt(prompt, "{{a|x}} … {{a|y}}");
		const l2 = findings.filter((f) => f.ruleId === "L2");
		expect(l2).toHaveLength(1);
		expect(l2[0]?.message).toContain("a");
		expect(l2[0]?.severity).toBe("warning");
	});

	it("L3: flags an empty body", () => {
		const prompt = p("x.md", { title: "X", category: "dev", use_case: "u" });
		const l3 = lintPrompt(prompt, "").find((f) => f.ruleId === "L3");
		expect(l3?.severity).toBe("warning");
		expect(typeof l3?.message).toBe("string");
	});

	it("L3: flags a whitespace-only body", () => {
		const prompt = p("x.md", { title: "X", category: "dev", use_case: "u" });
		const l3 = lintPrompt(prompt, "   \n  ").find((f) => f.ruleId === "L3");
		expect(l3?.severity).toBe("warning");
	});

	it("L4: flags a missing use_case as info", () => {
		const prompt = p("x.md", { title: "X", category: "dev" });
		const l4 = lintPrompt(prompt, "body").find((f) => f.ruleId === "L4");
		expect(l4?.severity).toBe("info");
	});

	it("L5: flags a missing category as info", () => {
		const prompt = p("x.md", { title: "X", use_case: "u" });
		const l5 = lintPrompt(prompt, "body").find((f) => f.ruleId === "L5");
		expect(l5?.severity).toBe("info");
	});

	it("L7: surfaces prompt.warnings as warning findings, message carried verbatim", () => {
		const prompt = p("x.md", { title: "X", category: "dev", use_case: "u", quality: 99 });
		expect(prompt.warnings).toContain("invalid quality: expected integer 1-5");
		expect(lintPrompt(prompt, "body")).toContainEqual({
			ruleId: "L7",
			severity: "warning",
			message: "invalid quality: expected integer 1-5",
		});
	});

	it("returns [] for a fully well-formed prompt", () => {
		expect(lintPrompt(WELL_FORMED, getBody("a.md"))).toEqual([]);
	});
});

describe("findDuplicateTitleFindings (L6)", () => {
	it("flags near-duplicate titles differing only by case/whitespace", () => {
		const a = p("a.md", { title: "draft email", category: "dev", use_case: "u" });
		const b = p("b.md", { title: "Draft Email", category: "dev", use_case: "u" });
		const result = findDuplicateTitleFindings([a, b]);
		expect(result.get("a.md")).toHaveLength(1);
		expect(result.get("b.md")).toHaveLength(1);
		expect(result.get("a.md")?.[0]?.ruleId).toBe("L6");
		expect(result.get("a.md")?.[0]?.severity).toBe("warning");
	});

	it("flags titles that only collide via slugify, even when trimmed-lowercase titles differ", () => {
		const a = p("a.md", { title: "Café Idea", category: "dev", use_case: "u" });
		const b = p("b.md", { title: "cafe idea", category: "dev", use_case: "u" });
		expect(a.title.trim().toLowerCase()).not.toBe(b.title.trim().toLowerCase());
		const result = findDuplicateTitleFindings([a, b]);
		expect(result.get("a.md")).toHaveLength(1);
		expect(result.get("b.md")).toHaveLength(1);
	});

	it("does not flag a unique title", () => {
		const result = findDuplicateTitleFindings([WELL_FORMED]);
		expect(result.has("a.md")).toBe(false);
	});
});

describe("findChainOrphanFindings (L8)", () => {
	it("flags a chain with an unresolvable step, naming the orphan path", () => {
		const chain = p("chain.md", { title: "Chain", chain: ["a.md", "missing.md"] });
		const result = findChainOrphanFindings([chain, WELL_FORMED]);
		expect(result.get("chain.md")).toHaveLength(1);
		expect(result.get("chain.md")?.[0]?.ruleId).toBe("L8");
		expect(result.get("chain.md")?.[0]?.severity).toBe("warning");
		expect(result.get("chain.md")?.[0]?.message).toContain("missing.md");
	});

	it("stays silent when every step resolves", () => {
		const chain = p("chain.md", { title: "Chain", chain: ["a.md"] });
		const result = findChainOrphanFindings([chain, WELL_FORMED]);
		expect(result.has("chain.md")).toBe(false);
	});

	it("never flags a non-chain prompt, whatever its body", () => {
		const result = findChainOrphanFindings([WELL_FORMED]);
		expect(result.has("a.md")).toBe(false);
	});
});

describe("lintLibrary", () => {
	it("returns [] for an empty library without throwing", () => {
		expect(lintLibrary([], () => "", "type", [])).toEqual([]);
	});

	it("returns one result per prompt, in order, well-formed ones with findings: []", () => {
		const broken = p("b.md", { title: "Broken" });
		const bodies: Record<string, string> = { "a.md": getBody("a.md"), "b.md": "" };
		const results = lintLibrary([WELL_FORMED, broken], (path) => bodies[path] ?? "", "type", []);
		expect(results.map((r) => r.path)).toEqual(["a.md", "b.md"]);
		expect(results[0]?.findings).toEqual([]);
		expect(results[1]?.findings.length).toBeGreaterThan(0);
	});

	it("merges L6 findings into the per-prompt result by path", () => {
		const a = p("a.md", { title: "draft email", category: "dev", use_case: "u" });
		const b = p("b.md", { title: "Draft Email", category: "dev", use_case: "u" });
		const results = lintLibrary([a, b], () => "body", "type", []);
		expect(results.find((r) => r.path === "a.md")?.findings.some((f) => f.ruleId === "L6")).toBe(true);
		expect(results.find((r) => r.path === "b.md")?.findings.some((f) => f.ruleId === "L6")).toBe(true);
	});

	it("merges L8 alongside L6 duplicate findings for the same path without dropping either", () => {
		const a = p("a.md", { title: "draft email", category: "dev", use_case: "u", chain: ["missing.md"] });
		const b = p("b.md", { title: "Draft Email", category: "dev", use_case: "u" });
		const results = lintLibrary([a, b], () => "body", "type", []);
		const findingsA = results.find((r) => r.path === "a.md")?.findings ?? [];
		expect(findingsA.some((f) => f.ruleId === "L6")).toBe(true);
		expect(findingsA.some((f) => f.ruleId === "L8")).toBe(true);
	});
});

describe("L9 — orphaned type key after rename (issue #46)", () => {
	it("fires when a prompt has a value under a previous key and nothing under the current one", () => {
		const orphaned = p("a.md", { title: "A", type: "task" }, "prompt_type");
		const results = lintLibrary([orphaned], () => "body", "prompt_type", ["type"]);
		const l9 = results[0]?.findings.find((f) => f.ruleId === "L9");
		expect(l9?.severity).toBe("warning");
		expect(l9?.message).toContain("type");
		expect(l9?.message).toContain("prompt_type");
	});

	it("does not fire when previousTypeKeys is empty", () => {
		const orphaned = p("a.md", { title: "A", type: "task" }, "prompt_type");
		const results = lintLibrary([orphaned], () => "body", "prompt_type", []);
		expect(results[0]?.findings.some((f) => f.ruleId === "L9")).toBe(false);
	});

	it("does not fire when the current key already has a value", () => {
		const fine = p("a.md", { title: "A", prompt_type: "task", type: "task" }, "prompt_type");
		const results = lintLibrary([fine], () => "body", "prompt_type", ["type"]);
		expect(results[0]?.findings.some((f) => f.ruleId === "L9")).toBe(false);
	});

	it("does not fire when the previous key's value is empty or whitespace", () => {
		const blankOld = p("a.md", { title: "A", type: "   " }, "prompt_type");
		const results = lintLibrary([blankOld], () => "body", "prompt_type", ["type"]);
		expect(results[0]?.findings.some((f) => f.ruleId === "L9")).toBe(false);
	});
});
