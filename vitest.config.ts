import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
	},
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)),
		},
	},
});
