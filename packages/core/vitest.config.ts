import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		server: {
			deps: {
				inline: ["zod"],
			},
		},
		include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
		setupFiles: ["./test/setup.ts"],
	},
});
