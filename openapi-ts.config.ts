import { defaultPlugins, defineConfig } from "@hey-api/openapi-ts";
import { config } from "./app/server/core/config.js";

export default defineConfig({
	input: `http://${config.serverIp}:4096/api/v1/openapi.json`,
	output: {
		path: "./app/client/api-client",
		format: "biome",
	},
	plugins: [...defaultPlugins, "@tanstack/react-query", "@hey-api/client-fetch"],
});
