import type { Prompt } from "./prompt";

export type CardMenuActionKey =
	| "copy-with-variables"
	| "copy-raw"
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

/** Ordered card context-menu entries mirroring the header icon actions, text-labeled (issue #33). */
export function buildCardMenuEntries(prompt: Prompt): CardMenuEntry[] {
	return [
		{ label: "Copy with variables", actionKey: "copy-with-variables", warning: false, separatorBefore: false },
		{ label: "Copy raw", actionKey: "copy-raw", warning: false, separatorBefore: false },
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
