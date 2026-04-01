import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"~": path.resolve(import.meta.dirname, "app"),
		},
	},
	test: {
		server: {
			deps: {
				inline: ["zod"],
			},
		},
		projects: [
			{
				extends: true,
				test: {
					name: "server",
					environment: "node",
					include: ["app/**/*.test.ts", "app/**/*.test.tsx", "app/**/*.spec.ts", "app/**/*.spec.tsx"],
					exclude: [
						"app/client/**/*.test.ts",
						"app/client/**/*.test.tsx",
						"app/client/**/*.spec.ts",
						"app/client/**/*.spec.tsx",
					],
					setupFiles: ["./app/test/setup.ts"],
				},
			},
			{
				extends: true,
				test: {
					name: "client",
					environment: "happy-dom",
					environmentOptions: {
						happyDOM: {
							url: "http://localhost:3000",
						},
					},
					include: [
						"app/client/**/*.test.ts",
						"app/client/**/*.test.tsx",
						"app/client/**/*.spec.ts",
						"app/client/**/*.spec.tsx",
					],
					setupFiles: ["./app/test/setup-client.ts"],
				},
			},
		],
	},
});
