import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

export default defineConfig({
	plugins: [
		tanstackStart({
			srcDirectory: "app",
			router: {
				routesDirectory: "routes",
			},
			importProtection: {
				behavior: "error",
			},
		}),
		nitro({
			preset: "bun",
			plugins: ["./app/server/plugins/bootstrap.ts"],
		}),
		viteReact(),
		babel({ presets: [reactCompilerPreset()] }),
		tailwindcss(),
	],
	resolve: {
		tsconfigPaths: true,
	},
	build: {
		outDir: "dist",
		sourcemap: false,
		rollupOptions: {
			external: ["bun"],
		},
	},
	server: {
		host: "0.0.0.0",
		port: 3000,
	},
	fmt: {
		printWidth: 120,
		useTabs: true,
		endOfLine: "lf",
		ignorePatterns: ["*.gen.ts", "**/.source"],
	},
	lint: {
		plugins: ["eslint", "unicorn", "typescript", "oxc", "import", "react", "react-perf", "node", "jsx-a11y"],
		categories: {
			correctness: "warn",
		},
		options: {
			typeAware: true,
		},
		rules: {
			"no-unused-vars": [
				"warn",
				{
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
					argsIgnorePattern: "^_",
				},
			],
			"import/no-cycle": "error",
			"no-console": ["warn", { allow: ["warn", "error", "info"] }],
		},
		env: {
			builtin: true,
		},
		ignorePatterns: ["**/api-client/**", "docs/**"],
		overrides: [
			{
				files: ["**/*.test.ts", "**/*.test.tsx"],
				rules: {
					"typescript/await-thenable": "off",
				},
			},
		],
	},
	staged: {
		"*.{js,jsx,ts,tsx,json,jsonc}": "vp fmt --write",
	},
	run: {
		cache: {
			scripts: true,
			tasks: true,
		},
	},
});
