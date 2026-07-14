import type { Prompt } from "./prompt";

export type CardMenuActionKey =
	| "copy-with-variables"
	| "copy-raw"
	| "open-chain"
	| "edit-metadata"
	| "open-as-note"
	| "toggle-favorite"
	| "delete";

export interface CardMenuEntry {
	label: string;
	actionKey: CardMenuActionKey;
	warning: boolean;
	separatorBefore: boolean;
}

/**
 * Ordered card context-menu entries mirroring the header icon actions, text-labeled (issue #33).
 * For a chain prompt (`prompt.chain !== undefined`, ADR-0018), the two copy entries are replaced
 * by a single "Run chain"/"Edit chain" entry, matching the header icon exactly; `canRunChain` is
 * the same runnability condition the header icon uses (>=2 resolvable steps), computed by the
 * caller since it needs the current index's known-path set.
 */
export function buildCardMenuEntries(prompt: Prompt, canRunChain = false): CardMenuEntry[] {
	const leadingEntries: CardMenuEntry[] =
		prompt.chain !== undefined
			? [
					{
						label: canRunChain ? "Run chain" : "Edit chain",
						actionKey: "open-chain",
						warning: false,
						separatorBefore: false,
					},
				]
			: [
					{ label: "Copy with variables", actionKey: "copy-with-variables", warning: false, separatorBefore: false },
					{ label: "Copy raw", actionKey: "copy-raw", warning: false, separatorBefore: false },
				];

	return [
		...leadingEntries,
		{ label: "Edit metadata", actionKey: "edit-metadata", warning: false, separatorBefore: false },
		{ label: "Open as note", actionKey: "open-as-note", warning: false, separatorBefore: false },
		{
			label: prompt.favorite ? "Remove from favorites" : "Add to favorites",
			actionKey: "toggle-favorite",
			warning: false,
			separatorBefore: false,
		},
		{ label: "Delete", actionKey: "delete", warning: true, separatorBefore: true },
	];
}
