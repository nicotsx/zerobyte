import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"~": path.resolve(import.meta.dirname, "../.."),
		},
	},
	test: {
		server: {
			deps: {
				inline: ["zod"],
			},
		},
		name: "integration",
		environment: "node",
		include: ["app/test/integration/src/**/*.test.ts"],
		testTimeout: 300_000,
		hookTimeout: 300_000,
		maxConcurrency: 4,
	},
});
