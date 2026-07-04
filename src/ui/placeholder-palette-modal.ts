import { SuggestModal, type App } from "obsidian";
import { filterCatalog, type PaletteEntry } from "../domain/placeholder-palette";
import { renderPaletteEntry } from "./placeholder-ui";

/**
 * Shared `SuggestModal` behind the command (FR-24.3) and the create-modal
 * button (FR-24.5): the only difference between the two surfaces is the
 * `onChoose` callback each one is constructed with.
 */
export class PlaceholderPaletteModal extends SuggestModal<PaletteEntry> {
	constructor(
		app: App,
		private readonly catalog: PaletteEntry[],
		private readonly onChoose: (entry: PaletteEntry) => void,
	) {
		super(app);
		this.setPlaceholder("Insert placeholder...");
	}

	getSuggestions(query: string): PaletteEntry[] {
		return filterCatalog(this.catalog, query);
	}

	renderSuggestion(entry: PaletteEntry, el: HTMLElement): void {
		renderPaletteEntry(entry, el);
	}

	onChooseSuggestion(entry: PaletteEntry): void {
		this.onChoose(entry);
	}
}
