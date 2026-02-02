import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import babel from "vite-plugin-babel";

export default defineConfig({
	plugins: [
		tailwindcss(),
		tsconfigPaths(),
		// babel({
		// 	filter: /\.[jt]sx?$/,
		// 	babelConfig: {
		// 		presets: ["@babel/preset-typescript"],
		// 		plugins: [["babel-plugin-react-compiler"]],
		// 	},
		// }),
		tanstackStart({
			srcDirectory: "app",
			router: {
				routesDirectory: "routes",
			},
		}),
		viteReact(),
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
