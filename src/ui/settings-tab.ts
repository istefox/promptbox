import { Notice, PluginSettingTab, setIcon, Setting, type App } from "obsidian";
import { isReservedTypeKeyCollision, isValidTypeKeyFormat } from "../domain/prompt";
import { findProfileIndex } from "../domain/variable-profiles";
import type PromptboxPlugin from "../main";
import { ConfirmModal } from "./confirm-modal";
import { FolderSuggest } from "./suggest";

/** Plugin settings tab (FR-8). */
export class PromptboxSettingTab extends PluginSettingTab {
	private folderDebounce: number | undefined;
	private typeKeyDebounce: number | undefined;

	constructor(
		app: App,
		private readonly plugin: PromptboxPlugin,
	) {
		super(app, plugin);
	}

	private iconRow(icon: string, name: string): Setting {
		const row = new Setting(this.containerEl).setName(name);
		const iconEl = createSpan({ cls: "promptbox-field-icon" });
		setIcon(iconEl, icon);
		row.nameEl.prepend(iconEl);
		return row;
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.iconRow("folder", "Prompts folder")
			.setDesc("Vault folder holding prompt notes, subfolders included. Changing it re-indexes immediately.")
			.addText((t) => {
				t.setValue(this.plugin.settings.promptsFolder);
				new FolderSuggest(this.app, t.inputEl);
				t.onChange((value) => {
					window.clearTimeout(this.folderDebounce);
					this.folderDebounce = window.setTimeout(() => {
						this.plugin.setPromptsFolder(value.trim().replace(/\/+$/, ""));
					}, 500);
				});
			});

		this.iconRow("shapes", "Default type for new prompts").addDropdown((d) => {
				for (const v of this.plugin.settings.typeValues) d.addOption(v, v);
				d.setValue(this.plugin.settings.defaultType).onChange((v) => {
					this.plugin.settings.defaultType = v;
					void this.plugin.saveSettings();
				});
			});

		this.iconRow("key-round", "Type frontmatter key")
			.setDesc(
				"Frontmatter key Promptbox uses for a prompt's type. Change it to avoid a clash with another " +
					"vault-wide taxonomy using the same key. Existing notes keep their old key; a lint warning flags them.",
			)
			.addText((t) => {
				t.setValue(this.plugin.settings.typeKey);
				t.onChange((value) => {
					window.clearTimeout(this.typeKeyDebounce);
					this.typeKeyDebounce = window.setTimeout(() => {
						const trimmed = value.trim();
						if (trimmed === "" || trimmed === this.plugin.settings.typeKey) return;
						if (!isValidTypeKeyFormat(trimmed)) {
							new Notice(`Promptbox: "${trimmed}" is not a valid frontmatter key.`);
							return;
						}
						if (isReservedTypeKeyCollision(trimmed)) {
							new Notice(`Promptbox: "${trimmed}" is already used by another Promptbox field.`);
							return;
						}
						this.plugin.setTypeKey(trimmed);
					}, 500);
				});
			});

		this.renderTaxonomyEditor("list", "Type values", "typeValues", true);
		this.renderTaxonomyEditor("list-tree", "Category values", "categoryValues", false);

		this.renderProfilesEditor();

		this.iconRow("keyboard", "Hotkeys")
			.setDesc("Promptbox commands ship without default key bindings. Assign them under Settings → Hotkeys.");
	}

	/** FR-8.2: add, rename, remove, reorder. Removing a value in use never modifies notes. */
	private renderTaxonomyEditor(icon: string, title: string, key: "typeValues" | "categoryValues", withDesc: boolean): void {
		const { containerEl } = this;
		const heading = this.iconRow(icon, title).setHeading();
		if (withDesc) heading.setDesc("Values feed the modal dropdowns and view filters. Removing a value in use never modifies existing notes. Same rules apply to categories below.");

		const values = this.plugin.settings[key];
		values.forEach((value, i) => {
			const row = new Setting(containerEl);
			row.setClass("promptbox-taxo-row");
			row.addText((t) => {
				t.setValue(value).onChange((v) => {
					const trimmed = v.trim();
					if (trimmed !== "") {
						values[i] = trimmed;
						void this.plugin.saveSettings();
					}
				});
			});
			row.addExtraButton((b) =>
				b
					.setIcon("arrow-up")
					.setTooltip("Move up")
					.setDisabled(i === 0)
					.onClick(() => {
						[values[i - 1], values[i]] = [values[i]!, values[i - 1]!];
						void this.plugin.saveSettings();
						this.display();
					}),
			);
			row.addExtraButton((b) =>
				b
					.setIcon("arrow-down")
					.setTooltip("Move down")
					.setDisabled(i === values.length - 1)
					.onClick(() => {
						[values[i], values[i + 1]] = [values[i + 1]!, values[i]!];
						void this.plugin.saveSettings();
						this.display();
					}),
			);
			row.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip("Remove")
					.onClick(() => {
						values.splice(i, 1);
						void this.plugin.saveSettings();
						this.display();
					}),
			);
		});

		let pending = "";
		new Setting(containerEl)
			.setClass("promptbox-taxo-row")
			.addText((t) => {
				t.setPlaceholder(`Add ${key === "typeValues" ? "type" : "category"}...`);
				t.onChange((v) => (pending = v));
			})
			.addButton((b) =>
				b.setButtonText("Add").onClick(() => {
					const trimmed = pending.trim();
					if (trimmed === "" || values.includes(trimmed)) return;
					values.push(trimmed);
					void this.plugin.saveSettings();
					this.display();
				}),
			);
	}

	/** FR-14.4: rename/delete saved variable profiles, following the taxonomy-editor pattern. */
	private renderProfilesEditor(): void {
		const { containerEl } = this;
		this.iconRow("user", "Variable profiles").setHeading();

		const profiles = this.plugin.settings.profiles;
		if (profiles.length === 0) {
			containerEl.createEl("p", { text: "No saved profiles yet. Save one from the variable modal." });
			return;
		}

		profiles.forEach((profile, i) => {
			const row = new Setting(containerEl);
			row.setClass("promptbox-taxo-row");
			row.addText((t) => {
				t.setValue(profile.name).onChange((v) => {
					const trimmed = v.trim();
					if (trimmed === "") return;
					const existing = findProfileIndex(profiles, trimmed);
					if (existing !== -1 && existing !== i) {
						new Notice(`A profile named "${trimmed}" already exists.`);
						return;
					}
					profiles[i]!.name = trimmed;
					void this.plugin.saveSettings();
				});
			});
			row.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip("Delete")
					.onClick(() => {
						new ConfirmModal(
							this.app,
							"Delete profile",
							`Delete the profile "${profile.name}"? This cannot be undone.`,
							"Delete",
							() => {
								profiles.splice(i, 1);
								void this.plugin.saveSettings();
								this.display();
							},
						).open();
					}),
			);
		});
	}
}
