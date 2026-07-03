import type { Prompt } from "./prompt";

export interface LauncherParams {
	path?: string;
	title?: string;
}

export type LauncherLookupResult =
	| { kind: "picker" }
	| { kind: "match"; prompt: Prompt }
	| { kind: "no-match"; source: "path" | "title"; value: string };

/**
 * Pure lookup behind the `obsidian://promptbox` URI action (FR-13.2, FR-13.4, FR-13.5).
 * `path` outranks `title`: when both are present, `title` is never consulted, even as a
 * fallback (ADR-0008). Title matching is case-insensitive and trimmed; ties on `updated`
 * break by `path` ascending.
 */
export function resolveLauncherLookup(prompts: Prompt[], params: LauncherParams): LauncherLookupResult {
	const path = params.path?.trim() ?? "";
	const title = params.title?.trim() ?? "";

	if (path !== "") {
		const match = prompts.find((p) => p.path === path);
		return match ? { kind: "match", prompt: match } : { kind: "no-match", source: "path", value: path };
	}

	if (title !== "") {
		const needle = title.toLowerCase();
		const matches = prompts.filter((p) => p.title.trim().toLowerCase() === needle);
		if (matches.length === 0) return { kind: "no-match", source: "title", value: title };
		const winner = matches.reduce((best, candidate) =>
			candidate.updated.localeCompare(best.updated) > 0 ||
			(candidate.updated === best.updated && candidate.path.localeCompare(best.path) < 0)
				? candidate
				: best,
		);
		return { kind: "match", prompt: winner };
	}

	return { kind: "picker" };
}
