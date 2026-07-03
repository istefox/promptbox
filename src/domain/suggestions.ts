/** Draft text scored against candidate values for tag/category suggestions (FR-11.1). */
export interface SuggestionDraftText {
	title: string;
	useCase: string;
	body: string;
}

/** Tokenizes with the same normalize-NFD, strip-diacritics, lowercase, split approach as `slugify`. */
function tokenize(text: string): string[] {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t !== "");
}

function frequencyMap(tokens: string[]): Map<string, number> {
	const freq = new Map<string, number>();
	for (const token of tokens) freq.set(token, (freq.get(token) ?? 0) + 1);
	return freq;
}

/**
 * Deterministic, case-insensitive keyword-frequency scoring shared by tag and category
 * suggestions (FR-11.1, ADR-0006). Never throws: malformed or empty input degrades to `[]`.
 */
export function suggestValues(
	draftText: SuggestionDraftText,
	candidates: string[],
	selected: string[],
	limit: number,
): string[] {
	const draftFreq = frequencyMap(tokenize(`${draftText.title} ${draftText.useCase} ${draftText.body}`));

	const seen = new Set<string>();
	const scored: { value: string; score: number }[] = [];
	for (const candidate of candidates) {
		if (seen.has(candidate) || selected.includes(candidate)) continue;
		seen.add(candidate);

		const tokens = new Set(tokenize(candidate));
		if (tokens.size === 0) continue;

		let score = 0;
		for (const token of tokens) score += draftFreq.get(token) ?? 0;
		if (score > 0) scored.push({ value: candidate, score });
	}

	scored.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value));
	return scored.slice(0, limit).map((s) => s.value);
}
