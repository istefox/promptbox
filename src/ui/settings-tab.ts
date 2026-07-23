import {
	Notice,
	PluginSettingTab,
	requireApiVersion,
	setIcon,
	Setting,
	type App,
	type SettingDefinitionItem,
} from "obsidian";
import { isReservedTypeKeyCollision, isValidTypeKeyFormat } from "../domain/prompt";
import { findProfileIndex } from "../domain/variable-profiles";
import type PromptboxPlugin from "../main";
import { ConfirmModal } from "./confirm-modal";
import { FolderSuggest } from "./suggest";

const PROMPTS_FOLDER_DESC =
	"Vault folder holding prompt notes, subfolders included. Changing it re-indexes immediately.";
const TYPE_KEY_DESC =
	"Frontmatter key Promptbox uses for a prompt's type. Change it to avoid a clash with another " +
	"vault-wide taxonomy using the same key. Existing notes keep their old key; a lint warning flags them.";
const TAXONOMY_DESC =
	"Values feed the modal dropdowns and view filters. Removing a value in use never modifies existing notes. " +
	"Same rules apply to categories below.";
const HOTKEYS_DESC = "Promptbox commands ship without default key bindings. Assign them under Settings → Hotkeys.";

/**
 * Plugin settings tab (FR-8). `getSettingDefinitions()` (Obsidian 1.13.0+) makes every field
 * searchable from Settings search; `display()` stays as the documented fallback for older hosts,
 * where `getSettingDefinitions` is never called. Each field's control-building logic lives in one
 * private method shared by both paths, so the two never drift apart. References to 1.13.0+ APIs
 * (`update`, `SettingGroup.addSetting`) are gated with `requireApiVersion` — the only guard shape
 * `obsidianmd/no-unsupported-api` recognizes, verified against the real rule (a `typeof` check is
 * NOT recognized and fails the community review even though it's runtime-safe).
 */
export class PromptboxSettingTab extends PluginSettingTab {
	private folderDebounce: number | undefined;
	private typeKeyDebounce: number | undefined;

	constructor(
		app: App,
		private readonly plugin: PromptboxPlugin,
	) {
		super(app, plugin);
	}

	private prependIcon(row: Setting, icon: string): void {
		const iconEl = createSpan({ cls: "promptbox-field-icon" });
		setIcon(iconEl, icon);
		row.nameEl.prepend(iconEl);
	}

	private iconRow(icon: string, name: string): Setting {
		const row = new Setting(this.containerEl).setName(name);
		this.prependIcon(row, icon);
		return row;
	}

	/** Rebuilds the visible settings UI: `update()` on 1.13.0+ hosts (declarative renderer),
	 * `display()` on older hosts where `update` doesn't exist. */
	private refresh(): void {
		if (requireApiVersion("1.13.0")) this.update();
		else this.display();
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.buildPromptsFolderControl(this.iconRow("folder", "Prompts folder").setDesc(PROMPTS_FOLDER_DESC));
		this.buildDefaultTypeControl(this.iconRow("shapes", "Default type for new prompts"));
		this.buildTypeKeyControl(this.iconRow("key-round", "Type frontmatter key").setDesc(TYPE_KEY_DESC));

		this.iconRow("list", "Type values").setHeading().setDesc(TAXONOMY_DESC);
		this.renderTaxonomyEditor((cb) => cb(new Setting(containerEl)), "typeValues");

		this.iconRow("list-tree", "Category values").setHeading();
		this.renderTaxonomyEditor((cb) => cb(new Setting(containerEl)), "categoryValues");

		const profilesHeading = this.iconRow("user", "Variable profiles").setHeading();
		this.renderProfilesEditor(profilesHeading, (cb) => cb(new Setting(containerEl)));

		this.iconRow("keyboard", "Hotkeys").setDesc(HOTKEYS_DESC);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Prompts folder",
				desc: PROMPTS_FOLDER_DESC,
				render: (setting) => {
					this.prependIcon(setting, "folder");
					this.buildPromptsFolderControl(setting);
				},
			},
			{
				name: "Default type for new prompts",
				render: (setting) => {
					this.prependIcon(setting, "shapes");
					this.buildDefaultTypeControl(setting);
				},
			},
			{
				name: "Type frontmatter key",
				desc: TYPE_KEY_DESC,
				render: (setting) => {
					this.prependIcon(setting, "key-round");
					this.buildTypeKeyControl(setting);
				},
			},
			{
				name: "Type values",
				desc: TAXONOMY_DESC,
				render: (setting, group) => {
					this.prependIcon(setting, "list");
					setting.setHeading();
					if (requireApiVersion("1.13.0")) {
						this.renderTaxonomyEditor((cb) => group.addSetting(cb), "typeValues");
					}
				},
			},
			{
				name: "Category values",
				render: (setting, group) => {
					this.prependIcon(setting, "list-tree");
					setting.setHeading();
					if (requireApiVersion("1.13.0")) {
						this.renderTaxonomyEditor((cb) => group.addSetting(cb), "categoryValues");
					}
				},
			},
			{
				name: "Variable profiles",
				render: (setting, group) => {
					this.prependIcon(setting, "user");
					setting.setHeading();
					if (requireApiVersion("1.13.0")) {
						this.renderProfilesEditor(setting, (cb) => group.addSetting(cb));
					}
				},
			},
			{
				name: "Hotkeys",
				desc: HOTKEYS_DESC,
				render: (setting) => {
					this.prependIcon(setting, "keyboard");
				},
			},
		];
	}

	private buildPromptsFolderControl(row: Setting): void {
		row.addText((t) => {
			t.setValue(this.plugin.settings.promptsFolder);
			new FolderSuggest(this.app, t.inputEl);
			t.onChange((value) => {
				window.clearTimeout(this.folderDebounce);
				this.folderDebounce = window.setTimeout(() => {
					this.plugin.setPromptsFolder(value.trim().replace(/\/+$/, ""));
				}, 500);
			});
		});
	}

	private buildDefaultTypeControl(row: Setting): void {
		row.addDropdown((d) => {
			for (const v of this.plugin.settings.typeValues) d.addOption(v, v);
			d.setValue(this.plugin.settings.defaultType).onChange((v) => {
				this.plugin.settings.defaultType = v;
				void this.plugin.saveSettings();
			});
		});
	}

	private buildTypeKeyControl(row: Setting): void {
		row.addText((t) => {
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
	}

	/** FR-8.2: add, rename, remove, reorder. Removing a value in use never modifies notes. */
	private renderTaxonomyEditor(
		addRow: (cb: (row: Setting) => void) => void,
		key: "typeValues" | "categoryValues",
	): void {
		const values = this.plugin.settings[key];
		values.forEach((value, i) => {
			addRow((row) => {
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
							this.refresh();
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
							this.refresh();
						}),
				);
				row.addExtraButton((b) =>
					b
						.setIcon("trash-2")
						.setTooltip("Remove")
						.onClick(() => {
							values.splice(i, 1);
							void this.plugin.saveSettings();
							this.refresh();
						}),
				);
			});
		});

		let pending = "";
		addRow((row) => {
			row.setClass("promptbox-taxo-row");
			row.addText((t) => {
				t.setPlaceholder(`Add ${key === "typeValues" ? "type" : "category"}...`);
				t.onChange((v) => (pending = v));
			});
			row.addButton((b) =>
				b.setButtonText("Add").onClick(() => {
					const trimmed = pending.trim();
					if (trimmed === "" || values.includes(trimmed)) return;
					values.push(trimmed);
					void this.plugin.saveSettings();
					this.refresh();
				}),
			);
		});
	}

	/** FR-14.4: rename/delete saved variable profiles, following the taxonomy-editor pattern. */
	private renderProfilesEditor(heading: Setting, addRow: (cb: (row: Setting) => void) => void): void {
		const profiles = this.plugin.settings.profiles;
		if (profiles.length === 0) {
			heading.setDesc("No saved profiles yet. Save one from the variable modal.");
			return;
		}

		profiles.forEach((profile, i) => {
			addRow((row) => {
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
									this.refresh();
								},
							).open();
						}),
				);
			});
		});
	}
}
