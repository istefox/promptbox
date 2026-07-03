import { Modal, Notice, setIcon, setTooltip, Setting, type App, type TFile } from "obsidian";
import { bumpVersion, type PromptDraft } from "../domain/draft";
import { VISIBILITIES, type Prompt, type Visibility } from "../domain/prompt";
import { relatedPrompts } from "../domain/related";
import type { PromptboxSettings } from "../settings";
import { createPrompt, updatePrompt } from "../storage/prompt-writer";
import { TagSuggest } from "./suggest";

export type PromptModalMode = { kind: "create" } | { kind: "edit"; file: TFile; prompt: Prompt };

export interface PromptModalDeps {
	settings: PromptboxSettings;
	folder: string;
	/** Tag pool for suggestions: prompt-library tags first, vault-wide after (backlog 8). */
	tagPool: string[];
	/** Full snapshot of the index, used to compute the Related section (ADR-0012). */
	allPrompts: Prompt[];
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
	private titleInput: HTMLInputElement | null = null;
	/** Which taxonomy field is showing its inline "new value" row (backlog 13). */
	private addingValueFor: "type" | "category" | null = null;

	constructor(
		app: App,
		private readonly deps: PromptModalDeps,
		private readonly mode: PromptModalMode,
		private readonly onSaved?: (file: TFile) => void,
	) {
		super(app);
		this.draft = draftFrom(mode, deps.settings);
		this.related = mode.kind === "edit" ? relatedPrompts(mode.prompt, deps.allPrompts, 5) : [];
	}

	override onOpen(): void {
		this.modalEl.addClass("promptbox-modal--wide");
		this.display();
	}

	/** Rebuilds the form; all state lives in the draft, so re-rendering is loss-free. */
	private display(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		this.setTitle(this.mode.kind === "create" ? "New prompt" : "Edit prompt metadata");

		const titleRow = this.fieldRow("heading", "Title").setDesc("Required. The file name derives from it.");
		titleRow.addText((t) => {
			this.titleInput = t.inputEl;
			t.setValue(this.draft.title).onChange((v) => {
				this.draft.title = v;
				this.titleInput?.removeClass("promptbox-invalid");
			});
		});

		this.taxonomyRow("shapes", "Type", "type", this.deps.settings.typeValues, false);
		this.taxonomyRow("folder", "Category", "category", this.deps.settings.categoryValues, true);

		// Tags: chips inside a visible container + input with suggestions (FR-3.4)
		const tagsRow = this.fieldRow("tags", "Tags");
		const box = tagsRow.controlEl.createDiv({ cls: "promptbox-tags-box" });
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
				t.setValue(this.draft.useCase).onChange((v) => (this.draft.useCase = v));
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

		if (this.mode.kind === "create") {
			const bodyRow = this.fieldRow("file-text", "Initial body");
			bodyRow.setClass("promptbox-setting--stacked");
			bodyRow.addTextArea((t) => {
				t.setPlaceholder("Prompt text. Placeholders: {{name}}, {{name|default}}, {{name|a,b,c|hint}}.");
				t.inputEl.rows = 10;
				t.setValue(this.draft.body).onChange((v) => (this.draft.body = v));
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

	/** Taxonomy dropdown with an inline "New value..." entry persisting to settings (backlog 13). */
	private taxonomyRow(
		icon: string,
		label: string,
		key: "type" | "category",
		configured: string[],
		optional: boolean,
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
				const file = await createPrompt(this.app, this.deps.folder, this.draft);
				new Notice(`Prompt created: ${file.basename}`);
				this.onSaved?.(file);
			} else {
				await updatePrompt(this.app, this.mode.file, this.draft);
				new Notice("Prompt metadata saved.");
				this.onSaved?.(this.mode.file);
			}
			this.close();
		} catch (error) {
			new Notice(`Promptbox: save failed — ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
