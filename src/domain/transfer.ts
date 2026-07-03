import type { Prompt } from "./prompt";
import { resolveCollision } from "./slug";

export const SCHEMA_VERSION = 1;

/** FR-7.2 export entry; `path` is relative to the prompts folder. */
export interface ExportedPrompt {
	path: string;
	title: string;
	type: string;
	category: string;
	tags: string[];
	quality?: number;
	use_case: string;
	visibility: string;
	version: string;
	created: string;
	updated: string;
	body: string;
}

/** Optional pack header layered on the export schema (FR-20). */
export interface PackHeader {
	name: string;
	description: string;
}

export interface ExportDoc {
	schema_version: typeof SCHEMA_VERSION;
	exported_at: string;
	prompts: ExportedPrompt[];
	pack?: PackHeader;
}

/** Maps a `Prompt` + its note body into the transfer wire shape (FR-7.2). */
export function toExportedPrompt(prompt: Prompt, body: string, relativePath: string): ExportedPrompt {
	return {
		path: relativePath,
		title: prompt.title,
		type: prompt.type,
		category: prompt.category,
		tags: [...prompt.tags],
		...(prompt.quality !== undefined ? { quality: prompt.quality } : {}),
		use_case: prompt.useCase,
		visibility: prompt.visibility,
		version: prompt.version,
		created: prompt.created,
		updated: prompt.updated,
		body,
	};
}

export function buildExport(
	prompts: Prompt[],
	getBody: (path: string) => string,
	folder: string,
	exportedAt: string,
): ExportDoc {
	const prefix = folder === "" ? "" : folder + "/";
	return {
		schema_version: SCHEMA_VERSION,
		exported_at: exportedAt,
		prompts: prompts.map((p) =>
			toExportedPrompt(p, getBody(p.path), p.path.startsWith(prefix) ? p.path.slice(prefix.length) : p.path),
		),
	};
}

/** Composes `buildExport` with a pack header, leaving `buildExport` itself untouched (FR-20.1). */
export function buildPackExport(
	prompts: Prompt[],
	getBody: (path: string) => string,
	folder: string,
	exportedAt: string,
	pack: PackHeader,
): ExportDoc {
	return { ...buildExport(prompts, getBody, folder, exportedAt), pack };
}

/**
 * Tolerant pack-header parse (NFR-8 idiom): a malformed value never blocks
 * import, it degrades to a single warning and `pack: undefined` (FR-21.1).
 */
export function parsePackHeader(raw: unknown): { pack: PackHeader | undefined; warning: string | null } {
	if (raw === undefined || raw === null) return { pack: undefined, warning: null };
	if (typeof raw !== "object" || Array.isArray(raw)) {
		return { pack: undefined, warning: "pack: expected an object" };
	}
	const r = raw as Record<string, unknown>;
	const name = r["name"];
	if (typeof name !== "string" || name.trim() === "") {
		return { pack: undefined, warning: "pack.name: expected a non-empty string" };
	}
	const descriptionRaw = r["description"];
	if (descriptionRaw !== undefined && typeof descriptionRaw !== "string") {
		return { pack: undefined, warning: "pack.description: expected a string" };
	}
	return { pack: { name: name.trim(), description: descriptionRaw ?? "" }, warning: null };
}

export type ValidationResult =
	| { ok: true; doc: ExportDoc; warnings: string[] }
	| { ok: false; errors: string[] };

function safeRelativePath(path: string): boolean {
	if (path === "" || !path.endsWith(".md")) return false;
	if (path.startsWith("/") || path.includes("\\")) return false;
	return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/**
 * Strict upfront validation (FR-7.3): the whole document is checked before any
 * write. Hostile input (wrong version, wrong types, path traversal) yields
 * clear error messages and never throws.
 */
export function validateImport(parsed: unknown): ValidationResult {
	const errors: string[] = [];
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { ok: false, errors: ["root: expected a JSON object"] };
	}
	const root = parsed as Record<string, unknown>;
	if (root["schema_version"] !== SCHEMA_VERSION) {
		errors.push(`schema_version: expected ${SCHEMA_VERSION}, got ${JSON.stringify(root["schema_version"])}`);
	}
	if (!Array.isArray(root["prompts"])) {
		errors.push("prompts: expected an array");
		return { ok: false, errors };
	}

	const prompts: ExportedPrompt[] = [];
	(root["prompts"] as unknown[]).forEach((raw, i) => {
		if (errors.length >= 20) return;
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
			errors.push(`prompts[${i}]: expected an object`);
			return;
		}
		const e = raw as Record<string, unknown>;
		const str = (key: string, required: boolean): string => {
			const v = e[key];
			if (typeof v === "string") return v;
			if (required || (v !== undefined && v !== null)) errors.push(`prompts[${i}].${key}: expected a string`);
			return "";
		};
		const path = str("path", true);
		if (typeof e["path"] === "string" && !safeRelativePath(path)) {
			errors.push(`prompts[${i}].path: unsafe or non-markdown relative path "${path}"`);
		}
		let tags: string[] = [];
		if (e["tags"] !== undefined && e["tags"] !== null) {
			if (Array.isArray(e["tags"]) && e["tags"].every((t) => typeof t === "string")) tags = e["tags"];
			else errors.push(`prompts[${i}].tags: expected an array of strings`);
		}
		let quality: number | undefined;
		if (e["quality"] !== undefined && e["quality"] !== null) {
			const q = e["quality"];
			if (typeof q === "number" && Number.isInteger(q) && q >= 1 && q <= 5) quality = q;
			else errors.push(`prompts[${i}].quality: expected an integer 1-5`);
		}
		prompts.push({
			path,
			title: str("title", true),
			type: str("type", true),
			category: str("category", false),
			tags,
			...(quality !== undefined ? { quality } : {}),
			use_case: str("use_case", false),
			visibility: str("visibility", true),
			version: str("version", true),
			created: str("created", true),
			updated: str("updated", true),
			body: str("body", true),
		});
	});

	if (errors.length > 0) return { ok: false, errors };
	const exportedAt = typeof root["exported_at"] === "string" ? root["exported_at"] : "";
	const { pack, warning } = parsePackHeader(root["pack"]);
	return {
		ok: true,
		doc: { schema_version: SCHEMA_VERSION, exported_at: exportedAt, prompts, ...(pack !== undefined ? { pack } : {}) },
		warnings: warning !== null ? [warning] : [],
	};
}

export type ImportPolicy = "skip" | "overwrite" | "duplicate";
export type ImportActionKind = "create" | "skip" | "overwrite" | "duplicate";

export interface ImportAction {
	kind: ImportActionKind;
	/** Target path relative to the prompts folder. */
	targetPath: string;
	entry: ExportedPrompt;
}

/** One policy for the whole import (FR-7.3); duplicates get numeric suffixes. */
export function planImport(doc: ExportDoc, existing: ReadonlySet<string>, policy: ImportPolicy): ImportAction[] {
	const taken = new Set(existing);
	return doc.prompts.map((entry) => {
		if (!taken.has(entry.path)) {
			taken.add(entry.path);
			return { kind: "create" as const, targetPath: entry.path, entry };
		}
		if (policy === "skip") return { kind: "skip" as const, targetPath: entry.path, entry };
		if (policy === "overwrite") return { kind: "overwrite" as const, targetPath: entry.path, entry };
		const dir = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/") + 1) : "";
		const stem = entry.path.slice(dir.length, -3);
		const unique = resolveCollision(stem, (candidate) => taken.has(`${dir}${candidate}.md`));
		const targetPath = `${dir}${unique}.md`;
		taken.add(targetPath);
		return { kind: "duplicate" as const, targetPath, entry };
	});
}

/** Per-field difference surfaced by the import overwrite preview (FR-17.2). */
export type ImportFieldChange =
	| { field: "tags"; from: string[]; to: string[] }
	| { field: "quality"; from: number | undefined; to: number | undefined }
	| {
			field: "title" | "type" | "category" | "use_case" | "visibility" | "version" | "created" | "updated";
			from: string;
			to: string;
	  };

/** Structured diff of one overwrite conflict (FR-17.2, FR-17.3). */
export interface ImportDiff {
	targetPath: string;
	identical: boolean;
	fieldChanges: ImportFieldChange[];
	body: { changed: boolean; added: number; removed: number };
}

/**
 * Minimal line-based body comparison (FR-17.3): a line-multiset difference,
 * not an LCS/patch. A pure append of N lines yields +N/-0; a single edited
 * line yields +1/-1; identical bodies yield 0/0. Reordered-but-identical
 * lines are reported as unchanged (a known limit of a non-order-aware metric).
 */
function bodyLines(body: string): string[] {
	return body === "" ? [] : body.split("\n");
}

export function lineDelta(oldBody: string, newBody: string): { added: number; removed: number } {
	const counts = new Map<string, number>();
	for (const line of bodyLines(oldBody)) counts.set(line, (counts.get(line) ?? 0) + 1);
	for (const line of bodyLines(newBody)) counts.set(line, (counts.get(line) ?? 0) - 1);
	let added = 0;
	let removed = 0;
	for (const residue of counts.values()) {
		if (residue > 0) removed += residue;
		else added += -residue;
	}
	return { added, removed };
}

/**
 * Diffs the existing note's transfer shape against the incoming entry
 * (FR-17.2, FR-17.3), comparing exactly the ten fields `applyEntry` in
 * `transfer-io.ts` overwrites, in that same order.
 */
export function diffImportEntry(existing: ExportedPrompt, incoming: ExportedPrompt): ImportDiff {
	const fieldChanges: ImportFieldChange[] = [];

	if (existing.title !== incoming.title) fieldChanges.push({ field: "title", from: existing.title, to: incoming.title });
	if (existing.type !== incoming.type) fieldChanges.push({ field: "type", from: existing.type, to: incoming.type });
	if (existing.category !== incoming.category) {
		fieldChanges.push({ field: "category", from: existing.category, to: incoming.category });
	}
	const tagsEqual =
		existing.tags.length === incoming.tags.length && existing.tags.every((t, i) => t === incoming.tags[i]);
	if (!tagsEqual) {
		fieldChanges.push({ field: "tags", from: existing.tags, to: incoming.tags });
	}
	if (existing.quality !== incoming.quality) {
		fieldChanges.push({ field: "quality", from: existing.quality, to: incoming.quality });
	}
	if (existing.use_case !== incoming.use_case) {
		fieldChanges.push({ field: "use_case", from: existing.use_case, to: incoming.use_case });
	}
	if (existing.visibility !== incoming.visibility) {
		fieldChanges.push({ field: "visibility", from: existing.visibility, to: incoming.visibility });
	}
	if (existing.version !== incoming.version) {
		fieldChanges.push({ field: "version", from: existing.version, to: incoming.version });
	}
	if (existing.created !== incoming.created) {
		fieldChanges.push({ field: "created", from: existing.created, to: incoming.created });
	}
	if (existing.updated !== incoming.updated) {
		fieldChanges.push({ field: "updated", from: existing.updated, to: incoming.updated });
	}

	const { added, removed } = lineDelta(existing.body, incoming.body);
	const body = { changed: added > 0 || removed > 0, added, removed };

	return {
		targetPath: existing.path,
		identical: fieldChanges.length === 0 && !body.changed,
		fieldChanges,
		body,
	};
}
