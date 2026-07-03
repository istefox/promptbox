import { Modal, Setting, TFile, type App } from "obsidian";
import type { Wikilink } from "../domain/transclusion";
import { stripFrontmatter } from "../storage/frontmatter";

const WARNING_THRESHOLD = 50000;

/**
 * Resolves the unique, non-sub-reference targets among `links` via the
 * official metadata cache (FR-12.1, ADR-0007). A `#heading`/`^block` target
 * is never looked up, it is reported alongside genuinely missing notes in
 * `unresolved` (out of scope §5). Content is frontmatter-stripped identically
 * to a prompt's own body (FR-12.3).
 */
export async function resolveWikilinks(
	app: App,
	sourcePath: string,
	links: Wikilink[],
): Promise<{ resolved: Map<string, string>; unresolved: string[] }> {
	const resolved = new Map<string, string>();
	const unresolved = new Set<string>();
	const targets = new Set(links.map((l) => l.target));

	for (const target of targets) {
		const link = links.find((l) => l.target === target);
		if (link?.hasSubReference) {
			unresolved.add(target);
			continue;
		}
		const file = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
		if (file instanceof TFile) {
			resolved.set(target, stripFrontmatter(await app.vault.cachedRead(file)));
		} else {
			unresolved.add(target);
		}
	}

	return { resolved, unresolved: [...unresolved] };
}

interface TransclusionRow {
	target: string;
	occurrences: number;
	size: number;
}

/** Confirm/cancel preview of resolvable links before they are inserted (FR-12.5). */
export class TransclusionPreviewModal extends Modal {
	constructor(
		app: App,
		private readonly rows: TransclusionRow[],
		private readonly totalSize: number,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("promptbox-modal");
		contentEl.addClass("promptbox-transclusion");
		this.setTitle("Preview linked content");

		const list = contentEl.createEl("ul", { cls: "promptbox-transclusion__list" });
		for (const row of this.rows) {
			list.createEl("li", {
				cls: "promptbox-transclusion__row",
				text: `${row.target} — ${row.occurrences} occurrence${row.occurrences === 1 ? "" : "s"}, ${row.size} characters each`,
			});
		}

		contentEl.createEl("p", {
			cls: "promptbox-transclusion__total",
			text: `Total inserted: ${this.totalSize} characters`,
		});

		if (this.totalSize > WARNING_THRESHOLD) {
			contentEl.createEl("p", {
				cls: "promptbox-transclusion__warning",
				text: `This will insert a large amount of text (over ${WARNING_THRESHOLD} characters).`,
			});
		}

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Continue")
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}
}
