import { debounce, Notice, Plugin, TFile, type ObsidianProtocolData } from "obsidian";
import { mergeSettings, type PromptboxSettings } from "./settings";
import { normalizeUsage, pruneUsage, recordUsage, renameUsage, type UsageStore } from "./domain/usage";
import { readPromptFromCache, stripFrontmatter } from "./storage/frontmatter";
import { PromptIndex } from "./storage/indexer";
import { PromptboxLibraryView, VIEW_TYPE_LIBRARY } from "./ui/library-view";
import { LintModal } from "./ui/lint-modal";
import { PromptModal } from "./ui/prompt-modal";
import { PromptQuickPicker } from "./ui/quick-picker";
import { buildPaletteCatalog, type PaletteEntry } from "./domain/placeholder-palette";
import { PlaceholderEditorSuggest } from "./ui/placeholder-editor-suggest";
import { PlaceholderPaletteModal } from "./ui/placeholder-palette-modal";
import { applyEntryToEditor } from "./ui/placeholder-ui";
import { collectVaultTags } from "./ui/suggest";
import { ImportModal } from "./ui/import-modal";
import { StatsModal } from "./ui/stats-modal";
import { buildExport, buildPackExport, type PackHeader } from "./domain/transfer";
import { lintLibrary } from "./domain/lint";
import { exportWithDialog } from "./storage/transfer-io";
import type { Prompt } from "./domain/prompt";
import { resolveLauncherLookup } from "./domain/launcher";
import { copyRaw, copyWithVariables } from "./ui/copy";
import { upsertProfile } from "./domain/variable-profiles";
import { PromptboxSettingTab } from "./ui/settings-tab";
import type { VariableModalDeps } from "./ui/variable-modal";

export default class PromptboxPlugin extends Plugin {
	override settings!: PromptboxSettings;
	/** FR-23.2: plugin-local telemetry, not a user-facing setting; excluded from the settings tab. */
	usage: UsageStore = {};
	index!: PromptIndex;
	private indexReady!: Promise<void>;
	/** One write per copy burst (FR-23.1/23.2), reusing the single `saveSettings` save path. */
	private readonly debouncedSaveUsage = debounce(() => {
		this.saveSettings().catch((error: unknown) => console.warn("Promptbox: usage save failed", error));
	}, 500);

	override async onload(): Promise<void> {
		const data: unknown = await this.loadData();
		this.settings = mergeSettings(data);
		this.usage = normalizeUsage(
			typeof data === "object" && data !== null ? (data as Record<string, unknown>)["usage"] : undefined,
		);

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

		this.registerObsidianProtocolHandler("promptbox", (params) => {
			void this.handleLauncherUri(params);
		});

		this.registerEditorSuggest(new PlaceholderEditorSuggest(this.app, this));

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
			id: "insert-placeholder",
			name: "Insert placeholder",
			editorCheckCallback: (checking, editor, ctx) => {
				const inFolder = ctx.file !== null && ctx.file.path.startsWith(this.settings.promptsFolder + "/");
				if (checking) return inFolder;
				if (inFolder) {
					new PlaceholderPaletteModal(this.app, this.paletteCatalog(), (entry) => {
						const cursor = editor.getCursor();
						applyEntryToEditor(editor, { from: cursor, to: cursor }, entry);
					}).open();
				}
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
		this.indexReady = new Promise<void>((resolve) => {
			this.app.workspace.onLayoutReady(() => {
				void this.index.scan().then(() => {
					resolve();
					const pruned = pruneUsage(this.usage, new Set(this.index.getAll().map((p) => p.path)));
					if (Object.keys(pruned).length !== Object.keys(this.usage).length) {
						this.usage = pruned;
						this.debouncedSaveUsage();
					}
				});
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
						if (file instanceof TFile) {
							void this.index.handleRename(oldPath, file.path);
							this.usage = renameUsage(this.usage, oldPath, file.path);
							this.debouncedSaveUsage();
						}
					}),
				);
			});
		});
	}

	/** FR-13: `obsidian://promptbox` launcher URI action. Waits on the first index scan (ADR-0008). */
	private async handleLauncherUri(params: ObsidianProtocolData): Promise<void> {
		await this.indexReady;
		const path = typeof params.path === "string" ? params.path : undefined;
		const title = typeof params.title === "string" ? params.title : undefined;
		const raw = params.raw === "true";
		const result = resolveLauncherLookup(this.index.getAll(), { path, title });
		if (result.kind === "picker") {
			new PromptQuickPicker(this.app, this, raw).open();
			return;
		}
		if (result.kind === "no-match") {
			new Notice(`Promptbox: no prompt matching ${result.source} "${result.value}".`);
			return;
		}
		const body = this.index.getBody(result.prompt.path);
		const onCopied = (): void => this.recordPromptUsage(result.prompt.path);
		if (raw) copyRaw(result.prompt.title, body, onCopied);
		else
			copyWithVariables(
				this.app,
				result.prompt.title,
				body,
				result.prompt.path,
				this.variableModalDeps(),
				onCopied,
			);
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

	/** FR-24.1: shared catalog, recomputed on every surface-open, never cached across sessions. */
	paletteCatalog(): PaletteEntry[] {
		return buildPaletteCatalog(this.index.getAll(), (p) => this.index.getBody(p));
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

	/** Flush any pending usage write so a copy in the last debounce window is not lost on unload (FR-23.2). */
	override onunload(): void {
		this.debouncedSaveUsage.run();
	}

	/**
	 * FR-23.1: records a successful copy at the call site (`prompt.path` in
	 * scope). Best-effort — the debounced save swallows its own errors, so
	 * this never blocks or fails the copy that triggered it.
	 */
	recordPromptUsage(path: string): void {
		this.usage = recordUsage(this.usage, path, new Date().toISOString());
		this.debouncedSaveUsage();
	}

	private modalDeps() {
		return {
			settings: this.settings,
			folder: this.settings.promptsFolder,
			tagPool: this.buildTagPool(),
			allPrompts: this.index.getAll(),
			paletteCatalog: this.paletteCatalog(),
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
		await this.saveData({ ...this.settings, usage: this.usage });
	}

	/** FR-1.2 — wired to the settings tab UI in a later tier. */
	setPromptsFolder(folder: string): void {
		this.settings.promptsFolder = folder;
		void this.saveSettings();
		this.index.setFolder(folder);
	}
}
