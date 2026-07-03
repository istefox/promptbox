import { ItemView, Notice, setIcon, setTooltip, type WorkspaceLeaf } from "obsidian";
import { lintLibrary, type PromptLintResult } from "../domain/lint";
import { emptyQuery, runQuery, type LibraryQuery } from "../domain/query";
import type { Prompt } from "../domain/prompt";
import type PromptboxPlugin from "../main";
import { deletePrompt, setFavorite } from "../storage/prompt-writer";
import { ConfirmModal } from "./confirm-modal";
import { copyRaw, copyWithVariables } from "./copy";
import { ImportModal } from "./import-modal";
import { LintModal } from "./lint-modal";
import { openNote } from "./open-note";
import { PackExportModal } from "./pack-export-modal";
import { renderFilterBar, type FilterBarHandle, type FilterOptions } from "./filter-bar";

export const VIEW_TYPE_LIBRARY = "promptbox-library";

/** Full-tab, read-only library view (FR-2, ADR-0002). */
export class PromptboxLibraryView extends ItemView {
	private readonly query: LibraryQuery = emptyQuery();
	private filterBar: FilterBarHandle | null = null;
	private countEl!: HTMLElement;
	private listEl!: HTMLElement;
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: PromptboxPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_LIBRARY;
	}

	override getDisplayText(): string {
		return "Promptbox library";
	}

	override getIcon(): string {
		return "library";
	}

	override async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("promptbox-library");
		const header = root.createDiv({ cls: "promptbox-library__title" });
		const headerIcon = header.createSpan({ cls: "promptbox-field-icon" });
		setIcon(headerIcon, "library");
		header.createEl("h1", { text: "Promptbox Library" });
		const filterEl = root.createDiv();
		this.filterBar = renderFilterBar(filterEl, this.query, this.collectOptions(), () => this.render());
		const countRow = root.createDiv({ cls: "promptbox-library__count-row" });
		this.countEl = countRow.createDiv({ cls: "promptbox-library__count" });
		const buttons = countRow.createDiv({ cls: "promptbox-library__buttons" });
		const newBtn = buttons.createEl("button", { text: "New prompt", cls: "mod-cta" });
		newBtn.addEventListener("click", () => this.plugin.openCreateModal());
		const exportBtn = buttons.createEl("button", { text: "Export filtered" });
		exportBtn.addEventListener("click", () => {
			const index = this.plugin.index;
			void this.plugin.exportPrompts(runQuery(index.getAll(), (p) => index.getBody(p), this.query));
		});
		const exportPackBtn = buttons.createEl("button", { text: "Export as pack…" });
		exportPackBtn.addEventListener("click", () => {
			const index = this.plugin.index;
			const filtered = runQuery(index.getAll(), (p) => index.getBody(p), this.query);
			if (filtered.length === 0) {
				new Notice("Promptbox: nothing to export.");
				return;
			}
			new PackExportModal(this.app, filtered.length, (pack) => {
				void this.plugin.exportPromptsAsPack(filtered, pack);
			}).open();
		});
		const importBtn = buttons.createEl("button", { text: "Import" });
		importBtn.addEventListener("click", () => new ImportModal(this.app, this.plugin).open());
		this.listEl = root.createDiv({ cls: "promptbox-library__list" });
		this.unsubscribe = this.plugin.index.onChange(() => this.render());
		this.render();
		return Promise.resolve();
	}

	override async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		return Promise.resolve();
	}

	/** Single render path (ADR-0002): every state change funnels through here. */
	private render(): void {
		const index = this.plugin.index;
		const results = runQuery(index.getAll(), (path) => index.getBody(path), this.query);
		this.filterBar?.setOptions(this.collectOptions());
		this.countEl.setText(`${results.length} of ${index.size} prompt(s)`);
		this.listEl.empty();
		if (results.length === 0) {
			this.renderEmptyState(index.size);
			return;
		}
		const lintByPath = new Map(lintLibrary(index.getAll(), (p) => index.getBody(p)).map((r) => [r.path, r]));
		for (const prompt of results) this.renderItem(prompt, lintByPath);
	}

	private renderEmptyState(indexSize: number): void {
		const empty = this.listEl.createDiv({ cls: "promptbox-library__empty" });
		if (indexSize === 0) {
			empty.setText(
				`No prompts found in "${this.plugin.settings.promptsFolder}". Create notes in that folder or change it in the plugin settings.`,
			);
		} else {
			empty.setText("No prompts match the current filters.");
		}
	}

	private renderItem(prompt: Prompt, lintByPath: Map<string, PromptLintResult>): void {
		const item = this.listEl.createDiv({ cls: "promptbox-item" });

		const header = item.createDiv({ cls: "promptbox-item__header" });
		this.addFavoriteToggle(header, prompt);
		header.createSpan({ text: prompt.title, cls: "promptbox-item__title" });
		const lintResult = lintByPath.get(prompt.path);
		const warningFindings = lintResult?.findings.filter((f) => f.severity === "warning") ?? [];
		if (warningFindings.length > 0) {
			const badge = header.createSpan({ cls: "promptbox-item__warning" });
			setIcon(badge, "alert-triangle");
			badge.setAttribute("aria-label", `Lint warnings: ${warningFindings.map((f) => f.message).join("; ")}`);
			badge.addEventListener("click", () => {
				new LintModal(this.app, [...lintByPath.values()], { scopedToPath: prompt.path }).open();
			});
		}
		if (prompt.quality !== undefined) {
			header.createSpan({ text: "★".repeat(prompt.quality), cls: "promptbox-item__quality" });
		}
		const actions = header.createDiv({ cls: "promptbox-item__actions" });
		this.addItemAction(actions, "braces", "Copy with variables", () =>
			copyWithVariables(
				this.app,
				prompt.title,
				this.plugin.index.getBody(prompt.path),
				prompt.path,
				this.plugin.variableModalDeps(),
			),
		);
		this.addItemAction(actions, "clipboard-copy", "Copy raw", () =>
			copyRaw(prompt.title, this.plugin.index.getBody(prompt.path)),
		);
		this.addItemAction(actions, "pencil", "Edit metadata", () => this.plugin.openEditModal(prompt.path));
		this.addItemAction(actions, "file-text", "Open as note", () => {
			void this.openAsNote(prompt.path);
		});
		this.addItemAction(actions, "trash-2", "Delete", () => this.confirmDelete(prompt));

		const meta = item.createDiv({ cls: "promptbox-item__meta" });
		meta.createSpan({ text: prompt.type, cls: "promptbox-pill promptbox-pill--type" });
		if (prompt.category !== "") {
			meta.createSpan({ text: prompt.category, cls: "promptbox-pill promptbox-pill--category" });
		}
		for (const tag of prompt.tags) {
			meta.createSpan({ text: `#${tag}`, cls: "promptbox-pill promptbox-pill--tag" });
		}
		if (prompt.visibility === "public") {
			meta.createSpan({ text: "public", cls: "promptbox-pill promptbox-pill--visibility" });
		}
		meta.createSpan({ text: `v${prompt.version}`, cls: "promptbox-item__version" });
		meta.createSpan({ text: `updated ${prompt.updated}`, cls: "promptbox-item__date" });

		if (prompt.useCase !== "") {
			item.createDiv({ text: prompt.useCase, cls: "promptbox-item__usecase" });
		}

	}

	private addFavoriteToggle(header: HTMLElement, prompt: Prompt): void {
		const favoriteBtn = header.createEl("button", {
			cls: "promptbox-item__action clickable-icon" + (prompt.favorite ? " is-favorite" : ""),
		});
		setIcon(favoriteBtn, "star");
		const label = prompt.favorite ? "Remove from favorites" : "Add to favorites";
		favoriteBtn.setAttribute("aria-label", label);
		favoriteBtn.setAttribute("aria-pressed", String(prompt.favorite));
		setTooltip(favoriteBtn, label);
		favoriteBtn.addEventListener("click", () => {
			const file = this.app.vault.getFileByPath(prompt.path);
			if (!file) return;
			void setFavorite(this.app, file, !prompt.favorite).catch(
				(error: unknown) =>
					new Notice(`Promptbox: favorite update failed — ${error instanceof Error ? error.message : String(error)}`),
			);
		});
	}

	private addItemAction(container: HTMLElement, icon: string, label: string, onClick: () => void): void {
		const btn = container.createEl("button", { cls: "promptbox-item__action clickable-icon" });
		setIcon(btn, icon);
		btn.setAttribute("aria-label", label);
		setTooltip(btn, label);
		btn.addEventListener("click", onClick);
	}

	private async openAsNote(path: string): Promise<void> {
		await openNote(this.app, path);
	}

	private confirmDelete(prompt: Prompt): void {
		new ConfirmModal(
			this.app,
			"Delete prompt",
			`Move "${prompt.title}" to the trash? The Obsidian trash preference applies.`,
			"Delete",
			() => {
				const file = this.app.vault.getFileByPath(prompt.path);
				if (!file) return;
				void deletePrompt(this.app, file).then(
					() => new Notice(`Deleted: ${prompt.title}`),
					(error: unknown) =>
						new Notice(`Promptbox: delete failed — ${error instanceof Error ? error.message : String(error)}`),
				);
			},
		).open();
	}

	private collectOptions(): FilterOptions {
		const settings = this.plugin.settings;
		const types = new Set(settings.typeValues);
		const categories = new Set(settings.categoryValues);
		const tags = new Set<string>();
		for (const p of this.plugin.index.getAll()) {
			if (p.type !== "") types.add(p.type);
			if (p.category !== "") categories.add(p.category);
			for (const t of p.tags) tags.add(t);
		}
		return {
			types: [...types],
			categories: [...categories].sort((a, b) => a.localeCompare(b)),
			tags: [...tags].sort((a, b) => a.localeCompare(b)),
		};
	}
}
