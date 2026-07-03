import { Notice, Plugin, TFile } from "obsidian";
import { mergeSettings, type PromptboxSettings } from "./settings";
import { readPromptFromCache, stripFrontmatter } from "./storage/frontmatter";
import { PromptIndex } from "./storage/indexer";
import { PromptboxLibraryView, VIEW_TYPE_LIBRARY } from "./ui/library-view";
import { LintModal } from "./ui/lint-modal";
import { PromptModal } from "./ui/prompt-modal";
import { PromptQuickPicker } from "./ui/quick-picker";
import { collectVaultTags } from "./ui/suggest";
import { ImportModal } from "./ui/import-modal";
import { StatsModal } from "./ui/stats-modal";
import { buildExport, buildPackExport, type PackHeader } from "./domain/transfer";
import { lintLibrary } from "./domain/lint";
import { exportWithDialog } from "./storage/transfer-io";
import type { Prompt } from "./domain/prompt";
import { upsertProfile } from "./domain/variable-profiles";
import { PromptboxSettingTab } from "./ui/settings-tab";
import type { VariableModalDeps } from "./ui/variable-modal";

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
		this.addCommand({
			id: "export-json",
			name: "Export prompts (JSON)",
			callback: () => void this.exportPrompts(this.index.getAll()),
		});
		this.addCommand({
			id: "import-json",
			name: "Import prompts (JSON)",
			callback: () => new ImportModal(this.app, this).open(),
		});
		this.addCommand({
			id: "lint-library",
			name: "Lint library",
			callback: () =>
				new LintModal(this.app, lintLibrary(this.index.getAll(), (p) => this.index.getBody(p))).open(),
		});
		this.addCommand({
			id: "library-statistics",
			name: "Library statistics",
			callback: () => new StatsModal(this.app, this).open(),
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

	/** FR-7.1: exports all prompts, or the filtered set when launched from the view. */
	async exportPrompts(prompts: Prompt[]): Promise<void> {
		if (prompts.length === 0) {
			new Notice("Promptbox: nothing to export.");
			return;
		}
		const doc = buildExport(
			prompts,
			(path) => this.index.getBody(path),
			this.settings.promptsFolder,
			new Date().toISOString(),
		);
		try {
			const dest = await exportWithDialog(this.app, doc);
			if (dest.kind === "cancelled") return;
			const where = dest.kind === "picker" ? dest.name : `${dest.path} (vault root)`;
			new Notice(`Exported ${prompts.length} prompt(s) to ${where}`);
		} catch (error) {
			new Notice(`Promptbox: export failed — ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/** FR-20.1: exports the given (typically filtered) set with a pack header. */
	async exportPromptsAsPack(prompts: Prompt[], pack: PackHeader): Promise<void> {
		if (prompts.length === 0) {
			new Notice("Promptbox: nothing to export.");
			return;
		}
		const doc = buildPackExport(
			prompts,
			(path) => this.index.getBody(path),
			this.settings.promptsFolder,
			new Date().toISOString(),
			pack,
		);
		try {
			const dest = await exportWithDialog(this.app, doc);
			if (dest.kind === "cancelled") return;
			const where = dest.kind === "picker" ? dest.name : `${dest.path} (vault root)`;
			new Notice(`Exported ${prompts.length} prompt(s) to ${where}`);
		} catch (error) {
			new Notice(`Promptbox: export failed — ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/** Narrow deps for `VariableModal` (ADR-0009), mirrors `modalDeps()`. */
	variableModalDeps(): VariableModalDeps {
		return {
			profiles: this.settings.profiles,
			saveProfile: (name, values) => this.saveVariableProfile(name, values),
		};
	}

	/** FR-14.3: save-as-profile, called from the variable modal. */
	async saveVariableProfile(name: string, values: Record<string, string>): Promise<void> {
		this.settings.profiles = upsertProfile(this.settings.profiles, name, values);
		await this.saveSettings();
	}

	private modalDeps() {
		return {
			settings: this.settings,
			folder: this.settings.promptsFolder,
			tagPool: this.buildTagPool(),
			allPrompts: this.index.getAll(),
			persistSettings: () => this.saveSettings(),
			openFile: (file: TFile) => {
				void this.app.workspace.getLeaf(false).openFile(file);
			},
		};
	}

	/** Library tags first, vault-wide tags after (keeps FR-3.4, pushes noise down). */
	private buildTagPool(): string[] {
		const fromPrompts = new Set<string>();
		for (const p of this.index.getAll()) for (const t of p.tags) fromPrompts.add(t);
		const pool = [...fromPrompts].sort((a, b) => a.localeCompare(b));
		for (const t of collectVaultTags(this.app)) if (!fromPrompts.has(t)) pool.push(t);
		return pool;
	}

	openCreateModal(): void {
		new PromptModal(this.app, this.modalDeps(), { kind: "create" }).open();
	}

	openEditModal(path: string): void {
		const file = this.app.vault.getFileByPath(path);
		const prompt = this.index.get(path) ?? (file ? readPromptFromCache(this.app, file) : undefined);
		if (!file || !prompt) {
			new Notice("Promptbox: prompt not found.");
			return;
		}
		new PromptModal(this.app, this.modalDeps(), { kind: "edit", file, prompt }).open();
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
