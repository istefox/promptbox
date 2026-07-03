import { Modal, setIcon, type App } from "obsidian";
import type { PromptLintResult } from "../domain/lint";
import { openNote } from "./open-note";

/** Read-only lint report (FR-16.1); scoped to one prompt when opened from a card badge (FR-16.2). */
export class LintModal extends Modal {
	constructor(
		app: App,
		private readonly results: PromptLintResult[],
		private readonly options: { scopedToPath?: string } = {},
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-lint");
		this.setTitle("Lint library");

		const scoped = this.options.scopedToPath
			? this.results.filter((r) => r.path === this.options.scopedToPath)
			: this.results;
		const withFindings = scoped.filter((r) => r.findings.length > 0);

		if (withFindings.length === 0) {
			contentEl.createEl("p", { text: "No issues found." });
			return;
		}

		const warningCount = withFindings.reduce(
			(n, r) => n + r.findings.filter((f) => f.severity === "warning").length,
			0,
		);
		const infoCount = withFindings.reduce(
			(n, r) => n + r.findings.filter((f) => f.severity === "info").length,
			0,
		);
		contentEl.createEl("p", {
			text: `${warningCount} warning(s), ${infoCount} info finding(s) across ${withFindings.length} prompt(s).`,
			cls: "promptbox-lint__summary",
		});

		for (const result of withFindings) {
			const section = contentEl.createDiv({ cls: "promptbox-lint__section" });
			const header = section.createDiv({ cls: "promptbox-lint__section-header" });
			header.createSpan({ text: result.title, cls: "promptbox-lint__section-title" });
			const openBtn = header.createEl("button", { cls: "clickable-icon", text: "" });
			setIcon(openBtn, "file-text");
			openBtn.setAttribute("aria-label", "Open as note");
			openBtn.addEventListener("click", () => void openNote(this.app, result.path));

			const list = section.createEl("ul", { cls: "promptbox-lint__findings" });
			for (const finding of result.findings) {
				list.createEl("li", {
					text: `[${finding.ruleId}] ${finding.severity}: ${finding.message}`,
					cls: `promptbox-lint__finding promptbox-lint__finding--${finding.severity}`,
				});
			}
		}
	}
}
