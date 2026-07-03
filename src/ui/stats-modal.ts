import { Modal, Notice, type App } from "obsidian";
import { computeLibraryStats, type CountEntry, type LibraryStats, type StaleEntry } from "../domain/stats";
import type PromptboxPlugin from "../main";

/** Read-only library statistics report (FR-22). Computed once on open, no live subscription. */
export class StatsModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: PromptboxPlugin,
	) {
		super(app);
		this.setTitle("Library statistics");
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		contentEl.addClass("promptbox-modal--wide");
		contentEl.addClass("promptbox-stats");

		const stats = computeLibraryStats(this.plugin.index.getAll(), {
			typeValues: this.plugin.settings.typeValues,
			categoryValues: this.plugin.settings.categoryValues,
		});

		if (stats.total === 0) {
			contentEl.createDiv({
				cls: "promptbox-stats__empty",
				text: "No prompts found yet. Add some notes to your prompts folder to see statistics here.",
			});
			return;
		}

		this.renderTotals(stats);
		this.renderCountSection("By type", stats.byType);
		this.renderCountSection("By category", stats.byCategory);
		this.renderCountSection("Top tags", stats.topTags);
		this.renderQuality(stats);
		this.renderStale(stats.stale);
		this.renderOrphans(stats);
	}

	private renderTotals(stats: LibraryStats): void {
		const section = this.contentEl.createDiv({ cls: "promptbox-stats__section" });
		section.createEl("h3", { text: "Totals" });
		section.createDiv({ cls: "promptbox-stats__row", text: `${stats.total} prompt(s)` });
	}

	private renderCountSection(heading: string, entries: CountEntry[]): void {
		const section = this.contentEl.createDiv({ cls: "promptbox-stats__section" });
		section.createEl("h3", { text: heading });
		if (entries.length === 0) {
			section.createDiv({ cls: "promptbox-stats__none", text: "None" });
			return;
		}
		for (const entry of entries) {
			section.createDiv({ cls: "promptbox-stats__row", text: `${entry.value} — ${entry.count}` });
		}
	}

	private renderQuality(stats: LibraryStats): void {
		const section = this.contentEl.createDiv({ cls: "promptbox-stats__section" });
		section.createEl("h3", { text: "Quality distribution" });
		for (const rating of stats.quality.ratings) {
			section.createDiv({ cls: "promptbox-stats__row", text: `${rating.value} — ${rating.count}` });
		}
		section.createDiv({ cls: "promptbox-stats__row", text: `Unset — ${stats.quality.unset}` });
	}

	private renderStale(entries: StaleEntry[]): void {
		const section = this.contentEl.createDiv({ cls: "promptbox-stats__section" });
		section.createEl("h3", { text: "Stale prompts" });
		if (entries.length === 0) {
			section.createDiv({ cls: "promptbox-stats__none", text: "None" });
			return;
		}
		for (const entry of entries) {
			const row = section.createDiv({ cls: "promptbox-stats__row promptbox-stats__row--stale" });
			row.createSpan({ text: `${entry.title} — ${entry.updated}` });
			const btn = row.createEl("button", { text: "Open as note", cls: "promptbox-stats__open-btn" });
			btn.addEventListener("click", () => {
				void this.openAsNote(entry.path);
			});
		}
	}

	private renderOrphans(stats: LibraryStats): void {
		const section = this.contentEl.createDiv({ cls: "promptbox-stats__section" });
		section.createEl("h3", { text: "Taxonomy orphans" });
		const orphans = [...stats.orphanTypes, ...stats.orphanCategories];
		if (orphans.length === 0) {
			section.createDiv({ cls: "promptbox-stats__none", text: "None" });
			return;
		}
		for (const entry of orphans) {
			const row = section.createDiv({ cls: "promptbox-stats__row" });
			row.createDiv({ text: `${entry.value} — ${entry.count} use(s)` });
			row.createDiv({
				cls: "promptbox-stats__hint",
				text: `Add "${entry.value}" back in Settings → Promptbox to keep tracking it.`,
			});
		}
	}

	private async openAsNote(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			new Notice("Note not found — the index may be stale.");
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}
}
