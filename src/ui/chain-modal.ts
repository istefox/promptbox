import { FuzzySuggestModal, Modal, Notice, Setting, type App, type TFile } from "obsidian";
import { isSaveableChain, MIN_CHAIN_STEPS } from "../domain/chains";
import type { Prompt } from "../domain/prompt";
import type { PromptboxSettings } from "../settings";
import { stripFrontmatter, todayISO } from "../storage/frontmatter";
import { createPrompt } from "../storage/prompt-writer";

export type ChainModalMode = { kind: "create" } | { kind: "edit"; file: TFile; prompt: Prompt };

export interface ChainModalDeps {
	settings: PromptboxSettings;
	folder: string;
	/** Snapshot of the index, used for the step picker and to resolve step titles. */
	allPrompts: Prompt[];
	/** Reads a resolved step's body, used by "Convert to single prompt". */
	getBody: (path: string) => string;
	openFile?: (file: TFile) => void;
}

/** Step picker (same interaction as placeholder-palette.ts): a plain fuzzy match over prompt titles. */
class ChainStepPickerModal extends FuzzySuggestModal<Prompt> {
	constructor(
		app: App,
		private readonly candidates: Prompt[],
		private readonly onChoose: (prompt: Prompt) => void,
	) {
		super(app);
		this.setPlaceholder("Add step...");
	}

	override getItems(): Prompt[] {
		return this.candidates;
	}

	override getItemText(prompt: Prompt): string {
		return prompt.title;
	}

	override onChooseItem(prompt: Prompt): void {
		this.onChoose(prompt);
	}
}

/**
 * Create/edit modal for a chain note (ADR-0018): ordered step list with
 * reorder/remove, a 2-step-minimum save guard, and "Convert to single
 * prompt" at exactly one remaining step.
 */
export class ChainModal extends Modal {
	private title: string;
	private steps: string[];
	private titleInput: HTMLInputElement | null = null;

	constructor(
		app: App,
		private readonly deps: ChainModalDeps,
		private readonly mode: ChainModalMode,
		private readonly onSaved?: (file: TFile) => void,
	) {
		super(app);
		this.title = mode.kind === "edit" ? mode.prompt.title : "";
		this.steps = mode.kind === "edit" ? [...(mode.prompt.chain ?? [])] : [];
	}

	override onOpen(): void {
		this.display();
	}

	private display(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		this.setTitle(this.mode.kind === "create" ? "New chain" : "Edit chain");

		new Setting(contentEl).setName("Title").addText((t) => {
			this.titleInput = t.inputEl;
			t.setValue(this.title).onChange((v) => {
				this.title = v;
				this.titleInput?.removeClass("promptbox-invalid");
			});
		});

		const stepsSection = contentEl.createDiv({ cls: "promptbox-chain-steps" });
		stepsSection.createDiv({ text: "Steps", cls: "promptbox-related__heading" });
		if (this.steps.length === 0) {
			stepsSection.createDiv({ text: "No steps yet.", cls: "promptbox-tags-box__empty" });
		}
		this.steps.forEach((path, index) => {
			const prompt = this.deps.allPrompts.find((p) => p.path === path);
			const row = new Setting(stepsSection).setName(`${index + 1}. ${prompt?.title ?? path}`);
			if (!prompt) row.setDesc("Unresolved step (deleted or moved).");
			row.addExtraButton((b) =>
				b
					.setIcon("arrow-up")
					.setTooltip("Move up")
					.setDisabled(index === 0)
					.onClick(() => this.moveStep(index, index - 1)),
			);
			row.addExtraButton((b) =>
				b
					.setIcon("arrow-down")
					.setTooltip("Move down")
					.setDisabled(index === this.steps.length - 1)
					.onClick(() => this.moveStep(index, index + 1)),
			);
			row.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip("Remove")
					.onClick(() => {
						this.steps.splice(index, 1);
						this.display();
					}),
			);
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Add step").onClick(() => {
				new ChainStepPickerModal(this.app, this.deps.allPrompts, (prompt) => {
					this.steps.push(prompt.path);
					this.display();
				}).open();
			}),
		);

		if (!isSaveableChain(this.steps)) {
			contentEl.createDiv({
				text: "A chain needs at least 2 steps",
				cls: "promptbox-chain-steps__error",
			});
		}

		const footer = new Setting(contentEl);
		footer.addButton((b) =>
			b
				.setButtonText(this.mode.kind === "create" ? "Create" : "Save")
				.setCta()
				.setDisabled(!isSaveableChain(this.steps))
				.onClick(() => void this.submit()),
		);
		if (this.mode.kind === "edit" && this.steps.length === 1) {
			footer.addButton((b) =>
				b.setButtonText("Convert to single prompt").onClick(() => void this.convertToSinglePrompt()),
			);
		}
		footer.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	private moveStep(from: number, to: number): void {
		const [step] = this.steps.splice(from, 1);
		if (step === undefined) return;
		this.steps.splice(to, 0, step);
		this.display();
	}

	private async submit(): Promise<void> {
		if (this.title.trim() === "") {
			this.titleInput?.addClass("promptbox-invalid");
			new Notice("Title is required.");
			return;
		}
		if (!isSaveableChain(this.steps)) {
			new Notice(`A chain needs at least ${MIN_CHAIN_STEPS} steps.`);
			return;
		}
		try {
			if (this.mode.kind === "create") {
				const file = await createPrompt(this.app, this.deps.folder, {
					title: this.title,
					type: this.deps.settings.defaultType,
					category: "",
					tags: [],
					quality: undefined,
					useCase: "",
					visibility: "private",
					version: "1.0",
					body: "",
				});
				await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					fm["chain"] = [...this.steps];
				});
				new Notice(`Chain created: ${file.basename}`);
				this.onSaved?.(file);
			} else {
				const file = this.mode.file;
				await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					fm["title"] = this.title.trim();
					fm["chain"] = [...this.steps];
					fm["updated"] = todayISO();
				});
				new Notice("Chain saved.");
				this.onSaved?.(file);
			}
			this.close();
		} catch (error) {
			new Notice(`Promptbox: save failed — ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/** SPEC §2: the only way a chain note stops being a chain, and it never happens automatically. */
	private async convertToSinglePrompt(): Promise<void> {
		if (this.mode.kind !== "edit" || this.steps.length !== 1) return;
		const remaining = this.steps[0]!;
		const body = this.deps.getBody(remaining);
		const file = this.mode.file;
		try {
			// Strip chain / stamp updated through the official API first, preserving every
			// other frontmatter field (title, type, category, tags, ...); only then splice the
			// new body in after the (now-updated) frontmatter block, never touching it directly.
			await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				delete fm["chain"];
				fm["updated"] = todayISO();
			});
			const raw = await this.app.vault.read(file);
			const currentBody = stripFrontmatter(raw);
			const frontmatterBlock = raw.slice(0, raw.length - currentBody.length);
			await this.app.vault.modify(file, frontmatterBlock + body);
			new Notice("Converted to a single prompt.");
			this.onSaved?.(file);
			this.close();
		} catch (error) {
			new Notice(`Promptbox: conversion failed — ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
