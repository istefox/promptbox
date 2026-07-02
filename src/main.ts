import { Notice, Plugin, TFile } from "obsidian";
import { mergeSettings, type PromptboxSettings } from "./settings";
import { readPromptFromCache, stripFrontmatter } from "./storage/frontmatter";
import { PromptIndex } from "./storage/indexer";
import { PromptboxLibraryView, VIEW_TYPE_LIBRARY } from "./ui/library-view";
import { PromptModal } from "./ui/prompt-modal";
import { PromptQuickPicker } from "./ui/quick-picker";
import { PromptboxSettingTab } from "./ui/settings-tab";

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
				readBody: async (path) => {
					const file = this.app.vault.getFileByPath(path);
					return file ? stripFrontmatter(await this.app.vault.cachedRead(file)) : "";
				},
			},
			this.settings.promptsFolder,
		);

		this.registerView(VIEW_TYPE_LIBRARY, (leaf) => new PromptboxLibraryView(leaf, this));
		this.addRibbonIcon("library", "Open Promptbox library", () => {
			void this.activateLibraryView();
		});
		this.addCommand({
			id: "open-library",
			name: "Open library",
			callback: () => {
				void this.activateLibraryView();
			},
		});

		this.addSettingTab(new PromptboxSettingTab(this.app, this));

		this.addCommand({
			id: "new-prompt",
			name: "New prompt",
			callback: () => this.openCreateModal(),
		});
		this.addCommand({
			id: "edit-prompt-metadata",
			name: "Edit prompt metadata",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const inFolder =
					file !== null &&
					file.extension === "md" &&
					file.path.startsWith(this.settings.promptsFolder + "/");
				if (checking) return inFolder;
				if (inFolder) this.openEditModal(file.path);
				return inFolder;
			},
		});

		this.addCommand({
			id: "copy-prompt",
			name: "Copy prompt",
			callback: () => new PromptQuickPicker(this.app, this, false).open(),
		});
		this.addCommand({
			id: "copy-prompt-raw",
			name: "Copy prompt (raw)",
			callback: () => new PromptQuickPicker(this.app, this, true).open(),
		});

		// Deferred start: no vault I/O before the layout is ready (NFR-2).
		this.app.workspace.onLayoutReady(() => {
			void this.index.scan();
			this.registerEvent(
				this.app.metadataCache.on("changed", (file) => {
					if (file instanceof TFile) void this.index.handleCreateOrModify(file.path);
				}),
			);
			this.registerEvent(
				this.app.vault.on("create", (file) => {
					if (file instanceof TFile) void this.index.handleCreateOrModify(file.path);
				}),
			);
			this.registerEvent(
				this.app.vault.on("delete", (file) => {
					if (file instanceof TFile) this.index.handleDelete(file.path);
				}),
			);
			this.registerEvent(
				this.app.vault.on("rename", (file, oldPath) => {
					if (file instanceof TFile) void this.index.handleRename(oldPath, file.path);
				}),
			);
		});
	}

	async activateLibraryView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_LIBRARY)[0];
		if (!leaf) {
			leaf = workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_LIBRARY, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	openCreateModal(): void {
		new PromptModal(this.app, this.settings, this.settings.promptsFolder, { kind: "create" }).open();
	}

	openEditModal(path: string): void {
		const file = this.app.vault.getFileByPath(path);
		const prompt = this.index.get(path) ?? (file ? readPromptFromCache(this.app, file) : undefined);
		if (!file || !prompt) {
			new Notice("Promptbox: prompt not found.");
			return;
		}
		new PromptModal(this.app, this.settings, this.settings.promptsFolder, {
			kind: "edit",
			file,
			prompt,
		}).open();
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
