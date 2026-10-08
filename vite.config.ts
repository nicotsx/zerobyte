import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

export default defineConfig(({ command }) => {
	let agentProxy;
	if (command === "serve") {
		const reservation = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
		process.env.ZEROBYTE_DEV_AGENT_PORT = String(reservation.port);
		agentProxy = {
			"^/api/v1/agents/connect$": { target: `ws://127.0.0.1:${reservation.port}`, ws: true },
		};
		reservation.stop(true);
	}

	let https;
	if (process.env.ZEROBYTE_RUNTIME === "desktop") {
		https = { cert: process.env.NITRO_SSL_CERT, key: process.env.NITRO_SSL_KEY };
	}

	return {
		clearScreen: false,
		plugins: [
			tanstackStart({
				srcDirectory: "app",
				router: { routesDirectory: "routes" },
				importProtection: { behavior: "error" },
			}),
			nitro({
				preset: "bun",
				serverDir: "./app/nitro",
				features: {
					websocket: command === "build",
				},
			}),
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
			proxy: agentProxy,
			port: 3000,
			https,
			allowedHosts: [".ts.net"],
		},
	};
});
