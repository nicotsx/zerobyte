import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

export default defineConfig(({ command }) => {
	// Nitro's Vite dev worker currently selects crossws' Node adapter, which cannot
	// serve Vite HMR under Bun. The Bun production build provides the public WS.
	const websocketEnabled = command === "build";
	const nitroFeatures = { websocket: websocketEnabled };

	return {
		clearScreen: false,
		plugins: [
			tanstackStart({
				srcDirectory: "app",
				router: { routesDirectory: "routes" },
				importProtection: { behavior: "error" },
			}),
			nitro({ preset: "bun", serverDir: "./app/nitro", features: nitroFeatures }),
			viteReact(),
			babel({ presets: [reactCompilerPreset()] }),
			tailwindcss(),
		],
		resolve: {
			tsconfigPaths: true,
		},
		environments: {
			ssr: {
				build: {
					rollupOptions: {
						external: [/\/app\/server\/(?!lib\/functions\/)/],
						makeAbsoluteExternalsRelative: false,
					},
				},
			},
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
			https:
				process.env.ZEROBYTE_RUNTIME === "desktop"
					? { cert: process.env.NITRO_SSL_CERT, key: process.env.NITRO_SSL_KEY }
					: undefined,
			allowedHosts: [".ts.net"],
		},
	};
});
