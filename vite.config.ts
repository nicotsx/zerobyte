import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

export default defineConfig(({ command }) => {
	// Nitro's development adapter requires Node. Proxy agent upgrades to the
	// controller's Bun listener while Vite continues to own HMR.
	const websocketEnabled = command === "build";
	const nitroFeatures = { websocket: websocketEnabled };
	let agentProxyTarget: string | undefined;
	if (command === "serve") {
		const reservation = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
		process.env.ZEROBYTE_DEV_AGENT_PORT = String(reservation.port);
		agentProxyTarget = `ws://127.0.0.1:${reservation.port}`;
		reservation.stop(true);
	}

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
			proxy: agentProxyTarget
				? { "^/api/v1/agents/connect$": { target: agentProxyTarget, ws: true } }
				: undefined,
			port: 3000,
			https:
				process.env.ZEROBYTE_RUNTIME === "desktop"
					? { cert: process.env.NITRO_SSL_CERT, key: process.env.NITRO_SSL_KEY }
					: undefined,
			allowedHosts: [".ts.net"],
		},
	};
});
