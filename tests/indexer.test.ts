import { describe, expect, it } from "vitest";
import { normalizePrompt, type Prompt } from "../src/domain/prompt";
import { PromptIndex, type IndexerHost } from "../src/storage/indexer";

function makePrompt(path: string, title = path): Prompt {
	return normalizePrompt({ title }, { path, filename: title, today: "2026-07-02" });
}

class FakeVault implements IndexerHost {
	files = new Map<string, Prompt>();

	listMarkdownFiles(): string[] {
		return [...this.files.keys()];
	}

	readPrompt(path: string): Prompt | null {
		return this.files.get(path) ?? null;
	}

	put(path: string, title = path): void {
		this.files.set(path, makePrompt(path, title));
	}

	remove(path: string): void {
		this.files.delete(path);
	}
}

const instantYield = () => Promise.resolve();

describe("PromptIndex — scan", () => {
	it("indexes only markdown files under the configured folder", async () => {
		const vault = new FakeVault();
		vault.put("Prompts/a.md");
		vault.put("Prompts/sub/b.md");
		vault.put("Notes/outside.md");
		vault.put("Prompts-other/decoy.md");
		const index = new PromptIndex(vault, "Prompts", 50, instantYield);
		await index.scan();
		expect(index.size).toBe(2);
		expect(index.get("Prompts/sub/b.md")).toBeDefined();
		expect(index.get("Notes/outside.md")).toBeUndefined();
		expect(index.get("Prompts-other/decoy.md")).toBeUndefined();
	});

	it("chunks the scan so large folders never monopolize the thread (NFR-2)", async () => {
		const vault = new FakeVault();
		for (let i = 0; i < 1000; i++) vault.put(`Prompts/p-${i}.md`);
		let yields = 0;
		const index = new PromptIndex(vault, "Prompts", 50, () => {
			yields++;
			return Promise.resolve();
		});
		await index.scan();
		expect(index.size).toBe(1000);
		expect(yields).toBe(19); // ceil(1000 / 50) - 1 boundaries
	});

	it("abandons a stale scan when the folder changes mid-flight", async () => {
		const vault = new FakeVault();
		for (let i = 0; i < 200; i++) vault.put(`Old/p-${i}.md`);
		for (let i = 0; i < 3; i++) vault.put(`New/n-${i}.md`);
		let firstYield = true;
		const index = new PromptIndex(vault, "Old", 50, () => {
			if (firstYield) {
				firstYield = false;
				index.setFolder("New"); // triggers a new scan, invalidating the running one
			}
			return Promise.resolve();
		});
		await index.scan();
		await Promise.resolve(); // let the re-scan settle
		expect(index.getAll().every((p) => p.path.startsWith("New/"))).toBe(true);
		expect(index.size).toBe(3);
	});
});

describe("PromptIndex — vault events (FR-1)", () => {
	it("stays consistent through an event storm", async () => {
		const vault = new FakeVault();
		const index = new PromptIndex(vault, "Prompts", 50, instantYield);
		await index.scan();

		// interleaved create / modify / rename / delete
		vault.put("Prompts/a.md", "A");
		index.handleCreateOrModify("Prompts/a.md");
		vault.put("Prompts/b.md", "B");
		index.handleCreateOrModify("Prompts/b.md");
		vault.put("Prompts/a.md", "A2");
		index.handleCreateOrModify("Prompts/a.md");
		vault.remove("Prompts/a.md");
		vault.put("Prompts/a2.md", "A2");
		index.handleRename("Prompts/a.md", "Prompts/a2.md");
		vault.remove("Prompts/b.md");
		index.handleDelete("Prompts/b.md");
		vault.put("Prompts/c.md", "C");
		index.handleCreateOrModify("Prompts/c.md");

		expect(index.size).toBe(2);
		expect(index.get("Prompts/a2.md")?.title).toBe("A2");
		expect(index.get("Prompts/c.md")?.title).toBe("C");
		expect(index.get("Prompts/a.md")).toBeUndefined();
		expect(index.get("Prompts/b.md")).toBeUndefined();
	});

	it("ignores events outside the folder and non-markdown paths", async () => {
		const vault = new FakeVault();
		const index = new PromptIndex(vault, "Prompts", 50, instantYield);
		await index.scan();
		vault.put("Elsewhere/x.md");
		index.handleCreateOrModify("Elsewhere/x.md");
		index.handleCreateOrModify("Prompts/image.png");
		expect(index.size).toBe(0);
	});

	it("removes a prompt renamed out of the folder, adds one renamed in", async () => {
		const vault = new FakeVault();
		vault.put("Prompts/in.md", "In");
		const index = new PromptIndex(vault, "Prompts", 50, instantYield);
		await index.scan();

		vault.remove("Prompts/in.md");
		vault.put("Archive/in.md", "In");
		index.handleRename("Prompts/in.md", "Archive/in.md");
		expect(index.size).toBe(0);

		vault.remove("Archive/in.md");
		vault.put("Prompts/back.md", "Back");
		index.handleRename("Archive/in.md", "Prompts/back.md");
		expect(index.size).toBe(1);
	});

	it("notifies listeners with add/update/remove/scan events", async () => {
		const vault = new FakeVault();
		const index = new PromptIndex(vault, "Prompts", 50, instantYield);
		const events: string[] = [];
		index.onChange((event) => events.push(event));
		await index.scan();
		vault.put("Prompts/a.md");
		index.handleCreateOrModify("Prompts/a.md");
		index.handleCreateOrModify("Prompts/a.md");
		index.handleDelete("Prompts/a.md");
		expect(events).toEqual(["scan", "add", "update", "remove"]);
	});

	it("re-indexes on folder change (FR-1.2)", async () => {
		const vault = new FakeVault();
		vault.put("Old/a.md");
		vault.put("New/b.md");
		const index = new PromptIndex(vault, "Old", 50, instantYield);
		await index.scan();
		expect(index.size).toBe(1);
		index.setFolder("New");
		await Promise.resolve();
		expect(index.getAll().map((p) => p.path)).toEqual(["New/b.md"]);
	});
});
