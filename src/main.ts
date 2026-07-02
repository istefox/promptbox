import { Notice, Plugin } from "obsidian";

export default class PromptboxPlugin extends Plugin {
	override onload(): void {
		this.addCommand({
			id: "placeholder",
			name: "Coming soon",
			callback: () => {
				new Notice("Promptbox: coming soon.");
			},
		});
	}
}
