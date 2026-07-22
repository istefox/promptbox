import { ItemView, Menu, Notice, setIcon, setTooltip, type WorkspaceLeaf } from "obsidian";
import { buildCardMenuEntries, type CardMenuActionKey } from "../domain/card-menu";
import { chainOrphanSteps, isSaveableChain } from "../domain/chains";
import { lintLibrary, type PromptLintResult } from "../domain/lint";
import { emptyQuery, runQuery, type LibraryQuery } from "../domain/query";
import { titleMatchRanges } from "../domain/search";
import { usageRecencyMap } from "../domain/usage";
import type { Prompt } from "../domain/prompt";
import type PromptboxPlugin from "../main";
import { deletePrompt, setFavorite } from "../storage/prompt-writer";
import { ChainWizardModal } from "./chain-wizard-modal";
import { ConfirmModal } from "./confirm-modal";
import { copyRaw, copyWithVariables } from "./copy";
import { ImportModal } from "./import-modal";
import { LintModal } from "./lint-modal";
import { openNote } from "./open-note";
import { PackExportModal } from "./pack-export-modal";
import { renderFilterBar, type FilterBarHandle, type FilterOptions } from "./filter-bar";

export const VIEW_TYPE_LIBRARY = "promptbox-library";

/** Length-capped, whitespace-flattened preview of a prompt body for the card (FR-2). */
function bodyPreview(body: string): string {
	const flat = body.replace(/\s+/g, " ").trim();
	return flat.length > 400 ? flat.slice(0, 400) : flat;
}

/** Full-tab, read-only library view (FR-2, ADR-0002). */
export class PromptboxLibraryView extends ItemView {
	private readonly query: LibraryQuery = emptyQuery();
	private filterBar: FilterBarHandle | null = null;
	private countEl!: HTMLElement;
	private listEl!: HTMLElement;
	private unsubscribe: (() => void) | null = null;
	/** Pending long-press timers, cleared on every render pass so a mid-press re-render can't fire a menu against a detached card (issue #33). */
	private readonly cardMenuTimers = new Set<number>();
	/** All known prompt paths, lazily rebuilt per render() pass; see getKnownPaths(). */
	private knownPathsCache: Set<string> | null = null;

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
			void this.plugin.exportPrompts(runQuery(index.getAll(), (p) => index.getBody(p), this.effectiveQuery()));
		});
		const exportPackBtn = buttons.createEl("button", { text: "Export as pack…" });
		exportPackBtn.addEventListener("click", () => {
			const index = this.plugin.index;
			const filtered = runQuery(index.getAll(), (p) => index.getBody(p), this.effectiveQuery());
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
		const results = runQuery(index.getAll(), (path) => index.getBody(path), this.effectiveQuery());
		this.filterBar?.setOptions(this.collectOptions());
		this.countEl.setText(`${results.length} of ${index.size} prompt(s)`);
		for (const timer of this.cardMenuTimers) window.clearTimeout(timer);
		this.cardMenuTimers.clear();
		this.knownPathsCache = null;
		this.listEl.empty();
		if (results.length === 0) {
			this.renderEmptyState(index.size);
			return;
		}
		const lintByPath = new Map(
			lintLibrary(
				index.getAll(),
				(p) => index.getBody(p),
				this.plugin.settings.typeKey,
				this.plugin.settings.previousTypeKeys,
			).map((r) => [r.path, r]),
		);
		for (const prompt of results) this.renderItem(prompt, lintByPath);
	}

	/** FR-23.5: injects usage recency only for the "recently-used-desc" sort; every other sort is untouched. */
	private effectiveQuery(): LibraryQuery {
		if (this.query.sort !== "recently-used-desc") return this.query;
		return { ...this.query, usageRecency: usageRecencyMap(this.plugin.usage) };
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
		this.attachCardMenu(item, prompt);

		const header = item.createDiv({ cls: "promptbox-item__header" });
		this.addFavoriteToggle(header, prompt);
		this.renderTitle(header, prompt.title);
		const lintResult = lintByPath.get(prompt.path);
		const warningFindings = lintResult?.findings.filter((f) => f.severity === "warning") ?? [];
		if (warningFindings.length > 0) {
			const badge = header.createSpan({ cls: "promptbox-item__warning" });
			setIcon(badge, "alert-triangle");
			badge.setAttribute("aria-label", `Lint warnings: ${warningFindings.map((f) => f.message).join("; ")}`);
			badge.addEventListener("click", (evt) => {
				evt.stopPropagation();
				new LintModal(this.app, [...lintByPath.values()], { scopedToPath: prompt.path }).open();
			});
		}
		if (prompt.quality !== undefined) {
			header.createSpan({ text: "★".repeat(prompt.quality), cls: "promptbox-item__quality" });
		}
		const actions = header.createDiv({ cls: "promptbox-item__actions" });
		if (prompt.chain !== undefined) {
			const canRun = this.canRunChain(prompt);
			this.addItemAction(actions, "workflow", canRun ? "Run chain" : "Edit chain", () =>
				this.openChainCard(prompt),
			);
		} else {
			this.addItemAction(actions, "braces", "Copy with variables", () => this.doCopyWithVariables(prompt));
			this.addItemAction(actions, "clipboard-copy", "Copy raw", () => this.doCopyRaw(prompt));
		}
		this.addItemAction(actions, "pencil", "Edit metadata", () => this.plugin.openEditModal(prompt.path));
		this.addItemAction(actions, "file-text", "Open as note", () => {
			void this.openAsNote(prompt.path);
		});
		this.addItemAction(actions, "trash-2", "Delete", () => this.confirmDelete(prompt));

		if (prompt.chain !== undefined) {
			this.renderChainBadge(item, prompt);
			item.addClass("promptbox-item--chain");
			item.addEventListener("click", (evt) => {
				if ((evt.target as HTMLElement).closest("button")) return;
				this.openChainCard(prompt);
			});
		} else {
			const preview = bodyPreview(this.plugin.index.getBody(prompt.path));
			if (preview !== "") {
				item.createDiv({ text: preview, cls: "promptbox-item__body" });
			}
		}

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

	/** Renders the title with matched characters emphasized while a search query is active (FR-2.4). */
	private renderTitle(header: HTMLElement, title: string): void {
		const titleEl = header.createSpan({ cls: "promptbox-item__title" });
		const ranges = titleMatchRanges(this.query.text, title);
		if (ranges.length === 0) {
			titleEl.setText(title);
			return;
		}
		let cursor = 0;
		for (const [start, end] of ranges) {
			if (start > cursor) titleEl.appendText(title.slice(cursor, start));
			titleEl.createSpan({ text: title.slice(start, end), cls: "promptbox-library__match" });
			cursor = end;
		}
		if (cursor < title.length) titleEl.appendText(title.slice(cursor));
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
		favoriteBtn.addEventListener("click", () => this.toggleFavorite(prompt));
	}

	private addItemAction(container: HTMLElement, icon: string, label: string, onClick: () => void): void {
		const btn = container.createEl("button", { cls: "promptbox-item__action clickable-icon" });
		setIcon(btn, icon);
		btn.setAttribute("aria-label", label);
		setTooltip(btn, label);
		btn.addEventListener("click", onClick);
	}

	/** Right-click (desktop) / long-press (mobile) context menu on the card, additive to the header icons (issue #33). */
	private attachCardMenu(item: HTMLElement, prompt: Prompt): void {
		item.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			this.openCardMenu(prompt, (menu) => menu.showAtMouseEvent(evt));
		});

		const LONG_PRESS_MS = 500;
		const MOVE_CANCEL_PX = 10;
		let timer: number | null = null;
		let start = { x: 0, y: 0 };
		const cancel = (): void => {
			if (timer !== null) {
				window.clearTimeout(timer);
				this.cardMenuTimers.delete(timer);
				timer = null;
			}
		};
		item.addEventListener("touchstart", (evt) => {
			if (evt.touches.length > 1) {
				cancel();
				return;
			}
			const touch = evt.touches[0];
			if (!touch) return;
			start = { x: touch.clientX, y: touch.clientY };
			timer = window.setTimeout(() => {
				if (timer !== null) this.cardMenuTimers.delete(timer);
				timer = null;
				this.openCardMenu(prompt, (menu) => menu.showAtPosition({ x: start.x, y: start.y }));
			}, LONG_PRESS_MS);
			this.cardMenuTimers.add(timer);
		});
		item.addEventListener("touchmove", (evt) => {
			if (evt.touches.length > 1) {
				cancel();
				return;
			}
			const touch = evt.touches[0];
			if (!touch) return;
			const dx = touch.clientX - start.x;
			const dy = touch.clientY - start.y;
			if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) cancel();
		});
		item.addEventListener("touchend", cancel);
		item.addEventListener("touchcancel", cancel);
	}

	private openCardMenu(prompt: Prompt, show: (menu: Menu) => void): void {
		const menu = new Menu();
		for (const entry of buildCardMenuEntries(prompt, this.canRunChain(prompt))) {
			if (entry.separatorBefore) menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(entry.label);
				if (entry.warning) item.setWarning(true);
				item.onClick(() => this.runCardMenuAction(entry.actionKey, prompt));
			});
		}
		show(menu);
	}

	private runCardMenuAction(key: CardMenuActionKey, prompt: Prompt): void {
		switch (key) {
			case "copy-with-variables":
				this.doCopyWithVariables(prompt);
				return;
			case "copy-raw":
				this.doCopyRaw(prompt);
				return;
			case "open-chain":
				this.openChainCard(prompt);
				return;
			case "edit-metadata":
				this.plugin.openEditModal(prompt.path);
				return;
			case "open-as-note":
				void this.openAsNote(prompt.path);
				return;
			case "toggle-favorite":
				this.toggleFavorite(prompt);
				return;
			case "delete":
				this.confirmDelete(prompt);
				return;
		}
	}

	/** "Chain · N steps" (or "0/1 steps" for a sub-2-step/hand-edited chain, SPEC §4). */
	private renderChainBadge(item: HTMLElement, prompt: Prompt): void {
		const n = prompt.chain?.length ?? 0;
		const badge = item.createDiv({ cls: "promptbox-item__chain-badge" });
		badge.setText(`Chain · ${n} step${n === 1 ? "" : "s"}`);
	}

	/** True when the chain meets the 2-step minimum and is not fully orphaned (SPEC §4, edge cases). */
	private canRunChain(prompt: Prompt): boolean {
		const chain = prompt.chain;
		if (chain === undefined || !isSaveableChain(chain)) return false;
		return chainOrphanSteps(chain, this.getKnownPaths()).length < chain.length;
	}

	/** Lazily built, cached for the lifetime of one render() pass (invalidated at its start)
	 *  so a full-list render does O(totalPrompts) work once instead of rebuilding this Set for
	 *  every visible chain card. */
	private getKnownPaths(): Set<string> {
		if (!this.knownPathsCache) {
			this.knownPathsCache = new Set(this.plugin.index.getAll().map((p) => p.path));
		}
		return this.knownPathsCache;
	}

	/** Routes a chain card's primary action: the wizard when runnable, the edit modal otherwise. */
	private openChainCard(prompt: Prompt): void {
		if (prompt.chain === undefined) return;
		if (this.canRunChain(prompt)) {
			new ChainWizardModal(this.app, this.plugin.chainWizardDeps(), prompt.title, prompt.chain).open();
		} else {
			this.plugin.openChainModal(prompt.path);
		}
	}

	private doCopyWithVariables(prompt: Prompt): void {
		copyWithVariables(
			this.app,
			prompt.title,
			this.plugin.index.getBody(prompt.path),
			prompt.path,
			this.plugin.variableModalDeps(),
			() => this.plugin.recordPromptUsage(prompt.path),
		);
	}

	private doCopyRaw(prompt: Prompt): void {
		copyRaw(prompt.title, this.plugin.index.getBody(prompt.path), () => this.plugin.recordPromptUsage(prompt.path));
	}

	private toggleFavorite(prompt: Prompt): void {
		const file = this.app.vault.getFileByPath(prompt.path);
		if (!file) return;
		void setFavorite(this.app, file, !prompt.favorite).catch(
			(error: unknown) =>
				new Notice(`Promptbox: favorite update failed — ${error instanceof Error ? error.message : String(error)}`),
		);
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
