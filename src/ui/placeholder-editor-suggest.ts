import {
	EditorSuggest,
	type App,
	type Editor,
	type EditorPosition,
	type EditorSuggestContext,
	type EditorSuggestTriggerInfo,
} from "obsidian";
import { filterCatalog, matchPlaceholderTrigger, type PaletteEntry } from "../domain/placeholder-palette";
import type PromptboxPlugin from "../main";
import { applyEntryToEditor, renderPaletteEntry } from "./placeholder-ui";

/** Inline `{{` autocomplete in the note editor (FR-24.4), registered via `registerEditorSuggest`. */
export class PlaceholderEditorSuggest extends EditorSuggest<PaletteEntry> {
	/** Built lazily per trigger session, not per keystroke (FR-24.8). */
	private cachedCatalog: PaletteEntry[] | null = null;

	constructor(
		app: App,
		private readonly plugin: PromptboxPlugin,
	) {
		super(app);
	}

	onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const trigger = matchPlaceholderTrigger(line.slice(0, cursor.ch), line.slice(cursor.ch));
		if (!trigger) {
			this.cachedCatalog = null;
			return null;
		}
		return { start: { line: cursor.line, ch: trigger.start }, end: cursor, query: trigger.query };
	}

	getSuggestions(context: EditorSuggestContext): PaletteEntry[] {
		this.cachedCatalog ??= this.plugin.paletteCatalog();
		return filterCatalog(this.cachedCatalog, context.query);
	}

	renderSuggestion(entry: PaletteEntry, el: HTMLElement): void {
		renderPaletteEntry(entry, el);
	}

	selectSuggestion(entry: PaletteEntry): void {
		if (!this.context) return;
		applyEntryToEditor(this.context.editor, { from: this.context.start, to: this.context.end }, entry);
	}
}
