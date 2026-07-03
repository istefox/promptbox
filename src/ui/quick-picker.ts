import { FuzzySuggestModal, setIcon, type App, type FuzzyMatch } from "obsidian";
import type { Prompt } from "../domain/prompt";
import { rankFavoritesFirst } from "../domain/query";
import type PromptboxPlugin from "../main";
import { copyRaw, copyWithVariables } from "./copy";

/**
 * Fuzzy picker over title, category, tags, and use_case (FR-5.1).
 * Desktop secondary action: modifier key + Enter/click copies raw (FR-5.2);
 * on mobile the dedicated "Copy prompt (raw)" command opens this picker in raw mode.
 */
export class PromptQuickPicker extends FuzzySuggestModal<Prompt> {
	constructor(
		app: App,
		private readonly plugin: PromptboxPlugin,
		private readonly rawMode: boolean,
	) {
		super(app);
		this.setPlaceholder(rawMode ? "Copy prompt raw..." : "Copy prompt...");
		this.setInstructions(
			rawMode
				? [{ command: "↵", purpose: "copy raw" }]
				: [
						{ command: "↵", purpose: "copy with variables" },
						{ command: "⌘/Ctrl ↵", purpose: "copy raw" },
					],
		);
	}

	override getItems(): Prompt[] {
		return this.plugin.index.getAll();
	}

	override getItemText(prompt: Prompt): string {
		return `${prompt.title} ${prompt.category} ${prompt.tags.join(" ")} ${prompt.useCase}`;
	}

	override getSuggestions(query: string): FuzzyMatch<Prompt>[] {
		return rankFavoritesFirst(
			super.getSuggestions(query),
			(m) => m.match.score,
			(m) => m.item.favorite,
		);
	}

	override renderSuggestion(match: FuzzyMatch<Prompt>, el: HTMLElement): void {
		super.renderSuggestion(match, el);
		if (match.item.favorite) {
			const star = createSpan({ cls: "promptbox-picker__favorite" });
			setIcon(star, "star");
			el.prepend(star);
		}
	}

	override onChooseItem(prompt: Prompt, evt: MouseEvent | KeyboardEvent): void {
		const body = this.plugin.index.getBody(prompt.path);
		if (this.rawMode || evt.metaKey || evt.ctrlKey) {
			copyRaw(prompt.title, body);
		} else {
			copyWithVariables(this.app, prompt.title, body, prompt.path);
		}
	}
}
