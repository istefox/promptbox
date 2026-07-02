import { normalizePath, type App, type TFile } from "obsidian";
import { draftToFrontmatter, type PromptDraft } from "../domain/draft";
import { resolveCollision, slugify } from "../domain/slug";
import { todayISO } from "./frontmatter";

const OPTIONAL_FIELDS = ["category", "tags", "quality", "use_case"] as const;

/**
 * Creates a new prompt note (FR-3.1): slug file name with collision suffix,
 * body first, then frontmatter through the official API only (ADR-0001).
 */
export async function createPrompt(app: App, folder: string, draft: PromptDraft): Promise<TFile> {
	const dir = normalizePath(folder);
	if (!app.vault.getFolderByPath(dir)) await app.vault.createFolder(dir);
	const slug = resolveCollision(
		slugify(draft.title),
		(candidate) => app.vault.getAbstractFileByPath(`${dir}/${candidate}.md`) !== null,
	);
	const file = await app.vault.create(`${dir}/${slug}.md`, draft.body);
	const today = todayISO();
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		Object.assign(fm, draftToFrontmatter(draft));
		fm["created"] = today;
		fm["updated"] = today;
	});
	return file;
}

/**
 * Updates metadata on an explicit user action (FR-3.2): cleared optionals are
 * removed, `updated` refreshed, `created` and unknown custom fields preserved.
 * The body is never touched (FR-3.3).
 */
export async function updatePrompt(app: App, file: TFile, draft: PromptDraft): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		for (const key of OPTIONAL_FIELDS) delete fm[key];
		Object.assign(fm, draftToFrontmatter(draft));
		fm["updated"] = todayISO();
	});
}

/** Deletes via the Obsidian trash mechanism, honoring the user's preference (FR-2.6). */
export async function deletePrompt(app: App, file: TFile): Promise<void> {
	await app.fileManager.trashFile(file);
}

/** Explicit-toggle write (FR-9.1): unset is represented by the key's
 * absence, matching draftToFrontmatter's "omit empty optionals" convention,
 * so an unfavorited note stays exactly as minimal as before this feature. */
export async function setFavorite(app: App, file: TFile, value: boolean): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		if (value) fm["favorite"] = true;
		else delete fm["favorite"];
	});
}
