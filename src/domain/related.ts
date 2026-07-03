import type { Prompt } from "./prompt";

const TAG_WEIGHT = 3;
const CATEGORY_WEIGHT = 2;
const TOKEN_WEIGHT = 1;

/** Normalizes title+use_case into a token set: NFD, diacritics stripped, lower-cased (ADR-0012). */
function tokenize(prompt: Prompt): Set<string> {
	const source = `${prompt.title} ${prompt.useCase}`
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase();
	const tokens = source.split(/[^a-z0-9]+/).filter((t) => t !== "");
	return new Set(tokens);
}

function sharedCount<T>(a: Set<T>, b: Set<T>): number {
	let count = 0;
	for (const value of a) if (b.has(value)) count++;
	return count;
}

/** Weighted-sum similarity between two prompts (FR-18.1). Symmetric, deterministic. */
export function similarityScore(a: Prompt, b: Prompt): number {
	const tagsA = new Set(a.tags);
	const tagsB = new Set(b.tags);
	let score = sharedCount(tagsA, tagsB) * TAG_WEIGHT;

	if (a.category !== "" && a.category === b.category) score += CATEGORY_WEIGHT;

	score += sharedCount(tokenize(a), tokenize(b)) * TOKEN_WEIGHT;

	return score;
}

/** Ranks `all` against `target` by similarity, excluding zero-score and the target itself (FR-18.2). */
export function relatedPrompts(target: Prompt, all: Prompt[], limit = 5): Prompt[] {
	return all
		.filter((p) => p.path !== target.path)
		.map((p) => ({ prompt: p, score: similarityScore(target, p) }))
		.filter((x) => x.score > 0)
		.sort(
			(x, y) =>
				y.score - x.score ||
				y.prompt.updated.localeCompare(x.prompt.updated) ||
				x.prompt.path.localeCompare(y.prompt.path),
		)
		.slice(0, limit)
		.map((x) => x.prompt);
}
