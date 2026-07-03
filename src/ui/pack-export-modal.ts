import { Modal, Setting, type App } from "obsidian";
import type { PackHeader } from "../domain/transfer";

/** Collects a pack name (required) and description (optional) before export (FR-20.1, FR-20.2). */
export class PackExportModal extends Modal {
	private name = "";
	private description = "";
	private errorEl!: HTMLElement;

	constructor(
		app: App,
		private readonly promptCount: number,
		private readonly onSubmit: (pack: PackHeader) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		this.setTitle("Export as pack");
		contentEl.createEl("p", { text: `Exporting ${this.promptCount} prompt(s).` });

		new Setting(contentEl)
			.setName("Name")
			.setDesc("Required.")
			.addText((t) => t.onChange((v) => (this.name = v)));

		new Setting(contentEl)
			.setName("Description")
			.setDesc("Optional.")
			.addTextArea((t) => {
				t.inputEl.rows = 3;
				t.onChange((v) => (this.description = v));
			});

		this.errorEl = contentEl.createDiv({ cls: "promptbox-pack-export__error" });

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Export")
					.setCta()
					.onClick(() => this.submit()),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	private submit(): void {
		const name = this.name.trim();
		if (name === "") {
			this.errorEl.setText("Name is required.");
			return;
		}
		this.close();
		this.onSubmit({ name, description: this.description });
	}
}
