import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
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
});
