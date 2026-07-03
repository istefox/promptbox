import { normalizeProfiles, type VariableProfile } from "./domain/variable-profiles";

export interface PromptboxSettings {
	/** Vault-relative folder holding prompt notes; subfolders included. */
	promptsFolder: string;
	typeValues: string[];
	categoryValues: string[];
	defaultType: string;
	profiles: VariableProfile[];
}

// The spec does not pin a default folder name; "Prompts" is the project default.
export const DEFAULT_SETTINGS: PromptboxSettings = {
	promptsFolder: "Prompts",
	typeValues: ["system", "task", "agent", "snippet"],
	categoryValues: [],
	defaultType: "task",
	profiles: [],
};

function stringArray(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return [...fallback];
	const out = value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
	return out.length > 0 ? out : [...fallback];
}

/** Merges persisted data (possibly absent, partial, or corrupted) over the defaults. Never throws. */
export function mergeSettings(raw: unknown): PromptboxSettings {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return {
			...DEFAULT_SETTINGS,
			typeValues: [...DEFAULT_SETTINGS.typeValues],
			categoryValues: [],
			profiles: [],
		};
	}
	const r = raw as Record<string, unknown>;
	return {
		promptsFolder:
			typeof r["promptsFolder"] === "string" && r["promptsFolder"].trim() !== ""
				? r["promptsFolder"].trim().replace(/\/+$/, "")
				: DEFAULT_SETTINGS.promptsFolder,
		typeValues: stringArray(r["typeValues"], DEFAULT_SETTINGS.typeValues),
		categoryValues: Array.isArray(r["categoryValues"])
			? stringArray(r["categoryValues"], [])
			: [],
		defaultType:
			typeof r["defaultType"] === "string" && r["defaultType"].trim() !== ""
				? r["defaultType"].trim()
				: DEFAULT_SETTINGS.defaultType,
		profiles: normalizeProfiles(r["profiles"]),
	};
}
