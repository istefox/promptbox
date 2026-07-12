import { Notice, type App } from "obsidian";
import { stripWrappingCodeFence } from "../domain/code-fence";
import { isContextVariable, parsePlaceholders } from "../domain/placeholders";
import { assembleBody, detectWikilinks } from "../domain/transclusion";
import { resolveContextVariables } from "./context-variables";
import { resolveWikilinks, TransclusionPreviewModal } from "./transclusion-modal";
import { VariableModal, type VariableModalDeps } from "./variable-modal";

/** Clipboard write with an explicit, mobile-safe failure path (NFR-3). Resolves true only on a real copy. */
export async function writeClipboard(text: string, label: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		new Notice(`Copied: ${label}`);
		return true;
	} catch {
		new Notice(
			"Promptbox: clipboard write failed. Open the note and copy manually (some mobile webviews restrict clipboard access).",
		);
		return false;
	}
}

/**
 * The FR-4/FR-10/FR-12 copy flow: wikilinks resolve first (FR-12.1), with a
 * preview step when at least one resolves (FR-12.5); then placeholders on the
 * ORIGINAL body only (FR-12.6). Reserved `@`-prefixed names resolve from
 * workspace state and never reach the modal (FR-10); remaining variables go
 * through the variable form, and the assembled body is copied on confirm;
 * cancel copies nothing (FR-4.2, FR-4.3). A body with zero wikilinks gets
 * zero new UI, and one whose placeholders are all context variables copies
 * without a modal once resolution settles (FR-4.4). `onCopied` (FR-23.1) runs
 * only after the clipboard write actually succeeds, never on cancel or failure.
 */
export function copyWithVariables(
	app: App,
	title: string,
	body: string,
	sourcePath: string,
	deps: VariableModalDeps,
	onCopied?: () => void,
): void {
	body = stripWrappingCodeFence(body);

	async function run(): Promise<void> {
		const links = detectWikilinks(body);
		const { resolved, unresolved } = await resolveWikilinks(app, sourcePath, links);

		const finish = (): void => {
			const variables = parsePlaceholders(body);
			const contextVars = variables.filter((v) => isContextVariable(v.name));
			const userVars = variables.filter((v) => !isContextVariable(v.name));
			const afterCopy = (copied: boolean): void => {
				if (unresolved.length > 0) {
					new Notice(`Promptbox: unresolved link(s): ${unresolved.join(", ")}`);
				}
				if (copied) onCopied?.();
			};
			void resolveContextVariables(
				app,
				contextVars.map((v) => v.name),
			).then((contextValues) => {
				if (userVars.length === 0) {
					void writeClipboard(assembleBody(body, resolved, contextValues), title).then(afterCopy);
					return;
				}
				new VariableModal(app, userVars, deps, (userValues) => {
					void writeClipboard(assembleBody(body, resolved, { ...contextValues, ...userValues }), title).then(
						afterCopy,
					);
				}).open();
			});
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

/** Verbatim copy, placeholders untouched — escape hatch for other templating systems (FR-4.5). `onCopied` (FR-23.1) runs only on a real copy. */
export function copyRaw(title: string, body: string, onCopied?: () => void): void {
	void writeClipboard(stripWrappingCodeFence(body), `${title} (raw)`).then((copied) => {
		if (copied) onCopied?.();
	});
}
