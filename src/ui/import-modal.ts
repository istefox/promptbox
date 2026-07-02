import { Modal, Notice, Setting, TFile, type App } from "obsidian";
import { validateImport, type ImportPolicy } from "../domain/transfer";
import type PromptboxPlugin from "../main";
import { runImport } from "../storage/transfer-io";
import { JsonFileSuggest } from "./suggest";

/** Import prompts from a versioned JSON export (FR-7.3). */
export class ImportModal extends Modal {
	private sourcePath = "";
	private pasted = "";
	private policy: ImportPolicy = "skip";
	private errorsEl!: HTMLElement;

	constructor(
		app: App,
		private readonly plugin: PromptboxPlugin,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		this.setTitle("Import prompts (JSON)");

		new Setting(contentEl)
			.setName("From vault file")
			.setDesc("Pick a .json export inside this vault...")
			.addText((t) => {
				t.setPlaceholder("promptbox-export-....json");
				new JsonFileSuggest(this.app, t.inputEl);
				t.onChange((v) => (this.sourcePath = v.trim()));
			});

		new Setting(contentEl)
			.setName("...or paste JSON")
			.setDesc("Pasted content wins over the file when both are set.")
			.addTextArea((t) => {
				t.inputEl.rows = 6;
				t.onChange((v) => (this.pasted = v));
			});

		new Setting(contentEl)
			.setName("On conflicts")
			.setDesc("One policy for the whole import: same relative path already present.")
			.addDropdown((d) => {
				d.addOption("skip", "Skip existing");
				d.addOption("overwrite", "Overwrite existing");
				d.addOption("duplicate", "Duplicate with suffix");
				d.setValue(this.policy).onChange((v) => (this.policy = v as ImportPolicy));
			});

		this.errorsEl = contentEl.createDiv({ cls: "promptbox-import__errors" });

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Import")
					.setCta()
					.onClick(() => void this.submit()),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	private async readSource(): Promise<string | null> {
		if (this.pasted.trim() !== "") return this.pasted;
		if (this.sourcePath === "") return null;
		const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return null;
		return this.app.vault.cachedRead(file);
	}

	private showErrors(errors: string[]): void {
		this.errorsEl.empty();
		this.errorsEl.createEl("strong", { text: "Nothing was imported:" });
		const list = this.errorsEl.createEl("ul");
		for (const error of errors.slice(0, 10)) list.createEl("li", { text: error });
		if (errors.length > 10) list.createEl("li", { text: `... and ${errors.length - 10} more` });
	}

	private async submit(): Promise<void> {
		const text = await this.readSource();
		if (text === null) {
			this.showErrors(["select a vault .json file or paste JSON content"]);
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			this.showErrors([`invalid JSON: ${error instanceof Error ? error.message : String(error)}`]);
			return;
		}
		const result = validateImport(parsed);
		if (!result.ok) {
			this.showErrors(result.errors);
			return;
		}
		const summary = await runImport(this.app, this.plugin.settings.promptsFolder, result.doc, this.policy);
		this.close();
		new Notice(
			`Import done: ${summary.created} created, ${summary.skipped} skipped, ${summary.overwritten} overwritten, ${summary.failed} failed.`,
		);
		if (summary.failed > 0) console.warn("Promptbox import failures:", summary.errors);
	}
}
