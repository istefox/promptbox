import { Modal, Notice, Setting, type App, type TFile } from "obsidian";
import { bumpVersion, type PromptDraft } from "../domain/draft";
import { VISIBILITIES, type Prompt, type Visibility } from "../domain/prompt";
import type { PromptboxSettings } from "../settings";
import { createPrompt, updatePrompt } from "../storage/prompt-writer";
import { collectVaultTags, TagSuggest } from "./suggest";

export type PromptModalMode = { kind: "create" } | { kind: "edit"; file: TFile; prompt: Prompt };

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

/** Create / edit metadata modal (FR-3.1, FR-3.2). Body editing stays in the editor (FR-3.3). */
export class PromptModal extends Modal {
	private readonly draft: PromptDraft;
	private titleInput: HTMLInputElement | null = null;

	constructor(
		app: App,
		private readonly settings: PromptboxSettings,
		private readonly folder: string,
		private readonly mode: PromptModalMode,
		private readonly onSaved?: (file: TFile) => void,
	) {
		super(app);
		this.draft = draftFrom(mode, settings);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		this.setTitle(this.mode.kind === "create" ? "New prompt" : "Edit prompt metadata");

		new Setting(contentEl).setName("Title").addText((t) => {
			this.titleInput = t.inputEl;
			t.setValue(this.draft.title).onChange((v) => {
				this.draft.title = v;
				this.titleInput?.removeClass("promptbox-invalid");
			});
		});

		new Setting(contentEl).setName("Type").addDropdown((d) => {
			for (const v of dropdownValues(this.settings.typeValues, this.draft.type)) d.addOption(v, v);
			d.setValue(this.draft.type).onChange((v) => (this.draft.type = v));
		});

		new Setting(contentEl).setName("Category").addDropdown((d) => {
			d.addOption("", "(none)");
			for (const v of dropdownValues(this.settings.categoryValues, this.draft.category)) d.addOption(v, v);
			d.setValue(this.draft.category).onChange((v) => (this.draft.category = v));
		});

		// Tags: chips + input with vault-wide suggestions (FR-3.4)
		const tagsSetting = new Setting(contentEl).setName("Tags");
		const chipsEl = tagsSetting.controlEl.createDiv({ cls: "promptbox-modal__chips" });
		const renderChips = () => {
			chipsEl.empty();
			for (const tag of this.draft.tags) {
				const chip = chipsEl.createSpan({ text: tag, cls: "promptbox-chip is-active" });
				const remove = chip.createSpan({ text: "×", cls: "promptbox-chip__remove" });
				remove.addEventListener("click", () => {
					this.draft.tags = this.draft.tags.filter((t) => t !== tag);
					renderChips();
				});
			}
		};
		renderChips();
		const vaultTags = collectVaultTags(this.app);
		tagsSetting.addText((t) => {
			t.setPlaceholder("Add tag, press Enter");
			new TagSuggest(this.app, t.inputEl, () => vaultTags.filter((v) => !this.draft.tags.includes(v)));
			const commit = () => {
				const value = t.inputEl.value.trim().replace(/^#/, "");
				if (value !== "" && !this.draft.tags.includes(value)) {
					this.draft.tags.push(value);
					renderChips();
				}
				t.setValue("");
			};
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === ",") {
					e.preventDefault();
					commit();
				}
			});
			t.inputEl.addEventListener("blur", commit);
		});

		new Setting(contentEl).setName("Quality").addDropdown((d) => {
			d.addOption("", "(unset)");
			for (let n = 1; n <= 5; n++) d.addOption(String(n), "★".repeat(n));
			d.setValue(this.draft.quality === undefined ? "" : String(this.draft.quality)).onChange(
				(v) => (this.draft.quality = v === "" ? undefined : Number(v)),
			);
		});

		new Setting(contentEl).setName("Use case").addText((t) => {
			t.setValue(this.draft.useCase).onChange((v) => (this.draft.useCase = v));
		});

		new Setting(contentEl).setName("Visibility").addDropdown((d) => {
			for (const v of VISIBILITIES) d.addOption(v, v);
			d.setValue(this.draft.visibility).onChange((v) => (this.draft.visibility = v as Visibility));
		});

		const versionSetting = new Setting(contentEl).setName("Version");
		versionSetting.addText((t) => {
			t.setValue(this.draft.version).onChange((v) => (this.draft.version = v));
			if (this.mode.kind === "edit") {
				versionSetting.addButton((b) =>
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
			new Setting(contentEl).setName("Initial body").addTextArea((t) => {
				t.setPlaceholder("Prompt text (editable later as a normal note)");
				t.inputEl.rows = 6;
				t.onChange((v) => (this.draft.body = v));
			});
		}

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText(this.mode.kind === "create" ? "Create" : "Save")
					.setCta()
					.onClick(() => void this.submit()),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	private async submit(): Promise<void> {
		if (this.draft.title.trim() === "") {
			this.titleInput?.addClass("promptbox-invalid");
			new Notice("Title is required.");
			return;
		}
		try {
			if (this.mode.kind === "create") {
				const file = await createPrompt(this.app, this.folder, this.draft);
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
