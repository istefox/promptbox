import { AbstractInputSuggest, getAllTags, TFolder, type App } from "obsidian";

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
	) {
		super(app, input);
	}

	getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && f.path !== "/" && f.path.toLowerCase().includes(q))
			.slice(0, 20);
	}

	override renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	override selectSuggestion(folder: TFolder): void {
		this.input.value = folder.path;
		this.input.trigger("input");
		this.close();
	}
}

/** All tags used in the vault, without the leading #, via the official cache API (FR-3.4). */
export function collectVaultTags(app: App): string[] {
	const tags = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;
		for (const tag of getAllTags(cache) ?? []) tags.add(tag.replace(/^#/, ""));
	}
	return [...tags].sort((a, b) => a.localeCompare(b));
}

export class JsonFileSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
	) {
		super(app, input);
	}

	getSuggestions(query: string): string[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getFiles()
			.map((f) => f.path)
			.filter((p) => p.endsWith(".json") && p.toLowerCase().includes(q))
			.slice(0, 20);
	}

	override renderSuggestion(path: string, el: HTMLElement): void {
		el.setText(path);
	}

	override selectSuggestion(path: string): void {
		this.input.value = path;
		this.input.trigger("input");
		this.close();
	}
}

export class TagSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
		private readonly pool: () => string[],
	) {
		super(app, input);
	}

	getSuggestions(query: string): string[] {
		const q = query.toLowerCase();
		return this.pool()
			.filter((t) => t.toLowerCase().includes(q))
			.slice(0, 20);
	}

	override renderSuggestion(tag: string, el: HTMLElement): void {
		el.setText(tag);
	}

	override selectSuggestion(tag: string): void {
		this.input.value = tag;
		this.input.trigger("input");
		this.close();
	}
}
