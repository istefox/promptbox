import { isContextVariable, parsePlaceholders, type PromptVariable } from "./placeholders";

export const MIN_CHAIN_STEPS = 2;

const PREVIOUS_NAME = "@previous";

/**
 * Tolerant read (NFR-8): a non-list value normalizes to []; non-string and
 * empty-string entries are dropped; order and duplicates are otherwise
 * preserved. Presence vs absence of the `chain` key is decided by the caller
 * (normalizePrompt), not here — this only cleans the value.
 */
export function readChain(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((entry): entry is string => typeof entry === "string" && entry !== "");
}

/** Save-time guard the modal calls into; the only place the 2-step minimum is enforced. */
export function isSaveableChain(steps: string[]): boolean {
	return steps.length >= MIN_CHAIN_STEPS;
}

/** Steps that do not resolve against the current path set (deleted / out-of-vault). */
export function chainOrphanSteps(steps: string[], knownPaths: ReadonlySet<string>): string[] {
	return steps.filter((step) => !knownPaths.has(step));
}

/**
 * Rename rewrite: a new array with every oldPath entry replaced by newPath
 * (all occurrences). Content-equal to the input when nothing matched.
 */
export function renameChainSteps(steps: string[], oldPath: string, newPath: string): string[] {
	return steps.map((step) => (step === oldPath ? newPath : step));
}

/**
 * Wizard fill partition. `@previous` is a chain-scoped display alias for
 * `@clipboard`: it never reaches context resolution or the user-fill modal,
 * it is only ever handled by `buildStepValues`.
 */
export interface StepVariablePartition {
	contextNames: string[];
	usesPrevious: boolean;
	userVariables: PromptVariable[];
}

export function partitionStepVariables(body: string): StepVariablePartition {
	const contextNames: string[] = [];
	const userVariables: PromptVariable[] = [];
	let usesPrevious = false;

	for (const variable of parsePlaceholders(body)) {
		if (variable.name === PREVIOUS_NAME) {
			usesPrevious = true;
		} else if (isContextVariable(variable.name)) {
			contextNames.push(variable.name);
		} else {
			userVariables.push(variable);
		}
	}

	return { contextNames, usesPrevious, userVariables };
}

/**
 * Merges resolved values for assembleBody: context values, then
 * { "@previous": clipboardValue } when usesPrevious, then user values.
 * `@previous` carries the exact `@clipboard` value; user values win over a
 * colliding context key, mirroring copy.ts's `{ ...contextValues, ...userValues }`.
 */
export function buildStepValues(
	contextValues: Record<string, string>,
	clipboardValue: string,
	usesPrevious: boolean,
	userValues: Record<string, string>,
): Record<string, string> {
	return {
		...contextValues,
		...(usesPrevious ? { [PREVIOUS_NAME]: clipboardValue } : {}),
		...userValues,
	};
}
