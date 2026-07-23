import { Modal, Setting, type App } from "obsidian";
import { setDestructiveStyle } from "./button-compat";

/** Minimal confirmation dialog for destructive actions (FR-2.6 delete). */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		title: string,
		private readonly message: string,
		private readonly confirmLabel: string,
		private readonly onConfirm: () => void,
	) {
		super(app);
		this.setTitle(title);
	}

	override onOpen(): void {
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) =>
				setDestructiveStyle(b.setButtonText(this.confirmLabel)).onClick(() => {
					this.close();
					this.onConfirm();
				}),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}
}
