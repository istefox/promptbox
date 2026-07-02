import { Notice, Plugin, TFile } from "obsidian";
import { mergeSettings, type PromptboxSettings } from "./settings";
import { readPromptFromCache } from "./storage/frontmatter";
import { PromptIndex } from "./storage/indexer";

export default class PromptboxPlugin extends Plugin {
	override settings!: PromptboxSettings;
	index!: PromptIndex;

	override async onload(): Promise<void> {
		this.settings = mergeSettings(await this.loadData());

		this.index = new PromptIndex(
			{
				listMarkdownFiles: () => this.app.vault.getMarkdownFiles().map((f) => f.path),
				readPrompt: (path) => {
					const file = this.app.vault.getFileByPath(path);
					return file ? readPromptFromCache(this.app, file) : null;
				},
			},
			this.settings.promptsFolder,
		);

		this.addCommand({
			id: "dump-index",
			name: "Dump index (debug)",
			callback: () => {
				const all = this.index.getAll();
				console.log(`Promptbox index: ${all.length} prompt(s)`, all);
				new Notice(`Promptbox index: ${all.length} prompt(s) — details in console.`);
			},
		});

		// Deferred start: no vault I/O before the layout is ready (NFR-2).
		this.app.workspace.onLayoutReady(() => {
			void this.index.scan();
			this.registerEvent(
				this.app.metadataCache.on("changed", (file) => {
					if (file instanceof TFile) this.index.handleCreateOrModify(file.path);
				}),
			);
			this.registerEvent(
				this.app.vault.on("create", (file) => {
					if (file instanceof TFile) this.index.handleCreateOrModify(file.path);
				}),
			);
			this.registerEvent(
				this.app.vault.on("delete", (file) => {
					if (file instanceof TFile) this.index.handleDelete(file.path);
				}),
			);
			this.registerEvent(
				this.app.vault.on("rename", (file, oldPath) => {
					if (file instanceof TFile) this.index.handleRename(oldPath, file.path);
				}),
			);
		});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** FR-1.2 — wired to the settings tab UI in a later tier. */
	setPromptsFolder(folder: string): void {
		this.settings.promptsFolder = folder;
		void this.saveSettings();
		this.index.setFolder(folder);
	}
}
