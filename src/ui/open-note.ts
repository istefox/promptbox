import { Notice, type App } from "obsidian";

/** Resolves a vault path and opens it in the active leaf; Notice if the index is stale. */
export async function openNote(app: App, path: string): Promise<void> {
	const file = app.vault.getFileByPath(path);
	if (!file) {
		new Notice("Note not found — the index may be stale.");
		return;
	}
	await app.workspace.getLeaf(false).openFile(file);
}
