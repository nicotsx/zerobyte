import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
	define: {
		"process.env.NODE_ENV": "production",
	},
	plugins: [
		tsconfigPaths(),
		tanstackStart({
			srcDirectory: "app",
			router: {
				routesDirectory: "routes",
			},
		}),
		nitro({ preset: "bun" }),
		viteReact({
			babel: {
				plugins: ["babel-plugin-react-compiler"],
			},
		}),
		tailwindcss(),
	],
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
