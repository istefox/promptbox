import { describe, expect, it } from "vitest";
import { normalizePrompt, type Prompt } from "../src/domain/prompt";
import { emptyQuery, runQuery } from "../src/domain/query";

const TYPES = ["system", "task", "agent", "snippet"];
const WORDS = "review code prompt writing tone editor draft summarize translate refactor plan test".split(" ");

function fixture(count: number): { prompts: Prompt[]; bodies: Map<string, string> } {
	const prompts: Prompt[] = [];
	const bodies = new Map<string, string>();
	for (let i = 0; i < count; i++) {
		const path = `Prompts/p-${i}.md`;
		prompts.push(
			normalizePrompt(
				{
					title: `Prompt ${i} ${WORDS[i % WORDS.length]}`,
					type: TYPES[i % TYPES.length],
					category: i % 3 === 0 ? "dev" : "writing",
					tags: [WORDS[i % WORDS.length], WORDS[(i + 3) % WORDS.length]],
					quality: (i % 5) + 1,
					use_case: `use case ${WORDS[(i + 5) % WORDS.length]}`,
					visibility: i % 2 === 0 ? "private" : "public",
					created: "2026-01-01",
					updated: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
				},
				{ path, filename: `p-${i}`, today: "2026-07-02" },
			),
		);
		// ~120 words per body, realistic order of magnitude for a prompt note
		const body = Array.from({ length: 120 }, (_, w) => WORDS[(i + w) % WORDS.length]).join(" ");
		bodies.set(path, body);
	}
	return { prompts, bodies };
}

describe("NFR-1 — query performance on the 1,000-prompt fixture", () => {
	const { prompts, bodies } = fixture(1000);
	const getBody = (path: string) => bodies.get(path) ?? "";

	it("full pass (filter + sort) stays well under the view budget", () => {
		const t0 = performance.now();
		const out = runQuery(prompts, getBody, emptyQuery());
		const ms = performance.now() - t0;
		console.log(`NFR-1 full query pass over 1000 prompts: ${ms.toFixed(1)} ms`);
		expect(out).toHaveLength(1000);
		expect(ms).toBeLessThan(200);
	});

	it("per-keystroke incremental search stays under 100 ms", () => {
		const needles = ["r", "re", "rev", "revi", "review code", "translate"];
		let worst = 0;
		for (const text of needles) {
			const t0 = performance.now();
			runQuery(prompts, getBody, { ...emptyQuery(), text });
			worst = Math.max(worst, performance.now() - t0);
		}
		console.log(`NFR-1 worst keystroke over 1000 prompts: ${worst.toFixed(1)} ms`);
		expect(worst).toBeLessThan(100);
	});

	it("fuzzy multi-token search with relevance sort stays under 100 ms (ADR-0017)", () => {
		const queries = ["code review", "prompt writing", "tmpl", "revw code"];
		let worst = 0;
		for (const text of queries) {
			const t0 = performance.now();
			runQuery(prompts, getBody, { ...emptyQuery(), text, sort: "relevance-desc" });
			worst = Math.max(worst, performance.now() - t0);
		}
		console.log(`ADR-0017 worst fuzzy+relevance keystroke over 1000 prompts: ${worst.toFixed(1)} ms`);
		expect(worst).toBeLessThan(100);
	});
});
