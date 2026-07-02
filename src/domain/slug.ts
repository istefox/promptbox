/** Derives a file-name slug from a prompt title (FR-3.1). */
export function slugify(title: string): string {
	const slug = title
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug === "" ? "untitled" : slug;
}

/** Resolves name collisions with a numeric suffix: slug, slug-1, slug-2, ... (FR-3.1). */
export function resolveCollision(slug: string, exists: (candidate: string) => boolean): string {
	if (!exists(slug)) return slug;
	for (let i = 1; ; i++) {
		const candidate = `${slug}-${i}`;
		if (!exists(candidate)) return candidate;
	}
}
