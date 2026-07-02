import { normalizePath, type App, type TFile } from "obsidian";
import { resolveCollision } from "../domain/slug";
import { planImport, type ExportDoc, type ExportedPrompt, type ImportPolicy } from "../domain/transfer";

export interface ImportSummary {
	created: number;
	skipped: number;
	overwritten: number;
	failed: number;
	errors: string[];
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
	const existing = new Set(
		app.vault
			.getMarkdownFiles()
			.map((f) => f.path)
			.filter((p) => prefix === "" || p.startsWith(prefix))
			.map((p) => p.slice(prefix.length)),
	);
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
