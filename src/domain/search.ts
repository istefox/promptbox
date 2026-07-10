/**
 * Fuzzy library search scoring (FR-2.4, ADR-0017).
 *
 * Subsequence matching (characters in order, not necessarily contiguous), token-AND
 * across whitespace-split query tokens (so word order is irrelevant), a field-weighted
 * relevance score, and character ranges of title matches for highlighting.
 *
 * Pure module with no `obsidian` import, so it stays vitest-covered like the other
 * domain scorers (`related.ts`, `suggestions.ts`).
 */

import { fold } from "./text";

const TITLE_WEIGHT = 3;
const USE_CASE_WEIGHT = 2;
const BODY_WEIGHT = 1;

export interface SearchFields {
	title: string;
	useCase: string;
	body: string;
}

export interface SearchHit {
	/** Higher is more relevant; sum of each token's best weighted field score. */
	score: number;
	/** [start, end) UTF-16 ranges in the ORIGINAL title, ascending and non-overlapping. */
	titleRanges: Array<[number, number]>;
}

/**
 * Length-preserving diacritic fold: each source UTF-16 unit maps to exactly one folded
 * char, so an index in the result maps 1:1 back to the original string. Used only for the
 * title, whose match positions drive highlighting. A pure combining mark folds to a space.
 */
function foldTitle(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const folded = fold(text.charAt(i));
		out += folded.charAt(0) || " ";
	}
	return out;
}

/** Query tokens split on whitespace, not on `[^a-z0-9]+`, so `c++` stays one token. */
function tokenize(queryText: string): string[] {
	return fold(queryText)
		.split(/\s+/)
		.filter((t) => t !== "");
}

interface SubseqResult {
	score: number;
	positions: number[];
}

function isBoundary(ch: string): boolean {
	return !/[a-z0-9]/.test(ch);
}

/** Rewards contiguity, word-boundary starts, an early first match, and a contiguous run. */
function scorePositions(hay: string, positions: number[]): number {
	const first = positions[0] ?? 0;
	let score = 0;
	let contiguous = true;
	for (let i = 0; i < positions.length; i++) {
		const pos = positions[i] ?? 0;
		const prev = positions[i - 1];
		let charScore = 1;
		if (prev !== undefined && pos === prev + 1) charScore += 2;
		else if (i > 0) contiguous = false;
		if (pos === 0 || isBoundary(hay.charAt(pos - 1))) charScore += 3;
		score += charScore;
	}
	score += Math.max(0, 5 - first);
	if (contiguous) score += 5;
	return score;
}

/** Greedy leftmost subsequence match of `needle` in `hay` (both already folded). */
function subseqMatch(needle: string, hay: string): SubseqResult | null {
	if (needle === "") return { score: 0, positions: [] };
	const positions: number[] = [];
	let h = 0;
	for (let n = 0; n < needle.length; n++) {
		const c = needle.charAt(n);
		let found = -1;
		while (h < hay.length) {
			const here = hay.charAt(h);
			h++;
			if (here === c) {
				found = h - 1;
				break;
			}
		}
		if (found === -1) return null;
		positions.push(found);
	}
	return { score: scorePositions(hay, positions), positions };
}

function toRanges(positions: Set<number>): Array<[number, number]> {
	const sorted = [...positions].sort((a, b) => a - b);
	const ranges: Array<[number, number]> = [];
	for (const pos of sorted) {
		const last = ranges[ranges.length - 1];
		if (last && pos === last[1]) last[1] = pos + 1;
		else ranges.push([pos, pos + 1]);
	}
	return ranges;
}

/**
 * Scores a prompt against `queryText`. Every query token must subsequence-match at least
 * one field (title, use_case, or body); if any token matches nothing, returns `null`
 * (excluded). Per token the best field score wins, weighted title > use_case > body.
 * An empty query yields a zero score and no ranges (caller treats it as "no search").
 */
export function scoreLibraryMatch(queryText: string, fields: SearchFields): SearchHit | null {
	const tokens = tokenize(queryText);
	if (tokens.length === 0) return { score: 0, titleRanges: [] };

	const foldedTitle = foldTitle(fields.title);
	const foldedUseCase = fold(fields.useCase);
	const foldedBody = fold(fields.body);

	let total = 0;
	const titlePositions = new Set<number>();

	for (const token of tokens) {
		const inTitle = subseqMatch(token, foldedTitle);
		const inUseCase = subseqMatch(token, foldedUseCase);
		const inBody = subseqMatch(token, foldedBody);

		let best = -1;
		if (inTitle) best = Math.max(best, inTitle.score * TITLE_WEIGHT);
		if (inUseCase) best = Math.max(best, inUseCase.score * USE_CASE_WEIGHT);
		if (inBody) best = Math.max(best, inBody.score * BODY_WEIGHT);

		if (best < 0) return null;
		total += best;
		if (inTitle) for (const p of inTitle.positions) titlePositions.add(p);
	}

	return { score: total, titleRanges: toRanges(titlePositions) };
}

/**
 * Title character ranges matched by `queryText`, for highlighting a result card.
 * Only tokens that occur in the title contribute; returns [] when there is no query.
 */
export function titleMatchRanges(queryText: string, title: string): Array<[number, number]> {
	const tokens = tokenize(queryText);
	if (tokens.length === 0) return [];

	const foldedTitle = foldTitle(title);
	const positions = new Set<number>();
	for (const token of tokens) {
		const match = subseqMatch(token, foldedTitle);
		if (match) for (const p of match.positions) positions.add(p);
	}
	return toRanges(positions);
}
