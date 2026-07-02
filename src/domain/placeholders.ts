export interface PromptVariable {
	name: string;
	defaultValue: string;
	hint: string;
}

// Innermost {{...}} with no braces inside; nested or unclosed constructs never match (FR-4.6).
const PLACEHOLDER_RE = /\{\{([^{}]*)\}\}/g;

function parseSegments(content: string): PromptVariable | null {
	const segments = content.split("|");
	if (segments.length > 3) return null;
	const name = (segments[0] ?? "").trim();
	if (name === "") return null;
	return { name, defaultValue: segments[1] ?? "", hint: segments[2] ?? "" };
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
