import { Notice, type App } from "obsidian";
import { parsePlaceholders, resolvePlaceholders } from "../domain/placeholders";
import { VariableModal } from "./variable-modal";

/** Clipboard write with an explicit, mobile-safe failure path (NFR-3). */
export async function writeClipboard(text: string, label: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		new Notice(`Copied: ${label}`);
	} catch {
		new Notice(
			"Promptbox: clipboard write failed. Open the note and copy manually (some mobile webviews restrict clipboard access).",
		);
	}
}

/**
 * The FR-4 copy flow: prompts without placeholders copy immediately (FR-4.4),
 * otherwise the variable form collects values and the resolved body is copied
 * on confirm; cancel copies nothing (FR-4.2, FR-4.3).
 */
export function copyWithVariables(app: App, title: string, body: string): void {
	const variables = parsePlaceholders(body);
	if (variables.length === 0) {
		void writeClipboard(body, title);
		return;
	}
	new VariableModal(app, variables, (values) => {
		void writeClipboard(resolvePlaceholders(body, values), title);
	}).open();
}

/** Verbatim copy, placeholders untouched — escape hatch for other templating systems (FR-4.5). */
export function copyRaw(title: string, body: string): void {
	void writeClipboard(body, `${title} (raw)`);
}
