import { MarkdownView, Notice, type App } from "obsidian";
import { todayISO } from "../storage/frontmatter";

/** Resolved value, or `undefined` for "unresolved" (triggers a Notice in the caller). */
type Resolver = (app: App) => Promise<string | undefined> | string | undefined;

// One entry per supported name (FR-10.2). An unrecognized `@name` has no entry
// here, so it is never resolved and never notified about (FR-10.1).
const RESOLVERS: Record<string, Resolver> = {
	"@date": () => todayISO(),
	"@title": (app) => app.workspace.getActiveFile()?.basename,
	"@selection": (app) => {
		const selection = app.workspace.getActiveViewOfType(MarkdownView)?.editor?.getSelection();
		return selection === "" ? undefined : selection;
	},
	"@clipboard": async () => {
		try {
			return await navigator.clipboard.readText();
		} catch {
			return undefined;
		}
	},
};

/**
 * Resolves the given reserved names from workspace and browser state (FR-10.2).
 * Every known-but-unresolved name yields an empty string plus exactly one Notice
 * naming it. `@selection` and `@clipboard` are deliberately asymmetric: no editor
 * or an empty selection is unresolved, but a successfully-read empty clipboard is
 * a resolved empty value, not a notice case.
 */
export async function resolveContextVariables(app: App, names: string[]): Promise<Record<string, string>> {
	const values: Record<string, string> = {};
	for (const name of names) {
		const resolver = RESOLVERS[name];
		if (!resolver) continue;
		const resolved = await resolver(app);
		if (resolved === undefined) {
			new Notice(`Promptbox: could not resolve ${name}`);
			values[name] = "";
		} else {
			values[name] = resolved;
		}
	}
	return values;
}
