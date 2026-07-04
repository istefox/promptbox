function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** FR-23.2 persisted shape: `lastUsed` is ISO 8601, `count` is the total successful copies (>= 1). */
export interface UsageEntry {
	lastUsed: string;
	count: number;
}

/** `data.json`'s `usage` field, keyed by vault-relative path. */
export type UsageStore = Record<string, UsageEntry>;

/**
 * Tolerant load for the persisted `usage` field (FR-23.2): non-object input
 * degrades to `{}`; an entry missing `lastUsed`/`count`, with wrong types, or
 * with a non-positive `count`, is dropped while sibling valid entries survive
 * (mirrors `normalizeProfiles`). Never throws.
 */
export function normalizeUsage(raw: unknown): UsageStore {
	if (!isPlainObject(raw)) return {};
	const out: UsageStore = {};
	for (const [path, value] of Object.entries(raw)) {
		if (!isPlainObject(value)) continue;
		const lastUsed = value["lastUsed"];
		const count = value["count"];
		if (typeof lastUsed !== "string") continue;
		if (typeof count !== "number" || count < 1) continue;
		out[path] = { lastUsed, count };
	}
	return out;
}

/**
 * Records a successful copy (FR-23.1): a new store with `path`'s entry set to
 * `{ lastUsed: nowISO, count: prev.count + 1 }` (or `1` on a first use). Pure;
 * the caller supplies the clock so this module never reads it.
 */
export function recordUsage(store: UsageStore, path: string, nowISO: string): UsageStore {
	const prev = store[path];
	return { ...store, [path]: { lastUsed: nowISO, count: (prev?.count ?? 0) + 1 } };
}

/**
 * Migrates a usage entry on an in-Obsidian rename (FR-23.4): moves the entry
 * from `oldPath` to `newPath`, overwriting any entry already at `newPath`.
 * No-op (content-equal new object) when `oldPath` has no entry.
 */
export function renameUsage(store: UsageStore, oldPath: string, newPath: string): UsageStore {
	const entry = store[oldPath];
	if (!entry) return { ...store };
	const out: UsageStore = { ...store };
	delete out[oldPath];
	out[newPath] = entry;
	return out;
}

/**
 * Drops orphan keys whose path is absent from `knownPaths` (FR-23.3), so a
 * delete or an out-of-vault rename is lazily cleaned up at the next index
 * (re)build.
 */
export function pruneUsage(store: UsageStore, knownPaths: Set<string>): UsageStore {
	const out: UsageStore = {};
	for (const [path, entry] of Object.entries(store)) {
		if (knownPaths.has(path)) out[path] = entry;
	}
	return out;
}

/**
 * Path -> epoch ms of `lastUsed`, for injection into the query comparator
 * (FR-23.5). An unparseable `lastUsed` maps to `0`, the same value the
 * comparator uses for a never-used prompt.
 */
export function usageRecencyMap(store: UsageStore): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [path, entry] of Object.entries(store)) {
		const ms = Date.parse(entry.lastUsed);
		out[path] = Number.isNaN(ms) ? 0 : ms;
	}
	return out;
}
