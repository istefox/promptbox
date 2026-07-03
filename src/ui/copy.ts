import { Notice, type App } from "obsidian";
import { parsePlaceholders } from "../domain/placeholders";
import { assembleBody, detectWikilinks } from "../domain/transclusion";
import { resolveWikilinks, TransclusionPreviewModal } from "./transclusion-modal";
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
 * The FR-4/FR-12 copy flow: wikilinks resolve first (FR-12.1), with a preview
 * step when at least one resolves (FR-12.5); then placeholders on the
 * ORIGINAL body only (FR-12.6) — prompts without placeholders copy
 * immediately (FR-4.4), otherwise the variable form collects values and the
 * assembled body is copied on confirm; cancel copies nothing (FR-4.2, FR-4.3).
 * A body with zero wikilinks gets zero new UI (FR-12.5).
 */
export function copyWithVariables(app: App, title: string, body: string, sourcePath: string): void {
	async function run(): Promise<void> {
		const links = detectWikilinks(body);
		const { resolved, unresolved } = await resolveWikilinks(app, sourcePath, links);

		const finish = (): void => {
			const variables = parsePlaceholders(body);
			const afterCopy = (): void => {
				if (unresolved.length > 0) {
					new Notice(`Promptbox: unresolved link(s): ${unresolved.join(", ")}`);
				}
			};
			if (variables.length === 0) {
				void writeClipboard(assembleBody(body, resolved, {}), title).then(afterCopy);
				return;
			}
			new VariableModal(app, variables, (values) => {
				void writeClipboard(assembleBody(body, resolved, values), title).then(afterCopy);
			}).open();
		};

		if (resolved.size > 0) {
			const occurrences = new Map<string, number>();
			for (const link of links) occurrences.set(link.target, (occurrences.get(link.target) ?? 0) + 1);
			const rows = [...resolved.entries()].map(([target, content]) => ({
				target,
				occurrences: occurrences.get(target) ?? 1,
				size: content.length,
			}));
			const totalSize = rows.reduce((sum, row) => sum + row.size * row.occurrences, 0);
			new TransclusionPreviewModal(app, rows, totalSize, finish).open();
		} else {
			finish();
		}
	}

	void run();
}

/** Verbatim copy, placeholders untouched — escape hatch for other templating systems (FR-4.5). */
export function copyRaw(title: string, body: string): void {
	void writeClipboard(body, `${title} (raw)`);
}
