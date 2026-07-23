import { Modal, Notice, setIcon, setTooltip, Setting, type App, type TFile } from "obsidian";
import { bumpVersion, type PromptDraft } from "../domain/draft";
import type { PaletteEntry } from "../domain/placeholder-palette";
import { isContextVariable, parsePlaceholders } from "../domain/placeholders";
import { VISIBILITIES, type Prompt, type Visibility } from "../domain/prompt";
import { relatedPrompts } from "../domain/related";
import { suggestValues } from "../domain/suggestions";
import type { PromptboxSettings } from "../settings";
import { createPrompt, updatePrompt } from "../storage/prompt-writer";
import { PlaceholderPaletteModal } from "./placeholder-palette-modal";
import { PlaceholderTextareaSuggest } from "./placeholder-textarea-suggest";
import { applyEntryToTextarea } from "./placeholder-ui";
import { TagSuggest } from "./suggest";

export type PromptModalMode = { kind: "create" } | { kind: "edit"; file: TFile; prompt: Prompt };

export interface PromptModalDeps {
	settings: PromptboxSettings;
	folder: string;
	/** Tag pool for suggestions: prompt-library tags first, vault-wide after (backlog 8). */
	tagPool: string[];
	/** Full snapshot of the index, used to compute the Related section (ADR-0012). */
	allPrompts: Prompt[];
	/** Placeholder insertion catalog (FR-24.5/24.6), recomputed on every modal open. */
	paletteCatalog: PaletteEntry[];
	/** Current body for a given path, used to detect placeholders in edit mode (body itself is read-only here). */
	getBody: (path: string) => string;
	persistSettings: () => Promise<void>;
	openFile?: (file: TFile) => void;
}

function draftFrom(mode: PromptModalMode, settings: PromptboxSettings): PromptDraft {
	if (mode.kind === "edit") {
		const p = mode.prompt;
		return {
			title: p.title,
			type: p.type,
			category: p.category,
			tags: [...p.tags],
			quality: p.quality,
			useCase: p.useCase,
			visibility: p.visibility,
			version: p.version,
			body: "",
			excludedPlaceholders: [...p.excludedPlaceholders],
		};
	}
	return {
		title: "",
		type: settings.defaultType,
		category: "",
		tags: [],
		quality: undefined,
		useCase: "",
		visibility: "private",
		version: "1.0",
		body: "",
		excludedPlaceholders: [],
	};
}

/** Values for a taxonomy dropdown: configured list plus the current custom value, if any (FR-3.4). */
function dropdownValues(configured: string[], current: string): string[] {
	return current !== "" && !configured.includes(current) ? [...configured, current] : configured;
}

const NEW_VALUE = "__promptbox_new__";

/** Create / edit metadata modal (FR-3.1, FR-3.2). Body editing stays in the editor (FR-3.3). */
export class PromptModal extends Modal {
	private readonly draft: PromptDraft;
	/** Related prompts, computed once at open time (FR-19.2); display() only reads it. */
	private readonly related: Prompt[];
	/** Body snapshot for placeholder detection: create mode reads the live draft instead. */
	private readonly editModeBody: string;
	private titleInput: HTMLInputElement | null = null;
	/** Which taxonomy field is showing its inline "new value" row (backlog 13). */
	private addingValueFor: "type" | "category" | null = null;
	/** Captured on render so the "Insert placeholder" button can find the caret (FR-24.5). */
	private bodyTextareaEl: HTMLTextAreaElement | null = null;
	/** Inline `{{` dropdown bound to the create-mode body textarea (FR-24.6); destroyed on close. */
	private bodyTextareaSuggest: PlaceholderTextareaSuggest | null = null;

	constructor(
		app: App,
		private readonly deps: PromptModalDeps,
		private readonly mode: PromptModalMode,
		private readonly onSaved?: (file: TFile) => void,
	) {
		super(app);
		this.draft = draftFrom(mode, deps.settings);
		this.related = mode.kind === "edit" ? relatedPrompts(mode.prompt, deps.allPrompts, 5) : [];
		this.editModeBody = mode.kind === "edit" ? deps.getBody(mode.file.path) : "";
	}

	/** Non-`@` placeholder names currently in the body, live in create mode, snapshotted in edit mode. */
	private detectedPlaceholders(): string[] {
		const body = this.mode.kind === "create" ? this.draft.body : this.editModeBody;
		return parsePlaceholders(body)
			.filter((v) => !isContextVariable(v.name))
			.map((v) => v.name);
	}

	override onOpen(): void {
		this.modalEl.addClass("promptbox-modal--wide");
		this.display();
	}

	override onClose(): void {
		this.bodyTextareaSuggest?.destroy();
	}

	/** Rebuilds the form; all state lives in the draft, so re-rendering is loss-free. */
	private display(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		this.setTitle(this.mode.kind === "create" ? "New prompt" : "Edit prompt metadata");

		// Shared 150ms debounce driving both scoped suggestion refreshes (FR-11.2, ADR-0006).
		let suggestionsDebounce: number | undefined;
		const scheduleSuggestionsRefresh = () => {
			window.clearTimeout(suggestionsDebounce);
			suggestionsDebounce = window.setTimeout(() => {
				renderTagSuggestions();
				renderCategorySuggestions();
				renderExcludedSuggestions();
			}, 150);
		};

		const titleRow = this.fieldRow("heading", "Title").setDesc("Required. The file name derives from it.");
		titleRow.addText((t) => {
			this.titleInput = t.inputEl;
			t.setValue(this.draft.title).onChange((v) => {
				this.draft.title = v;
				this.titleInput?.removeClass("promptbox-invalid");
				scheduleSuggestionsRefresh();
			});
		});

		this.taxonomyRow("shapes", "Type", "type", this.deps.settings.typeValues, false);
		this.taxonomyRow(
			"folder",
			"Category",
			"category",
			this.deps.settings.categoryValues,
			true,
			() => renderCategorySuggestions(),
		);
		const categorySuggestionsEl = contentEl.createDiv({ cls: "promptbox-suggestions" });
		const renderCategorySuggestions = () => {
			const suggestions = suggestValues(
				{ title: this.draft.title, useCase: this.draft.useCase, body: this.draft.body },
				this.deps.settings.categoryValues,
				this.draft.category ? [this.draft.category] : [],
				3,
			);
			categorySuggestionsEl.empty();
			if (suggestions.length === 0) return;
			categorySuggestionsEl.createSpan({ text: "Suggested", cls: "promptbox-filters__label" });
			for (const value of suggestions) {
				const chip = categorySuggestionsEl.createSpan({ text: value, cls: "promptbox-chip" });
				chip.addEventListener("click", () => {
					this.draft.category = value;
					this.display();
				});
			}
		};
		renderCategorySuggestions();
		this.divider();

		// Tags: chips inside a visible container + input with suggestions (FR-3.4)
		const { wrapper: tagsWrapper } = this.chipFieldRow("tags", "Tags");
		const box = tagsWrapper.createDiv({ cls: "promptbox-tags-box" });
		const chipsEl = box.createDiv({ cls: "promptbox-modal__chips" });
		const renderChips = () => {
			chipsEl.empty();
			if (this.draft.tags.length === 0) {
				chipsEl.createSpan({ text: "No tags yet", cls: "promptbox-tags-box__empty" });
				return;
			}
			for (const tag of this.draft.tags) {
				const chip = chipsEl.createSpan({ text: tag, cls: "promptbox-chip is-active" });
				const remove = chip.createSpan({ text: "×", cls: "promptbox-chip__remove" });
				remove.setAttribute("aria-label", `Remove ${tag}`);
				remove.addEventListener("click", () => {
					this.draft.tags = this.draft.tags.filter((t) => t !== tag);
					renderChips();
					renderTagSuggestions();
				});
			}
		};
		renderChips();
		const input = box.createEl("input", { type: "text", placeholder: "Add tag, press Enter" });
		new TagSuggest(this.app, input, () => this.deps.tagPool.filter((v) => !this.draft.tags.includes(v)));
		const commit = () => {
			const value = input.value.trim().replace(/^#/, "");
			if (value !== "" && !this.draft.tags.includes(value)) {
				this.draft.tags.push(value);
				renderChips();
				renderTagSuggestions();
			}
			input.value = "";
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === ",") {
				e.preventDefault();
				commit();
			}
		});
		input.addEventListener("blur", commit);

		const tagSuggestionsEl = tagsWrapper.createDiv({ cls: "promptbox-suggestions" });
		const renderTagSuggestions = () => {
			const suggestions = suggestValues(
				{ title: this.draft.title, useCase: this.draft.useCase, body: this.draft.body },
				this.deps.tagPool,
				this.draft.tags,
				5,
			);
			tagSuggestionsEl.empty();
			if (suggestions.length === 0) return;
			tagSuggestionsEl.createSpan({ text: "Suggested", cls: "promptbox-filters__label" });
			for (const value of suggestions) {
				const chip = tagSuggestionsEl.createSpan({ text: value, cls: "promptbox-chip" });
				chip.addEventListener("click", () => {
					if (this.draft.tags.includes(value)) return;
					this.draft.tags.push(value);
					renderChips();
					renderTagSuggestions();
				});
			}
		};
		renderTagSuggestions();

		// Excluded placeholders: chips inside a visible container + input, plus detected-in-body suggestions.
		const { wrapper: excludedWrapper } = this.chipFieldRow(
			"eye-off",
			"Excluded placeholders",
			'Placeholders left untouched by "Copy with variables" (e.g. filled by the AI, not the user).',
		);
		const excludedBox = excludedWrapper.createDiv({ cls: "promptbox-tags-box" });
		const excludedChipsEl = excludedBox.createDiv({ cls: "promptbox-modal__chips" });
		const renderExcludedChips = () => {
			excludedChipsEl.empty();
			if (this.draft.excludedPlaceholders.length === 0) {
				excludedChipsEl.createSpan({ text: "None excluded", cls: "promptbox-tags-box__empty" });
				return;
			}
			for (const name of this.draft.excludedPlaceholders) {
				const chip = excludedChipsEl.createSpan({ text: name, cls: "promptbox-chip is-active" });
				const remove = chip.createSpan({ text: "×", cls: "promptbox-chip__remove" });
				remove.setAttribute("aria-label", `Remove ${name}`);
				remove.addEventListener("click", () => {
					this.draft.excludedPlaceholders = this.draft.excludedPlaceholders.filter((n) => n !== name);
					renderExcludedChips();
					renderExcludedSuggestions();
				});
			}
		};
		renderExcludedChips();
		const excludedInput = excludedBox.createEl("input", {
			type: "text",
			placeholder: "Add placeholder name, press Enter",
		});
		const commitExcluded = () => {
			const value = excludedInput.value.trim();
			if (value !== "" && !this.draft.excludedPlaceholders.includes(value)) {
				this.draft.excludedPlaceholders.push(value);
				renderExcludedChips();
				renderExcludedSuggestions();
			}
			excludedInput.value = "";
		};
		excludedInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === ",") {
				e.preventDefault();
				commitExcluded();
			}
		});
		excludedInput.addEventListener("blur", commitExcluded);

		const excludedSuggestionsEl = excludedWrapper.createDiv({ cls: "promptbox-suggestions" });
		const renderExcludedSuggestions = () => {
			const detected = this.detectedPlaceholders().filter((n) => !this.draft.excludedPlaceholders.includes(n));
			excludedSuggestionsEl.empty();
			if (detected.length === 0) return;
			excludedSuggestionsEl.createSpan({ text: "Detected in body", cls: "promptbox-filters__label" });
			for (const name of detected) {
				const chip = excludedSuggestionsEl.createSpan({ text: name, cls: "promptbox-chip" });
				chip.addEventListener("click", () => {
					if (this.draft.excludedPlaceholders.includes(name)) return;
					this.draft.excludedPlaceholders.push(name);
					renderExcludedChips();
					renderExcludedSuggestions();
				});
			}
		};
		renderExcludedSuggestions();
		this.divider();

		this.fieldRow("star", "Quality").addDropdown((d) => {
			d.addOption("", "(unset)");
			for (let n = 1; n <= 5; n++) d.addOption(String(n), "★".repeat(n));
			d.setValue(this.draft.quality === undefined ? "" : String(this.draft.quality)).onChange(
				(v) => (this.draft.quality = v === "" ? undefined : Number(v)),
			);
		});

		this.fieldRow("info", "Use case")
			.setDesc("One line on when to reach for this prompt.")
			.addText((t) => {
				t.setValue(this.draft.useCase).onChange((v) => {
					this.draft.useCase = v;
					scheduleSuggestionsRefresh();
				});
			});

		this.fieldRow("eye", "Visibility")
			.setDesc("Private stays local. Public is reserved for the phase 2 shared library.")
			.addDropdown((d) => {
				for (const v of VISIBILITIES) d.addOption(v, v);
				d.setValue(this.draft.visibility).onChange((v) => (this.draft.visibility = v as Visibility));
			});

		const versionRow = this.fieldRow("hash", "Version").setDesc("Manually managed.");
		versionRow.addText((t) => {
			t.setValue(this.draft.version).onChange((v) => (this.draft.version = v));
			if (this.mode.kind === "edit") {
				versionRow.addButton((b) =>
					b.setButtonText("Bump").onClick(() => {
						const bump = bumpVersion(this.draft.version);
						if (!bump.bumped) {
							new Notice("Version has no trailing number to bump.");
							return;
						}
						this.draft.version = bump.value;
						t.setValue(bump.value);
					}),
				);
			}
		});
		this.divider();

		if (this.mode.kind === "create") {
			const bodyRow = this.fieldRow("file-text", "Initial body");
			bodyRow.setClass("promptbox-setting--stacked");
			bodyRow.controlEl.addClass("promptbox-placeholder-host");
			const insertBtn = bodyRow.nameEl.createEl("button", {
				text: "Insert placeholder",
				cls: "promptbox-field-action",
			});
			insertBtn.type = "button";
			insertBtn.addEventListener("click", () => {
				const el = this.bodyTextareaEl;
				if (!el) return;
				new PlaceholderPaletteModal(this.app, this.deps.paletteCatalog, (entry) => {
					const at = el.selectionStart ?? el.value.length;
					applyEntryToTextarea(el, { start: at, end: at }, entry);
					this.draft.body = el.value;
				}).open();
			});
			bodyRow.addTextArea((t) => {
				this.bodyTextareaEl = t.inputEl;
				t.setPlaceholder("Prompt text. Placeholders: {{name}}, {{name|default}}, {{name|a,b,c|hint}}.");
				t.inputEl.rows = 10;
				t.setValue(this.draft.body).onChange((v) => {
					this.draft.body = v;
					scheduleSuggestionsRefresh();
				});
				this.bodyTextareaSuggest = new PlaceholderTextareaSuggest(t.inputEl, this.deps.paletteCatalog, () => {
					this.draft.body = t.inputEl.value;
				});
			});
		} else {
			this.fieldRow("file-text", "Body")
				.setDesc("The prompt text lives in the note and is edited with the full Obsidian editor (FR-3.3).")
				.addButton((b) =>
					b.setButtonText("Open note to edit body").onClick(() => {
						if (this.mode.kind === "edit") this.deps.openFile?.(this.mode.file);
						this.close();
					}),
				);
		}

		this.renderRelated();
		this.divider();

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText(this.mode.kind === "create" ? "Create" : "Save")
					.setCta()
					.onClick(() => void this.submit()),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	/** Setting row with a leading minimal Lucide icon (backlog 14). */
	private fieldRow(icon: string, name: string): Setting {
		const row = new Setting(this.contentEl).setName(name);
		const iconEl = createSpan({ cls: "promptbox-field-icon" });
		setIcon(iconEl, icon);
		row.nameEl.prepend(iconEl);
		return row;
	}

	/** Thin separator between logical field groups (Identity/Organization/Details/Content). */
	private divider(): void {
		this.contentEl.createDiv({ cls: "promptbox-modal__divider" });
	}

	/**
	 * Stacked row for a chip-based multi-part editor (Tags, Excluded placeholders): label and
	 * description on their own full-width line, control on the next, its children forced into a
	 * column so a chip box and a suggestions row never compete for horizontal space.
	 */
	private chipFieldRow(icon: string, name: string, desc?: string): { row: Setting; wrapper: HTMLDivElement } {
		const row = this.fieldRow(icon, name).setClass("promptbox-setting--stacked");
		if (desc !== undefined) row.setDesc(desc);
		const wrapper = row.controlEl.createDiv({ cls: "promptbox-chip-field" });
		return { row, wrapper };
	}

	/** Taxonomy dropdown with an inline "New value..." entry persisting to settings (backlog 13). */
	private taxonomyRow(
		icon: string,
		label: string,
		key: "type" | "category",
		configured: string[],
		optional: boolean,
		onSelect?: (value: string) => void,
	): void {
		const row = this.fieldRow(icon, label);
		row.addDropdown((d) => {
			if (optional) d.addOption("", "(none)");
			for (const v of dropdownValues(configured, this.draft[key])) d.addOption(v, v);
			d.addOption(NEW_VALUE, `New ${key}...`);
			d.setValue(this.draft[key]).onChange((v) => {
				if (v === NEW_VALUE) {
					this.addingValueFor = key;
					this.display();
					return;
				}
				this.draft[key] = v;
				onSelect?.(v);
			});
		});

		if (this.addingValueFor !== key) return;
		let pending = "";
		new Setting(this.contentEl)
			.setClass("promptbox-inline-add")
			.addText((t) => {
				t.setPlaceholder(`New ${key} name...`);
				t.onChange((v) => (pending = v));
				window.setTimeout(() => t.inputEl.focus(), 0);
			})
			.addButton((b) =>
				b
					.setButtonText("Add")
					.setCta()
					.onClick(() => {
						const value = pending.trim();
						if (value === "") return;
						const list = key === "type" ? this.deps.settings.typeValues : this.deps.settings.categoryValues;
						if (!list.includes(value)) {
							list.push(value);
							void this.deps.persistSettings();
						}
						this.draft[key] = value;
						this.addingValueFor = null;
						this.display();
					}),
			)
			.addButton((b) =>
				b.setButtonText("Cancel").onClick(() => {
					this.addingValueFor = null;
					this.display();
				}),
			);
	}

	/** Read-only "Related" section (FR-19.1); absent in create mode or with no matches. */
	private renderRelated(): void {
		if (this.related.length === 0) return;
		const section = this.contentEl.createDiv({ cls: "promptbox-related" });
		section.createDiv({ text: "Related", cls: "promptbox-related__heading" });
		for (const prompt of this.related) {
			const item = section.createDiv({ cls: "promptbox-related__item" });
			item.createSpan({ text: prompt.title, cls: "promptbox-related__title" });
			item.createSpan({ text: prompt.type, cls: "promptbox-pill promptbox-pill--type" });
			const action = item.createEl("button", { cls: "promptbox-related__action clickable-icon" });
			setIcon(action, "file-text");
			action.setAttribute("aria-label", "Open as note");
			setTooltip(action, "Open as note");
			action.addEventListener("click", () => {
				const file = this.app.vault.getFileByPath(prompt.path);
				if (!file) {
					new Notice("Note not found — the index may be stale.");
					return;
				}
				this.deps.openFile?.(file);
				this.close();
			});
		}
	}

	private async submit(): Promise<void> {
		if (this.draft.title.trim() === "") {
			this.titleInput?.addClass("promptbox-invalid");
			new Notice("Title is required.");
			return;
		}
		try {
			if (this.mode.kind === "create") {
				const file = await createPrompt(this.app, this.deps.folder, this.draft, this.deps.settings.typeKey);
				new Notice(`Prompt created: ${file.basename}`);
				this.onSaved?.(file);
			} else {
				await updatePrompt(this.app, this.mode.file, this.draft, this.deps.settings.typeKey);
				new Notice("Prompt metadata saved.");
				this.onSaved?.(this.mode.file);
			}
			this.close();
		} catch (error) {
			new Notice(`Promptbox: save failed — ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
