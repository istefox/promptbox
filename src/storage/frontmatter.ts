import type { App, TFile } from "obsidian";
import { normalizePrompt, type Prompt } from "../domain/prompt";

/** Local date as YYYY-MM-DD (frontmatter dates are calendar dates, not instants). */
export function todayISO(now = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/**
 * Reads a prompt through Obsidian's metadata cache — never hand-parsed YAML (ADR-0001).
 * A file without (or with broken) frontmatter still yields a usable Prompt with warnings.
 */
export function readPromptFromCache(app: App, file: TFile): Prompt {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	return normalizePrompt(frontmatter, {
		path: file.path,
		filename: file.basename,
		today: todayISO(),
	});
}

/** Strips the leading YAML frontmatter block from raw note content. */
export function stripFrontmatter(raw: string): string {
	return raw.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, "");
}

/**
 * Stamps dates on a plugin-driven save: `created` once, `updated` always (§3.2).
 * Writes go exclusively through the official frontmatter API (ADR-0001).
 * External edits are never rewritten; callers invoke this only on explicit user actions.
 */
export async function stampSaveDates(app: App, file: TFile): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		const today = todayISO();
		if (typeof fm["created"] !== "string" || fm["created"] === "") fm["created"] = today;
		fm["updated"] = today;
	});
}
