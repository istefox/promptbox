import { findConflictingVariableNames, hasMalformedPlaceholders } from "./placeholders";
import type { Prompt } from "./prompt";
import { slugify } from "./slug";

export type LintRuleId = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7";

export interface LintFinding {
	ruleId: LintRuleId;
	severity: "warning" | "info";
	message: string;
}

export interface PromptLintResult {
	path: string;
	title: string;
	findings: LintFinding[];
}

/** The six single-prompt rules (L1-L5, L7); L6 is library-wide, see findDuplicateTitleFindings. */
export function lintPrompt(prompt: Prompt, body: string): LintFinding[] {
	const findings: LintFinding[] = [];

	if (hasMalformedPlaceholders(body)) {
		findings.push({
			ruleId: "L1",
			severity: "warning",
			message: "Malformed placeholder construct (unclosed brace or empty name).",
		});
	}

	for (const name of findConflictingVariableNames(body)) {
		findings.push({
			ruleId: "L2",
			severity: "warning",
			message: `Variable "${name}" is declared with conflicting defaults, hints, or options.`,
		});
	}

	if (body.trim() === "") {
		findings.push({ ruleId: "L3", severity: "warning", message: "Empty body." });
	}

	if (prompt.useCase.trim() === "") {
		findings.push({ ruleId: "L4", severity: "info", message: "Missing use case." });
	}

	if (prompt.category.trim() === "") {
		findings.push({ ruleId: "L5", severity: "info", message: "Missing category." });
	}

	for (const warning of prompt.warnings) {
		findings.push({ ruleId: "L7", severity: "warning", message: warning });
	}

	return findings;
}

function groupBy(prompts: Prompt[], keyOf: (prompt: Prompt) => string): Map<string, Prompt[]> {
	const groups = new Map<string, Prompt[]>();
	for (const prompt of prompts) {
		const key = keyOf(prompt);
		const group = groups.get(key);
		if (group) group.push(prompt);
		else groups.set(key, [prompt]);
	}
	return groups;
}

/**
 * L6: groups the whole library by trimmed-lowercase title AND by slugify(title);
 * any group of size >=2 under either key contributes one warning finding per
 * path, naming the other colliding titles.
 */
export function findDuplicateTitleFindings(prompts: Prompt[]): Map<string, LintFinding[]> {
	const byTitle = groupBy(prompts, (p) => p.title.trim().toLowerCase());
	const bySlug = groupBy(prompts, (p) => slugify(p.title));

	const collidingTitlesByPath = new Map<string, Set<string>>();
	for (const groups of [byTitle, bySlug]) {
		for (const group of groups.values()) {
			if (group.length < 2) continue;
			for (const prompt of group) {
				let others = collidingTitlesByPath.get(prompt.path);
				if (!others) {
					others = new Set<string>();
					collidingTitlesByPath.set(prompt.path, others);
				}
				for (const other of group) {
					if (other.path !== prompt.path) others.add(other.title);
				}
			}
		}
	}

	const result = new Map<string, LintFinding[]>();
	for (const [path, others] of collidingTitlesByPath) {
		result.set(path, [
			{
				ruleId: "L6",
				severity: "warning",
				message: `Near-duplicate title, also used by: ${[...others].join(", ")}.`,
			},
		]);
	}
	return result;
}

/** Thin orchestrator: one result per prompt, unfiltered (read-only, FR-16.3). */
export function lintLibrary(prompts: Prompt[], getBody: (path: string) => string): PromptLintResult[] {
	const duplicates = findDuplicateTitleFindings(prompts);
	return prompts.map((prompt) => ({
		path: prompt.path,
		title: prompt.title,
		findings: [...lintPrompt(prompt, getBody(prompt.path)), ...(duplicates.get(prompt.path) ?? [])],
	}));
}
