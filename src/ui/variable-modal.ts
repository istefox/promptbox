import { Modal, Setting, type App } from "obsidian";
import type { PromptVariable } from "../domain/placeholders";

/** One field per unique variable; Cancel copies nothing (FR-4.2, FR-4.3). */
export class VariableModal extends Modal {
	private readonly values: Record<string, string> = {};

	constructor(
		app: App,
		private readonly variables: PromptVariable[],
		private readonly onSubmit: (values: Record<string, string>) => void,
	) {
		super(app);
		for (const v of variables) this.values[v.name] = v.defaultValue;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		this.setTitle("Fill prompt variables");

		for (const variable of this.variables) {
			const row = new Setting(contentEl).setName(variable.name);
			if (variable.hint !== "") row.setDesc(variable.hint.trim());
			if (variable.options) {
				row.addDropdown((d) => {
					for (const option of variable.options!) d.addOption(option, option);
					d.setValue(variable.defaultValue).onChange((v) => (this.values[variable.name] = v));
				});
			} else {
				row.addText((t) => {
					t.setValue(variable.defaultValue).onChange((v) => (this.values[variable.name] = v));
				});
			}
		}

		contentEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			}
		});

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Copy")
					.setCta()
					.onClick(() => this.submit()),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	private submit(): void {
		this.close();
		this.onSubmit({ ...this.values });
	}
}
