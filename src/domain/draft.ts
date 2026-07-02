import type { Visibility } from "./prompt";

/** User-editable prompt fields collected by the create/edit modals (FR-3.1, FR-3.2). */
export interface PromptDraft {
	title: string;
	type: string;
	category: string;
	tags: string[];
	quality?: number;
	useCase: string;
	visibility: Visibility;
	version: string;
	/** Initial body, create mode only (FR-3.3). */
	body: string;
}

/**
 * Maps a draft to the §3.2 frontmatter fields. Empty optionals are omitted so
 * notes stay minimal; required fields are always present. Dates are stamped by
 * the writer, unknown custom fields are preserved by the writer's merge.
 */
export function draftToFrontmatter(draft: PromptDraft): Record<string, unknown> {
	const fm: Record<string, unknown> = {
		title: draft.title.trim(),
		type: draft.type,
	};
	if (draft.category.trim() !== "") fm["category"] = draft.category.trim();
	if (draft.tags.length > 0) fm["tags"] = [...draft.tags];
	if (draft.quality !== undefined) fm["quality"] = draft.quality;
	if (draft.useCase.trim() !== "") fm["use_case"] = draft.useCase.trim();
	fm["visibility"] = draft.visibility;
	fm["version"] = draft.version.trim() === "" ? "1.0" : draft.version.trim();
	return fm;
}

export interface VersionBump {
	value: string;
	bumped: boolean;
}

/** One-click version bump (FR-3.2): increments the trailing numeric segment. */
export function bumpVersion(version: string): VersionBump {
	const match = /^(.*?)(\d+)\s*$/.exec(version);
	if (!match) return { value: version, bumped: false };
	return { value: `${match[1] ?? ""}${Number(match[2]) + 1}`, bumped: true };
}
