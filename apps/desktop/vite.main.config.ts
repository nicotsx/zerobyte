import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
	build: {
		ssr: true,
		outDir: ".vite/build",
		emptyOutDir: true,
		sourcemap: true,
		minify: false,
		rolldownOptions: {
			input: {
				main: path.resolve(__dirname, "electron/main.ts"),
				preload: path.resolve(__dirname, "electron/preload.ts"),
			},
			external: ["electron"],
			output: {
				format: "cjs",
				entryFileNames: "[name].js",
			},
		},
	},
	ssr: {
		external: ["electron"],
		noExternal: true,
	},
});
