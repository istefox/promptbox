export interface VariableProfile {
	name: string;
	values: Record<string, string>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeValues(raw: unknown): Record<string, string> {
	if (!isPlainObject(raw)) return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === "string") out[key] = value;
	}
	return out;
}

/**
 * Tolerant load for the persisted `profiles` field (FR-14.1): malformed entries
 * are dropped silently, never a crash. Names are trimmed; a second entry whose
 * name collides case-insensitively with an earlier one is dropped (first
 * occurrence wins, mirrors `parsePlaceholders`).
 */
export function normalizeProfiles(raw: unknown): VariableProfile[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: VariableProfile[] = [];
	for (const entry of raw) {
		if (!isPlainObject(entry)) continue;
		const name = entry["name"];
		if (typeof name !== "string" || name.trim() === "") continue;
		const trimmed = name.trim();
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ name: trimmed, values: normalizeValues(entry["values"]) });
	}
	return out;
}

/** Profiles sharing at least one key with `variableNames` (FR-14.2 dropdown gating). */
export function matchingProfiles(profiles: VariableProfile[], variableNames: string[]): VariableProfile[] {
	if (profiles.length === 0 || variableNames.length === 0) return [];
	return profiles.filter((p) => variableNames.some((name) => Object.prototype.hasOwnProperty.call(p.values, name)));
}

/**
 * Applies a profile to the current field values (FR-14.5): for each name in
 * `variableNames`, `profileValues`'s entry wins when present (including an
 * explicit empty string), otherwise `currentValues`'s entry is kept, falling
 * back to `""` when absent there too. Keys outside `variableNames` never
 * appear in the output.
 */
export function applyProfile(
	profileValues: Record<string, string>,
	currentValues: Record<string, string>,
	variableNames: string[],
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const name of variableNames) {
		out[name] = Object.prototype.hasOwnProperty.call(profileValues, name)
			? profileValues[name]!
			: (currentValues[name] ?? "");
	}
	return out;
}

/** Case-insensitive, trimmed name lookup; -1 when absent. */
export function findProfileIndex(profiles: VariableProfile[], name: string): number {
	const key = name.trim().toLowerCase();
	return profiles.findIndex((p) => p.name.trim().toLowerCase() === key);
}

/**
 * Inserts a new profile or replaces the case-insensitive match wholesale
 * (FR-14.3): the stored name becomes exactly the newly given string, and
 * `values` is replaced, not merged. The input array is never mutated.
 */
export function upsertProfile(
	profiles: VariableProfile[],
	name: string,
	values: Record<string, string>,
): VariableProfile[] {
	const trimmed = name.trim();
	const index = findProfileIndex(profiles, trimmed);
	if (index === -1) return [...profiles, { name: trimmed, values: { ...values } }];
	const out = [...profiles];
	out[index] = { name: trimmed, values: { ...values } };
	return out;
}
