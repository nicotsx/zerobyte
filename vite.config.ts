import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { reactRouterHonoServer } from "react-router-hono-server/dev";

export default defineConfig({
	plugins: [reactRouterHonoServer({ runtime: "bun" }), reactRouter(), tailwindcss(), tsconfigPaths()],
	build: {
		outDir: "dist",
		sourcemap: false,
		rollupOptions: {
			external: ["bun"],
		},
	},
	server: {
		host: '0.0.0.0',
		port: 4096,
	},
});
