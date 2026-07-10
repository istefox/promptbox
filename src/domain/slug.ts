import { tokenizeWords } from "./text";

/** Derives a file-name slug from a prompt title (FR-3.1). */
export function slugify(title: string): string {
	return tokenizeWords(title).join("-") || "untitled";
}

/** Resolves name collisions with a numeric suffix: slug, slug-1, slug-2, ... (FR-3.1). */
export function resolveCollision(slug: string, exists: (candidate: string) => boolean): string {
	if (!exists(slug)) return slug;
	for (let i = 1; ; i++) {
		const candidate = `${slug}-${i}`;
		if (!exists(candidate)) return candidate;
	}
}
