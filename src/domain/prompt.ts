import { readChain } from "./chains";

export const VISIBILITIES = ["private", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export interface Prompt {
	path: string;
	title: string;
	type: string;
	category: string;
	tags: string[];
	quality?: number;
	useCase: string;
	visibility: Visibility;
	version: string;
	created: string;
	updated: string;
	favorite: boolean;
	/** Present => chain note (list tolerantly cleaned); absent => normal prompt (ADR-0018). */
	chain?: string[];
	/** Placeholder names left untouched by "Copy with variables" (e.g. AI-filled, not user-filled). */
	excludedPlaceholders: string[];
	/** Unrecognized frontmatter fields, preserved verbatim (phase-2 namespaced fields included). */
	custom: Record<string, unknown>;
	/** Normalization problems found on read; the note is still usable (NFR-8). */
	warnings: string[];
}

export interface NormalizeContext {
	path: string;
	/** File name without extension, fallback for a missing title. */
	filename: string;
	/** Today as YYYY-MM-DD, fallback for missing/invalid dates. */
	today: string;
	/** Configured frontmatter key for a prompt's type (issue #46). */
	typeKey: string;
	/** Fallback type value when `typeKey` is missing or invalid. */
	defaultType: string;
}

/** Fields Promptbox always reserves, independent of the configured type key. */
const STATIC_KNOWN_FIELDS = [
	"title",
	"category",
	"tags",
	"quality",
	"use_case",
	"visibility",
	"version",
	"created",
	"updated",
	"favorite",
	"chain",
	"excluded_placeholders",
];

/** True when `key` would collide with a field Promptbox always reserves (issue #46). */
export function isReservedTypeKeyCollision(key: string): boolean {
	return STATIC_KNOWN_FIELDS.includes(key);
}

/** Simple YAML-identifier check: letters, digits, `_`, `-`; must start with a letter or `_`. */
export function isValidTypeKeyFormat(key: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidISODate(value: string): boolean {
	if (!DATE_RE.test(value)) return false;
	const [y, m, d] = value.split("-").map(Number) as [number, number, number];
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function readString(
	raw: Record<string, unknown>,
	key: string,
	fallback: string,
	required: boolean,
	warnings: string[],
): string {
	const value = raw[key];
	if (typeof value === "string" && value.trim() !== "") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value !== undefined && value !== null) {
		warnings.push(`invalid ${key}: expected string`);
	} else if (required) {
		warnings.push(`missing ${key}`);
	}
	return fallback;
}

function readTags(value: unknown, warnings: string[]): string[] {
	if (value === undefined || value === null) return [];
	if (Array.isArray(value)) {
		return value
			.filter((t) => typeof t === "string" || typeof t === "number")
			.map((t) => String(t).trim())
			.filter((t) => t !== "");
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t !== "");
	}
	warnings.push("invalid tags: expected list or string");
	return [];
}

function readExcludedPlaceholders(value: unknown, warnings: string[]): string[] {
	if (value === undefined || value === null) return [];
	if (Array.isArray(value)) {
		return value
			.filter((t) => typeof t === "string" || typeof t === "number")
			.map((t) => String(t).trim())
			.filter((t) => t !== "");
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t !== "");
	}
	warnings.push("invalid excluded_placeholders: expected list or string");
	return [];
}

function readQuality(value: unknown, warnings: string[]): number | undefined {
	if (value === undefined || value === null) return undefined;
	const n = typeof value === "string" ? Number(value) : value;
	if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5) return n;
	warnings.push("invalid quality: expected integer 1-5");
	return undefined;
}

function readDate(
	raw: Record<string, unknown>,
	key: string,
	fallback: string,
	warnings: string[],
): string {
	const value = raw[key];
	if (typeof value === "string" && isValidISODate(value.trim())) return value.trim();
	if (value instanceof Date && !isNaN(value.getTime())) {
		return value.toISOString().slice(0, 10);
	}
	warnings.push(value === undefined || value === null ? `missing ${key}` : `invalid ${key}: expected YYYY-MM-DD`);
	return fallback;
}

function readFavorite(value: unknown): boolean {
	// Deliberately silent: FR-9.1 requires absent/invalid values to fall back
	// to false with a warning-free render, unlike every other field above.
	return value === true;
}

/**
 * Normalizes raw frontmatter (as produced by Obsidian's metadata cache) into a Prompt.
 * Tolerant by contract: never throws, every invalid field degrades to a safe default
 * plus a warning (spec.md NFR-8). Unknown fields pass through in `custom`.
 */
export function normalizePrompt(rawInput: unknown, ctx: NormalizeContext): Prompt {
	const warnings: string[] = [];
	const raw = asRecord(rawInput);
	if (rawInput !== undefined && rawInput !== null && Object.keys(raw).length === 0 && typeof rawInput !== "object") {
		warnings.push("invalid frontmatter: expected mapping");
	}
	if (rawInput === undefined || rawInput === null) {
		warnings.push("missing frontmatter");
	}

	const visibilityRaw = readString(raw, "visibility", "private", true, warnings);
	const visibility: Visibility = (VISIBILITIES as readonly string[]).includes(visibilityRaw)
		? (visibilityRaw as Visibility)
		: "private";
	if (visibility !== visibilityRaw) warnings.push("invalid visibility: expected private|public");

	const versionRaw = raw["version"];
	let version: string;
	if (typeof versionRaw === "string" && versionRaw.trim() !== "") version = versionRaw.trim();
	else if (typeof versionRaw === "number") version = String(versionRaw);
	else {
		warnings.push(versionRaw === undefined || versionRaw === null ? "missing version" : "invalid version: expected string");
		version = "1.0";
	}

	const knownFields = new Set([...STATIC_KNOWN_FIELDS, ctx.typeKey]);
	const custom: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (!knownFields.has(key)) custom[key] = value;
	}

	return {
		path: ctx.path,
		title: readString(raw, "title", ctx.filename, true, warnings),
		type: readString(raw, ctx.typeKey, ctx.defaultType, true, warnings),
		category: readString(raw, "category", "", false, warnings),
		tags: readTags(raw["tags"], warnings),
		quality: readQuality(raw["quality"], warnings),
		useCase: readString(raw, "use_case", "", false, warnings),
		visibility,
		version,
		created: readDate(raw, "created", ctx.today, warnings),
		updated: readDate(raw, "updated", ctx.today, warnings),
		favorite: readFavorite(raw["favorite"]),
		chain: "chain" in raw ? readChain(raw["chain"]) : undefined,
		excludedPlaceholders: readExcludedPlaceholders(raw["excluded_placeholders"], warnings),
		custom,
		warnings,
	};
}

/** True when a taxonomy value is outside the configured list (rendered as "custom" by the UI). */
export function isCustomValue(value: string, configured: string[]): boolean {
	return value !== "" && !configured.includes(value);
}
