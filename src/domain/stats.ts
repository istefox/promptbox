import { isCustomValue, type Prompt } from "./prompt";

export interface CountEntry {
	value: string;
	count: number;
}

export interface QualityDistribution {
	/** Exactly 5 entries, ratings "1".."5" in ascending order; count may be 0. */
	ratings: CountEntry[];
	/** Prompts with no quality set. */
	unset: number;
}

export interface StaleEntry {
	path: string;
	title: string;
	updated: string;
}

export interface StatsTaxonomy {
	typeValues: string[];
	categoryValues: string[];
}

export interface LibraryStats {
	total: number;
	byType: CountEntry[];
	byCategory: CountEntry[];
	topTags: CountEntry[];
	quality: QualityDistribution;
	stale: StaleEntry[];
	orphanTypes: CountEntry[];
	orphanCategories: CountEntry[];
}

/** Count-desc, then value-asc (localeCompare), matching query.ts's comparator style. */
function countBy(values: string[]): CountEntry[] {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Pure aggregator over the index content + settings taxonomy (FR-22.1). Never throws. */
export function computeLibraryStats(prompts: Prompt[], taxonomy: StatsTaxonomy): LibraryStats {
	const byType = countBy(prompts.map((p) => p.type));
	const byCategory = countBy(prompts.filter((p) => p.category !== "").map((p) => p.category));

	const tagValues: string[] = [];
	for (const p of prompts) for (const tag of p.tags) tagValues.push(tag);
	const topTags = countBy(tagValues).slice(0, 10);

	const ratings: CountEntry[] = [];
	for (let rating = 1; rating <= 5; rating++) {
		ratings.push({ value: String(rating), count: prompts.filter((p) => p.quality === rating).length });
	}
	const unset = prompts.filter((p) => p.quality === undefined).length;

	const stale: StaleEntry[] = [...prompts]
		.sort((a, b) => a.updated.localeCompare(b.updated) || a.title.localeCompare(b.title))
		.slice(0, 10)
		.map((p) => ({ path: p.path, title: p.title, updated: p.updated }));

	const orphanTypes = byType.filter((entry) => isCustomValue(entry.value, taxonomy.typeValues));
	const orphanCategories = byCategory.filter((entry) => isCustomValue(entry.value, taxonomy.categoryValues));

	return {
		total: prompts.length,
		byType,
		byCategory,
		topTags,
		quality: { ratings, unset },
		stale,
		orphanTypes,
		orphanCategories,
	};
}
