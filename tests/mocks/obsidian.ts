// Minimal stub of the obsidian module for unit tests. Domain and indexer code
// must not import obsidian at all; this covers incidental type-only imports.
export class Notice {
	constructor(public message: string) {}
}
export class TFile {
	constructor(
		public path = "",
		public basename = "",
	) {}
}
export class Plugin {}
