import type { Prompt, Visibility } from "./prompt";

export type SortKey = "updated-desc" | "created-desc" | "title-asc" | "quality-desc";

/** Inclusive YYYY-MM-DD bounds; ISO strings compare lexicographically. */
export interface DateRange {
	from: string | null;
	to: string | null;
}

export interface LibraryQuery {
	types: string[];
	categories: string[];
	/** A prompt must carry ALL selected tags (filters combine with AND, FR-2.2). */
	tags: string[];
	/** Minimum quality threshold; prompts without a rating are excluded when set. */
	minQuality: number | null;
	visibility: Visibility | null;
	/** SHOULD, FR-2.3: range on `updated`. */
	updatedRange: DateRange | null;
	/** Case-insensitive substring over title, use_case, and body (FR-2.4). */
	text: string;
	sort: SortKey;
}

export function emptyQuery(): LibraryQuery {
	return {
		types: [],
		categories: [],
		tags: [],
		minQuality: null,
		visibility: null,
		updatedRange: null,
		text: "",
		sort: "updated-desc",
	};
}

export function isQueryActive(q: LibraryQuery): boolean {
	return (
		q.types.length > 0 ||
		q.categories.length > 0 ||
		q.tags.length > 0 ||
		q.minQuality !== null ||
		q.visibility !== null ||
		q.updatedRange !== null ||
		q.text.trim() !== ""
	);
}

/** Pure filter + search + sort over the index content (FR-2.2, FR-2.4, FR-2.5). */
export function runQuery(
	prompts: Prompt[],
	getBody: (path: string) => string,
	q: LibraryQuery,
): Prompt[] {
	const needle = q.text.trim().toLowerCase();
	const results = prompts.filter((p) => {
		if (q.types.length > 0 && !q.types.includes(p.type)) return false;
		if (q.categories.length > 0 && !q.categories.includes(p.category)) return false;
		if (q.tags.length > 0 && !q.tags.every((t) => p.tags.includes(t))) return false;
		if (q.minQuality !== null && (p.quality === undefined || p.quality < q.minQuality)) return false;
		if (q.visibility !== null && p.visibility !== q.visibility) return false;
		if (q.updatedRange) {
			if (q.updatedRange.from && p.updated < q.updatedRange.from) return false;
			if (q.updatedRange.to && p.updated > q.updatedRange.to) return false;
		}
		if (needle !== "") {
			const haystack = `${p.title}\n${p.useCase}\n${getBody(p.path)}`.toLowerCase();
			if (!haystack.includes(needle)) return false;
		}
		return true;
	});
	return results.sort(comparator(q.sort));
}

function comparator(sort: SortKey): (a: Prompt, b: Prompt) => number {
	const byTitle = (a: Prompt, b: Prompt) => a.title.localeCompare(b.title);
	switch (sort) {
		case "updated-desc":
			return (a, b) => b.updated.localeCompare(a.updated) || byTitle(a, b);
		case "created-desc":
			return (a, b) => b.created.localeCompare(a.created) || byTitle(a, b);
		case "title-asc":
			return byTitle;
		case "quality-desc":
			return (a, b) => (b.quality ?? 0) - (a.quality ?? 0) || byTitle(a, b);
	}
}
