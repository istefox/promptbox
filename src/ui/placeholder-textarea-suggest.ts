import { filterCatalog, matchPlaceholderTrigger, type PaletteEntry } from "../domain/placeholder-palette";
import { applyEntryToTextarea, renderPaletteEntry } from "./placeholder-ui";

interface ActiveTrigger {
	absoluteStart: number;
	absoluteEnd: number;
}

/**
 * Hand-rolled `{{` autocomplete for a plain `<textarea>` (FR-24.6): the only
 * option since `AbstractInputSuggest` cannot target one (ADR-0016). Bound to
 * one textarea for the lifetime of the create modal; `destroy()` removes
 * every listener it attached.
 */
export class PlaceholderTextareaSuggest {
	private readonly dropdownEl: HTMLElement;
	private trigger: ActiveTrigger | null = null;
	private filtered: PaletteEntry[] = [];
	private highlighted = 0;
	private readonly onInput = () => this.handleInput();
	private readonly onKeydown = (evt: KeyboardEvent) => this.handleKeydown(evt);
	private readonly onBlur = () => this.close();

	constructor(
		private readonly textarea: HTMLTextAreaElement,
		private readonly catalog: PaletteEntry[],
		private readonly onApply?: () => void,
	) {
		const host = textarea.parentElement ?? textarea;
		this.dropdownEl = host.createDiv({ cls: "promptbox-placeholder-dropdown" });
		this.dropdownEl.toggleClass("is-hidden", true);
		textarea.addEventListener("input", this.onInput);
		textarea.addEventListener("keydown", this.onKeydown);
		textarea.addEventListener("blur", this.onBlur);
	}

	private handleInput(): void {
		const value = this.textarea.value;
		const selectionStart = this.textarea.selectionStart ?? value.length;
		const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
		const nextNewline = value.indexOf("\n", selectionStart);
		const lineEnd = nextNewline === -1 ? value.length : nextNewline;
		const trigger = matchPlaceholderTrigger(
			value.slice(lineStart, selectionStart),
			value.slice(selectionStart, lineEnd),
		);
		if (!trigger) {
			this.close();
			return;
		}
		this.trigger = { absoluteStart: lineStart + trigger.start, absoluteEnd: selectionStart };
		this.filtered = filterCatalog(this.catalog, trigger.query);
		this.highlighted = 0;
		this.render();
	}

	private handleKeydown(evt: KeyboardEvent): void {
		if (this.trigger === null) return;
		if (evt.key === "Escape") {
			this.close();
			return;
		}
		if (evt.key === "ArrowDown") {
			evt.preventDefault();
			this.highlighted = Math.min(this.highlighted + 1, this.filtered.length - 1);
			this.render();
			return;
		}
		if (evt.key === "ArrowUp") {
			evt.preventDefault();
			this.highlighted = Math.max(this.highlighted - 1, 0);
			this.render();
			return;
		}
		if (evt.key === "Enter") {
			const entry = this.filtered[this.highlighted];
			if (entry) {
				evt.preventDefault();
				this.choose(entry);
			}
		}
	}

	private render(): void {
		this.dropdownEl.empty();
		if (this.trigger === null || this.filtered.length === 0) {
			this.dropdownEl.toggleClass("is-hidden", true);
			return;
		}
		this.dropdownEl.toggleClass("is-hidden", false);
		const container = this.dropdownEl.createDiv({ cls: "suggestion-container" });
		this.filtered.forEach((entry, index) => {
			const item = container.createDiv({ cls: "suggestion-item" + (index === this.highlighted ? " is-selected" : "") });
			renderPaletteEntry(entry, item);
			// pointerdown (not click), preventDefault so the textarea never blurs before the pick registers.
			item.addEventListener("pointerdown", (evt) => {
				evt.preventDefault();
				this.choose(entry);
			});
		});
	}

	private choose(entry: PaletteEntry): void {
		if (!this.trigger) return;
		applyEntryToTextarea(this.textarea, { start: this.trigger.absoluteStart, end: this.trigger.absoluteEnd }, entry);
		this.onApply?.();
		this.close();
	}

	private close(): void {
		this.trigger = null;
		this.dropdownEl.empty();
		this.dropdownEl.toggleClass("is-hidden", true);
	}

	destroy(): void {
		this.textarea.removeEventListener("input", this.onInput);
		this.textarea.removeEventListener("keydown", this.onKeydown);
		this.textarea.removeEventListener("blur", this.onBlur);
	}
}
