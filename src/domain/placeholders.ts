export interface PromptVariable {
	name: string;
	defaultValue: string;
	hint: string;
	/** Present when the default segment lists 2+ comma-separated values: rendered as a dropdown. */
	options?: string[];
}

// Innermost {{...}} with no braces inside; nested or unclosed constructs never match (FR-4.6).
const PLACEHOLDER_RE = /\{\{([^{}]*)\}\}/g;

function parseSegments(content: string): PromptVariable | null {
	const segments = content.split("|");
	if (segments.length > 3) return null;
	const name = (segments[0] ?? "").trim();
	if (name === "") return null;
	const defaultRaw = segments[1] ?? "";
	const hint = segments[2] ?? "";
	// Choice list: 2+ comma-separated non-empty values become dropdown options,
	// first one preselected. A single default therefore cannot contain a literal
	// comma (documented trade-off in spec.md FR-4.1).
	const parts = defaultRaw.split(",").map((p) => p.trim());
	if (parts.length >= 2 && parts.every((p) => p !== "")) {
		return { name, defaultValue: parts[0]!, hint, options: parts };
	}
	return { name, defaultValue: defaultRaw, hint };
}

/**
 * Collects unique variables in order of first appearance (FR-4.2).
 * Pipe syntax: {{name}}, {{name|default}}, {{name|default|hint}}, empty default
 * allowed ({{name||hint}}). On conflicting defaults/hints the first occurrence
 * wins. Malformed constructs (empty name, >3 segments, unclosed or nested
 * braces) are skipped and stay verbatim in the output (FR-4.1, FR-4.6).
 */
export function parsePlaceholders(body: string): PromptVariable[] {
	const seen = new Map<string, PromptVariable>();
	for (const match of body.matchAll(PLACEHOLDER_RE)) {
		const variable = parseSegments(match[1] ?? "");
		if (variable && !seen.has(variable.name)) seen.set(variable.name, variable);
	}
	return [...seen.values()];
}

/**
 * Replaces every well-formed occurrence of each provided variable, everywhere
 * it appears (FR-4.2). Malformed constructs and unknown names stay as-is.
 */
export function resolvePlaceholders(body: string, values: Record<string, string>): string {
	return body.replace(PLACEHOLDER_RE, (whole, content: string) => {
		const variable = parseSegments(content);
		if (!variable) return whole;
		return Object.prototype.hasOwnProperty.call(values, variable.name) ? values[variable.name]! : whole;
	});
}

export interface PlaceholderMatch {
	raw: string;
	start: number;
	end: number;
	variable: PromptVariable | null;
}

/**
 * Positions alongside `parsePlaceholders`' parse result, for span-based
 * composition with other body syntaxes (e.g. wikilink transclusion, FR-12.6).
 */
export function matchPlaceholders(body: string): PlaceholderMatch[] {
	const matches: PlaceholderMatch[] = [];
	for (const match of body.matchAll(PLACEHOLDER_RE)) {
		const start = match.index ?? 0;
		matches.push({
			raw: match[0],
			start,
			end: start + match[0].length,
			variable: parseSegments(match[1] ?? ""),
		});
	}
	return matches;
}
