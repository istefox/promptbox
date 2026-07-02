import { PluginSettingTab, Setting, type App } from "obsidian";
import type PromptboxPlugin from "../main";
import { FolderSuggest } from "./suggest";

/** Plugin settings tab (FR-8). */
export class PromptboxSettingTab extends PluginSettingTab {
	private folderDebounce: number | undefined;

	constructor(
		app: App,
		private readonly plugin: PromptboxPlugin,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Prompts folder")
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

		new Setting(containerEl)
			.setName("Default type for new prompts")
			.addDropdown((d) => {
				for (const v of this.plugin.settings.typeValues) d.addOption(v, v);
				d.setValue(this.plugin.settings.defaultType).onChange((v) => {
					this.plugin.settings.defaultType = v;
					void this.plugin.saveSettings();
				});
			});

		this.renderTaxonomyEditor("Type values", "typeValues");
		this.renderTaxonomyEditor("Category values", "categoryValues");

		new Setting(containerEl)
			.setName("Hotkeys")
			.setDesc("Promptbox commands ship without default key bindings. Assign them under Settings → Hotkeys.");
	}

	/** FR-8.2: add, rename, remove, reorder. Removing a value in use never modifies notes. */
	private renderTaxonomyEditor(title: string, key: "typeValues" | "categoryValues"): void {
		const { containerEl } = this;
		new Setting(containerEl)
			.setName(title)
			.setDesc("Values feed the modal dropdowns and view filters. Removing a value in use never modifies existing notes.")
			.setHeading();

		const values = this.plugin.settings[key];
		values.forEach((value, i) => {
			const row = new Setting(containerEl);
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
}
