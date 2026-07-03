import { Modal, Setting, type App } from "obsidian";
import type { ImportDiff, ImportFieldChange } from "../domain/transfer";

function formatFieldValue(value: ImportFieldChange["from"]): string {
	if (Array.isArray(value)) return value.join(", ");
	if (value === undefined) return "none";
	return String(value);
}

/** Overwrite-conflict preview (FR-17.1, FR-17.2): gates the destructive import branch. */
export class ImportPreviewModal extends Modal {
	constructor(
		app: App,
		private readonly diffs: ImportDiff[],
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		contentEl.addClass("promptbox-modal--wide");
		this.setTitle("Review overwrite changes");

		const list = contentEl.createDiv({ cls: "promptbox-diff-preview" });
		for (const diff of this.diffs) {
			const item = list.createDiv({ cls: "promptbox-diff-preview__item" });
			item.createEl("h4", { text: diff.targetPath });
			if (diff.identical) {
				item.createDiv({ cls: "promptbox-diff-preview__identical", text: "identical" });
				continue;
			}
			for (const change of diff.fieldChanges) {
				item.createDiv({
					cls: "promptbox-diff-preview__field",
					text: `${change.field}: ${formatFieldValue(change.from)} → ${formatFieldValue(change.to)}`,
				});
			}
			const bodyText = diff.body.changed ? `changed (+${diff.body.added}/-${diff.body.removed})` : "unchanged";
			item.createDiv({ cls: "promptbox-diff-preview__body", text: `body: ${bodyText}` });
		}

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Confirm import")
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}
}
