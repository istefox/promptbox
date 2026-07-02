import type { Prompt } from "../domain/prompt";

/** Vault access needed by the index; implemented over the Obsidian API in main.ts, faked in tests. */
export interface IndexerHost {
	/** All markdown file paths in the vault. */
	listMarkdownFiles(): string[];
	/** Normalized prompt for a path, or null when the file is not readable. */
	readPrompt(path: string): Prompt | null;
	/** Note body (frontmatter stripped) for full-text search (FR-2.4). */
	readBody(path: string): Promise<string>;
}

export type IndexEvent = "scan" | "add" | "update" | "remove";
export type IndexListener = (event: IndexEvent, path?: string) => void;

/**
 * Disposable in-memory index of prompt notes (ADR-0001, FR-1).
 * Notes are the single source of truth; this map can always be rebuilt via scan().
 */
export class PromptIndex {
	private prompts = new Map<string, Prompt>();
	private bodies = new Map<string, string>();
	private listeners = new Set<IndexListener>();
	private generation = 0;
	private folder: string;

	constructor(
		private readonly host: IndexerHost,
		folder: string,
		private readonly chunkSize = 50,
		/** Yields control between scan chunks; injectable for tests. */
		private readonly yielder: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
	) {
		this.folder = normalizeFolder(folder);
	}

	get size(): number {
		return this.prompts.size;
	}

	get(path: string): Prompt | undefined {
		return this.prompts.get(path);
	}

	getBody(path: string): string {
		return this.bodies.get(path) ?? "";
	}

	getAll(): Prompt[] {
		return [...this.prompts.values()];
	}

	onChange(listener: IndexListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Full rebuild in async chunks so a large folder never blocks the UI thread (NFR-2).
	 * A folder change mid-scan abandons the stale scan via the generation counter.
	 */
	async scan(): Promise<void> {
		const gen = ++this.generation;
		const nextPrompts = new Map<string, Prompt>();
		const nextBodies = new Map<string, string>();
		const paths = this.host.listMarkdownFiles().filter((p) => this.inFolder(p));
		for (let i = 0; i < paths.length; i += this.chunkSize) {
			for (const path of paths.slice(i, i + this.chunkSize)) {
				const prompt = this.host.readPrompt(path);
				if (!prompt) continue;
				nextPrompts.set(path, prompt);
				nextBodies.set(path, await this.host.readBody(path));
			}
			if (i + this.chunkSize < paths.length) await this.yielder();
			if (gen !== this.generation) return;
		}
		this.prompts = nextPrompts;
		this.bodies = nextBodies;
		this.notify("scan");
	}

	/** FR-1.2: changing the prompts folder re-indexes without restart. */
	setFolder(folder: string): void {
		const normalized = normalizeFolder(folder);
		if (normalized === this.folder) return;
		this.folder = normalized;
		void this.scan();
	}

	async handleCreateOrModify(path: string): Promise<void> {
		if (!this.inFolder(path)) return;
		const prompt = this.host.readPrompt(path);
		if (!prompt) {
			this.handleDelete(path);
			return;
		}
		const known = this.prompts.has(path);
		this.prompts.set(path, prompt);
		this.notify(known ? "update" : "add", path);
		const body = await this.host.readBody(path);
		if (this.prompts.get(path) === prompt) {
			const changed = this.bodies.get(path) !== body;
			this.bodies.set(path, body);
			if (changed) this.notify("update", path);
		}
	}

	handleDelete(path: string): void {
		this.bodies.delete(path);
		if (this.prompts.delete(path)) this.notify("remove", path);
	}

	async handleRename(oldPath: string, newPath: string): Promise<void> {
		this.handleDelete(oldPath);
		await this.handleCreateOrModify(newPath);
	}

	private inFolder(path: string): boolean {
		if (!path.endsWith(".md")) return false;
		if (this.folder === "") return true;
		return path.startsWith(this.folder + "/");
	}

	private notify(event: IndexEvent, path?: string): void {
		for (const listener of this.listeners) listener(event, path);
	}
}

function normalizeFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/g, "");
}
