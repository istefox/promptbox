import { normalizePath, type App, type TFile } from "obsidian";
import { resolveCollision } from "../domain/slug";
import {
	diffImportEntry,
	planImport,
	toExportedPrompt,
	type ExportDoc,
	type ExportedPrompt,
	type ImportDiff,
	type ImportPolicy,
} from "../domain/transfer";
import { readPromptFromCache, stripFrontmatter } from "./frontmatter";

export interface ImportSummary {
	created: number;
	skipped: number;
	overwritten: number;
	failed: number;
	errors: string[];
}

interface SaveFileHandle {
	name: string;
	createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
type SaveFilePicker = (options: {
	suggestedName?: string;
	types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveFileHandle>;

export type ExportDestination =
	| { kind: "picker"; name: string }
	| { kind: "vault"; path: string }
	| { kind: "cancelled" };

/**
 * Classic OS save dialog via the standard File System Access API when the
 * runtime provides it (desktop); vault-root file otherwise (mobile). FR-7.1
 * does not pin a destination.
 */
export async function exportWithDialog(app: App, doc: ExportDoc): Promise<ExportDestination> {
	const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
	if (picker) {
		try {
			const handle = await picker({
				suggestedName: `promptbox-export-${doc.exported_at.slice(0, 10) || "backup"}.json`,
				types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
			});
			const writable = await handle.createWritable();
			await writable.write(JSON.stringify(doc, null, 2));
			await writable.close();
			return { kind: "picker", name: handle.name };
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return { kind: "cancelled" };
		}
	}
	const file = await exportToVaultFile(app, doc);
	return { kind: "vault", path: file.path };
}

/** Writes the export document to a collision-safe JSON file in the vault root (FR-7.1). */
export async function exportToVaultFile(app: App, doc: ExportDoc): Promise<TFile> {
	const base = `promptbox-export-${doc.exported_at.slice(0, 10) || "backup"}`;
	const name = resolveCollision(base, (c) => app.vault.getAbstractFileByPath(`${c}.json`) !== null);
	return app.vault.create(`${name}.json`, JSON.stringify(doc, null, 2));
}

function applyEntry(fm: Record<string, unknown>, entry: ExportedPrompt): void {
	for (const key of ["category", "tags", "quality", "use_case"]) delete fm[key];
	fm["title"] = entry.title;
	fm["type"] = entry.type;
	if (entry.category !== "") fm["category"] = entry.category;
	if (entry.tags.length > 0) fm["tags"] = [...entry.tags];
	if (entry.quality !== undefined) fm["quality"] = entry.quality;
	if (entry.use_case !== "") fm["use_case"] = entry.use_case;
	fm["visibility"] = entry.visibility;
	fm["version"] = entry.version;
	// Imported dates are preserved so a migration keeps history (FR-7.4).
	fm["created"] = entry.created;
	fm["updated"] = entry.updated;
}

async function ensureParentFolder(app: App, fullPath: string): Promise<void> {
	const dir = fullPath.split("/").slice(0, -1).join("/");
	if (dir !== "" && !app.vault.getFolderByPath(dir)) await app.vault.createFolder(dir);
}

/** Relative paths (to `folder`) of every markdown note already in the vault. */
export function listExistingRelativePaths(app: App, folder: string): Set<string> {
	const prefix = folder === "" ? "" : normalizePath(folder) + "/";
	return new Set(
		app.vault
			.getMarkdownFiles()
			.map((f) => f.path)
			.filter((p) => prefix === "" || p.startsWith(prefix))
			.map((p) => p.slice(prefix.length)),
	);
}

/**
 * Executes a validated import (FR-7.3): the caller validates first, so nothing
 * here runs on malformed input; per-entry failures are collected, never thrown.
 */
export async function runImport(
	app: App,
	folder: string,
	doc: ExportDoc,
	policy: ImportPolicy,
): Promise<ImportSummary> {
	const prefix = folder === "" ? "" : normalizePath(folder) + "/";
	const existing = listExistingRelativePaths(app, folder);
	const summary: ImportSummary = { created: 0, skipped: 0, overwritten: 0, failed: 0, errors: [] };

	for (const action of planImport(doc, existing, policy)) {
		const fullPath = normalizePath(prefix + action.targetPath);
		try {
			if (action.kind === "skip") {
				summary.skipped++;
				continue;
			}
			if (action.kind === "overwrite") {
				const file = app.vault.getFileByPath(fullPath);
				if (file) {
					await app.vault.modify(file, action.entry.body);
					await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) =>
						applyEntry(fm, action.entry),
					);
					summary.overwritten++;
					continue;
				}
			}
			await ensureParentFolder(app, fullPath);
			const file = await app.vault.create(fullPath, action.entry.body);
			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) =>
				applyEntry(fm, action.entry),
			);
			summary.created++;
		} catch (error) {
			summary.failed++;
			summary.errors.push(`${action.targetPath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return summary;
}

/**
 * Computes the diff for every planned overwrite conflict (FR-17.1): reads only,
 * writes nothing, so the preview is structurally guaranteed to run before the
 * import's actual writes. A previewed target that has vanished from disk by
 * read time is silently dropped — `runImport` already falls back to creating
 * in that same situation.
 */
export async function buildOverwritePreview(app: App, folder: string, doc: ExportDoc): Promise<ImportDiff[]> {
	const prefix = folder === "" ? "" : normalizePath(folder) + "/";
	const existing = listExistingRelativePaths(app, folder);
	const diffs: ImportDiff[] = [];
	for (const action of planImport(doc, existing, "overwrite")) {
		if (action.kind !== "overwrite") continue;
		const fullPath = normalizePath(prefix + action.targetPath);
		const file = app.vault.getFileByPath(fullPath);
		if (!file) continue;
		const existingPrompt = readPromptFromCache(app, file);
		const existingBody = stripFrontmatter(await app.vault.cachedRead(file));
		const existingExported = toExportedPrompt(existingPrompt, existingBody, action.targetPath);
		diffs.push(diffImportEntry(existingExported, action.entry));
	}
	return diffs;
}
