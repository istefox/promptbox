import { Modal, Notice, Setting, type App } from "obsidian";
import type { PromptVariable } from "../domain/placeholders";
import { applyProfile, matchingProfiles, type VariableProfile } from "../domain/variable-profiles";

export interface VariableModalDeps {
	profiles: VariableProfile[];
	saveProfile: (name: string, values: Record<string, string>) => Promise<void>;
}

/** One field per unique variable; Cancel copies nothing (FR-4.2, FR-4.3). */
export class VariableModal extends Modal {
	private readonly values: Record<string, string> = {};
	/** Currently selected profile name, "" for "No profile" (FR-14.2). */
	private selectedProfile = "";
	/** Whether the inline "Save as profile…" name row is showing (FR-14.3). */
	private savingProfile = false;

	constructor(
		app: App,
		private readonly variables: PromptVariable[],
		private readonly deps: VariableModalDeps,
		private readonly onSubmit: (values: Record<string, string>) => void,
	) {
		super(app);
		for (const v of variables) this.values[v.name] = v.defaultValue;
	}

	override onOpen(): void {
		this.contentEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			}
		});
		this.display();
	}

	/** Rebuilds the form; all state lives in `this.values`, so re-rendering is loss-free. */
	private display(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		this.setTitle("Fill prompt variables");

		const variableNames = this.variables.map((v) => v.name);
		const matches = matchingProfiles(this.deps.profiles, variableNames);
		if (matches.length > 0) {
			new Setting(contentEl).setName("Profile").addDropdown((d) => {
				d.addOption("", "No profile");
				for (const profile of matches) d.addOption(profile.name, profile.name);
				d.setValue(this.selectedProfile).onChange((v) => {
					this.selectedProfile = v;
					if (v !== "") {
						const profile = matches.find((p) => p.name === v);
						if (profile) Object.assign(this.values, applyProfile(profile.values, this.values, variableNames));
					}
					this.display();
				});
			});
		}

		for (const variable of this.variables) {
			const row = new Setting(contentEl).setName(variable.name);
			if (variable.hint !== "") row.setDesc(variable.hint.trim());
			if (variable.options) {
				row.addDropdown((d) => {
					for (const option of variable.options!) d.addOption(option, option);
					d.setValue(this.values[variable.name]!).onChange((v) => (this.values[variable.name] = v));
				});
			} else {
				row.addText((t) => {
					t.setValue(this.values[variable.name]!).onChange((v) => (this.values[variable.name] = v));
				});
			}
		}

		if (this.savingProfile) {
			let pending = this.selectedProfile;
			new Setting(contentEl)
				.setClass("promptbox-inline-add")
				.addText((t) => {
					t.setPlaceholder("Profile name...");
					t.setValue(pending);
					t.onChange((v) => (pending = v));
					window.setTimeout(() => t.inputEl.focus(), 0);
				})
				.addButton((b) =>
					b
						.setButtonText("Save")
						.setCta()
						.onClick(() => {
							const name = pending.trim();
							if (name === "") return;
							void this.deps.saveProfile(name, { ...this.values });
							new Notice(`Profile "${name}" saved.`);
							this.savingProfile = false;
							this.display();
						}),
				)
				.addButton((b) =>
					b.setButtonText("Cancel").onClick(() => {
						this.savingProfile = false;
						this.display();
					}),
				);
		}

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Copy")
					.setCta()
					.onClick(() => this.submit()),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b.setButtonText("Save as profile…").onClick(() => {
					this.savingProfile = true;
					this.display();
				}),
			);
	}

	private submit(): void {
		this.close();
		this.onSubmit({ ...this.values });
	}
}
