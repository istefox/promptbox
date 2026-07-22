import { Modal, Notice, Setting, TFile, type App } from "obsidian";
import { validateImport, type ExportDoc, type ImportPolicy } from "../domain/transfer";
import type PromptboxPlugin from "../main";
import { buildOverwritePreview, runImport } from "../storage/transfer-io";
import { ImportPreviewModal } from "./import-preview-modal";
import { JsonFileSuggest } from "./suggest";

const PACK_PREVIEW_DEBOUNCE_MS = 180;

/** Import prompts from a versioned JSON export (FR-7.3). */
export class ImportModal extends Modal {
	private sourcePath = "";
	private pasted = "";
	private policy: ImportPolicy = "skip";
	private errorsEl!: HTMLElement;
	private packInfoEl!: HTMLElement;
	private previewDebounce: number | undefined;

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
				t.onChange((v) => {
					this.sourcePath = v.trim();
					void this.refreshPreview();
				});
			});

		new Setting(contentEl)
			.setName("...or paste JSON")
			.setDesc("Pasted content wins over the file when both are set.")
			.addTextArea((t) => {
				t.inputEl.rows = 6;
				t.onChange((v) => {
					this.pasted = v;
					window.clearTimeout(this.previewDebounce);
					this.previewDebounce = window.setTimeout(() => void this.refreshPreview(), PACK_PREVIEW_DEBOUNCE_MS);
				});
			});

		this.packInfoEl = contentEl.createDiv({ cls: "promptbox-import__pack-info" });

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

	/** Live pack summary/warning above the policy controls (FR-21.1, FR-21.2); silent on parse failure. */
	private async refreshPreview(): Promise<void> {
		try {
			const text = await this.readSource();
			this.packInfoEl.empty();
			if (text === null) return;
			const result = validateImport(JSON.parse(text));
			if (result.ok && result.doc.pack) {
				const { name, description } = result.doc.pack;
				this.packInfoEl.createEl("strong", { text: `${name} — ${result.doc.prompts.length} prompt(s)` });
				if (description !== "") this.packInfoEl.createEl("p", { text: description });
			} else if (result.ok && result.warnings.length > 0) {
				this.packInfoEl.createEl("p", {
					text: result.warnings[0],
					cls: "promptbox-import__pack-warning",
				});
			}
		} catch {
			this.packInfoEl.empty();
		}
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
		const folder = this.plugin.settings.promptsFolder;
		if (this.policy === "overwrite") {
			const diffs = await buildOverwritePreview(
				this.app,
				folder,
				result.doc,
				this.plugin.settings.typeKey,
				this.plugin.settings.defaultType,
			);
			if (diffs.length > 0) {
				new ImportPreviewModal(this.app, diffs, () => void this.runAndReport(folder, result.doc, this.policy)).open();
				return;
			}
		}
		await this.runAndReport(folder, result.doc, this.policy);
	}

	private async runAndReport(folder: string, doc: ExportDoc, policy: ImportPolicy): Promise<void> {
		const summary = await runImport(this.app, folder, doc, policy);
		this.close();
		new Notice(
			`Import done: ${summary.created} created, ${summary.skipped} skipped, ${summary.overwritten} overwritten, ${summary.failed} failed.`,
		);
		if (summary.failed > 0) console.warn("Promptbox import failures:", summary.errors);
	}
}
