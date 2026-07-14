import { Modal, Notice, Setting, type App } from "obsidian";
import { buildStepValues, partitionStepVariables, type StepVariablePartition } from "../domain/chains";
import type { Prompt } from "../domain/prompt";
import { assembleBody, detectWikilinks } from "../domain/transclusion";
import { applyProfile, matchingProfiles, type VariableProfile } from "../domain/variable-profiles";
import { resolveContextVariables } from "./context-variables";
import { writeClipboard } from "./copy";

export interface ChainWizardDeps {
	allPrompts: Prompt[];
	getBody: (path: string) => string;
	profiles: VariableProfile[];
}

const EMPTY_PARTITION: StepVariablePartition = { contextNames: [], usesPrevious: false, userVariables: [] };

/**
 * The chain execution wizard (ADR-0018, SPEC §3): an optional profile
 * picker, then one screen per step with a Copy button and Back/Next
 * (Finish on the last step). Session-scoped — closing early discards all
 * state, reopening always restarts at step 1.
 */
export class ChainWizardModal extends Modal {
	private index = 0;
	private profileValues: Record<string, string> | undefined;
	private matches: VariableProfile[] = [];

	private currentBody = "";
	private currentPartition: StepVariablePartition = EMPTY_PARTITION;
	private currentContextValues: Record<string, string> = {};
	private currentClipboardValue = "";
	private readonly collectedValues = new Map<number, Record<string, string>>();
	/** Context/clipboard values resolved once per step index; Back/re-entry reuses them instead
	 *  of re-reading the (live, mutable) system clipboard, which would silently show a later
	 *  step's `{{@previous}}` answer when navigating back. */
	private readonly resolvedStepData = new Map<
		number,
		{ contextValues: Record<string, string>; clipboardValue: string }
	>();
	private compiledEl: HTMLTextAreaElement | null = null;

	constructor(
		app: App,
		private readonly deps: ChainWizardDeps,
		private readonly chainTitle: string,
		private readonly steps: string[],
	) {
		super(app);
	}

	override onOpen(): void {
		this.matches = matchingProfiles(this.deps.profiles, this.collectAllVariableNames());
		if (this.matches.length > 0) {
			this.renderProfilePicker();
		} else {
			void this.enterStep(0);
		}
	}

	private collectAllVariableNames(): string[] {
		const names = new Set<string>();
		for (const path of this.steps) {
			const prompt = this.deps.allPrompts.find((p) => p.path === path);
			if (!prompt) continue;
			for (const variable of partitionStepVariables(this.deps.getBody(path)).userVariables) {
				names.add(variable.name);
			}
		}
		return [...names];
	}

	private renderProfilePicker(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		this.setTitle(this.chainTitle);
		contentEl.createDiv({
			text: "Choose a variable profile to apply across the whole chain, or skip.",
			cls: "promptbox-related__heading",
		});

		let selected = "";
		new Setting(contentEl).setName("Profile").addDropdown((d) => {
			d.addOption("", "No profile");
			for (const profile of this.matches) d.addOption(profile.name, profile.name);
			d.setValue(selected).onChange((v) => (selected = v));
		});

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Continue")
					.setCta()
					.onClick(() => {
						this.profileValues = this.matches.find((p) => p.name === selected)?.values;
						void this.enterStep(0);
					}),
			)
			.addButton((b) =>
				b.setButtonText("Skip").onClick(() => {
					this.profileValues = undefined;
					void this.enterStep(0);
				}),
			);
	}

	/** Loads the step at `index` (resolving context vars and, when needed, the clipboard) then renders it. */
	private async enterStep(index: number): Promise<void> {
		this.index = index;
		const path = this.steps[index];
		if (path === undefined) return;
		const prompt = this.deps.allPrompts.find((p) => p.path === path);
		if (!prompt) {
			this.renderOrphanStep(path);
			return;
		}

		const body = this.deps.getBody(path);
		const partition = partitionStepVariables(body);
		this.currentBody = body;
		this.currentPartition = partition;

		let resolved = this.resolvedStepData.get(index);
		if (!resolved) {
			this.renderLoading();
			const contextValues = await resolveContextVariables(this.app, partition.contextNames);
			const clipboardValue = partition.usesPrevious ? await this.readClipboardSafe() : "";
			resolved = { contextValues, clipboardValue };
			this.resolvedStepData.set(index, resolved);
			// Vault transclusion (ADR-0007) is not resolved inside chain steps in this release;
			// surface that explicitly rather than silently copying raw wikilink syntax.
			if (detectWikilinks(body).length > 0) {
				new Notice(
					`Promptbox: step "${prompt.title}" contains vault links that are not resolved inside chains — copied as-is.`,
				);
			}
		}
		this.currentContextValues = resolved.contextValues;
		this.currentClipboardValue = resolved.clipboardValue;
		this.renderStep(prompt);
	}

	private async readClipboardSafe(): Promise<string> {
		try {
			return await navigator.clipboard.readText();
		} catch {
			new Notice("Promptbox: could not read the previous step's output from the clipboard.");
			return "";
		}
	}

	private renderLoading(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		this.setTitle(this.chainTitle);
		this.renderProgressHeader(contentEl);
		contentEl.createDiv({ text: "Loading step...", cls: "promptbox-chain-wizard__loading" });
	}

	private renderProgressHeader(contentEl: HTMLElement): void {
		contentEl.createDiv({
			text: `Step ${this.index + 1} of ${this.steps.length}`,
			cls: "promptbox-chain-wizard__progress",
		});
	}

	private renderOrphanStep(path: string): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		this.setTitle(this.chainTitle);
		this.renderProgressHeader(contentEl);
		contentEl.createDiv({
			text: `This step no longer resolves to a prompt: "${path}".`,
			cls: "promptbox-chain-wizard__error",
		});
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Skip this step").onClick(() => void this.advance()))
			.addButton((b) =>
				b
					.setButtonText("Cancel chain")
					.setWarning()
					.onClick(() => this.close()),
			);
	}

	private async advance(): Promise<void> {
		if (this.index >= this.steps.length - 1) {
			this.close();
			return;
		}
		await this.enterStep(this.index + 1);
	}

	/** Values collected so far for `index`, seeded once from defaults and the chosen profile. */
	private stepValues(index: number, partition: StepVariablePartition): Record<string, string> {
		let values = this.collectedValues.get(index);
		if (!values) {
			values = {};
			for (const variable of partition.userVariables) values[variable.name] = variable.defaultValue;
			if (this.profileValues) {
				Object.assign(
					values,
					applyProfile(
						this.profileValues,
						values,
						partition.userVariables.map((v) => v.name),
					),
				);
			}
			this.collectedValues.set(index, values);
		}
		return values;
	}

	private renderStep(prompt: Prompt): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		this.setTitle(this.chainTitle);
		this.renderProgressHeader(contentEl);
		contentEl.createDiv({ text: prompt.title, cls: "promptbox-related__heading" });

		const values = this.stepValues(this.index, this.currentPartition);

		for (const variable of this.currentPartition.userVariables) {
			const row = new Setting(contentEl).setName(variable.name);
			if (variable.hint !== "") row.setDesc(variable.hint.trim());
			if (variable.options) {
				row.addDropdown((d) => {
					for (const option of variable.options!) d.addOption(option, option);
					d.setValue(values[variable.name] ?? "").onChange((v) => {
						values[variable.name] = v;
						this.refreshCompiledText();
					});
				});
			} else {
				row.addText((t) => {
					t.setValue(values[variable.name] ?? "").onChange((v) => {
						values[variable.name] = v;
						this.refreshCompiledText();
					});
				});
			}
		}

		if (this.currentPartition.usesPrevious) {
			// SPEC §3: @previous is a display-only alias for @clipboard, so the field is
			// read-only and labeled "Previous step output" rather than "Clipboard".
			new Setting(contentEl)
				.setName("Previous step output")
				.setDesc("Read from the clipboard when this step opened.")
				.addTextArea((t) => {
					t.setValue(this.currentClipboardValue);
					t.setDisabled(true);
				});
		}

		const compiledEl = contentEl.createEl("textarea", { cls: "promptbox-chain-wizard__compiled" });
		compiledEl.readOnly = true;
		compiledEl.rows = 10;
		this.compiledEl = compiledEl;
		this.refreshCompiledText();

		const isLast = this.index === this.steps.length - 1;
		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Copy")
					.setCta()
					.onClick(() => {
						if (this.compiledEl) void writeClipboard(this.compiledEl.value, prompt.title);
					}),
			)
			.addButton((b) =>
				b
					.setButtonText("Back")
					.setDisabled(this.index === 0)
					.onClick(() => void this.enterStep(this.index - 1)),
			)
			.addButton((b) =>
				b.setButtonText(isLast ? "Finish" : "Next").onClick(() => {
					if (isLast) this.close();
					else void this.enterStep(this.index + 1);
				}),
			);
	}

	private refreshCompiledText(): void {
		if (!this.compiledEl) return;
		const values = this.stepValues(this.index, this.currentPartition);
		const merged = buildStepValues(
			this.currentContextValues,
			this.currentClipboardValue,
			this.currentPartition.usesPrevious,
			values,
		);
		this.compiledEl.value = assembleBody(this.currentBody, new Map(), merged);
	}
}
