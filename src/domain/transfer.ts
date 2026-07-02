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

export interface ExportDoc {
	schema_version: typeof SCHEMA_VERSION;
	exported_at: string;
	prompts: ExportedPrompt[];
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
		prompts: prompts.map((p) => ({
			path: p.path.startsWith(prefix) ? p.path.slice(prefix.length) : p.path,
			title: p.title,
			type: p.type,
			category: p.category,
			tags: [...p.tags],
			...(p.quality !== undefined ? { quality: p.quality } : {}),
			use_case: p.useCase,
			visibility: p.visibility,
			version: p.version,
			created: p.created,
			updated: p.updated,
			body: getBody(p.path),
		})),
	};
}

export type ValidationResult = { ok: true; doc: ExportDoc } | { ok: false; errors: string[] };

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
	return { ok: true, doc: { schema_version: SCHEMA_VERSION, exported_at: exportedAt, prompts } };
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
