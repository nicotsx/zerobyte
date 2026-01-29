import { defaultPlugins, defineConfig } from "@hey-api/openapi-ts";
import { config } from "./app/server/core/config.js";

export default defineConfig({
	input: `http://${config.serverIp}:3000/api/v1/openapi.json`,
	output: {
		path: "./app/client/api-client",
		postProcess: ["oxfmt"],
	},
	plugins: [...defaultPlugins, "@tanstack/react-query", "@hey-api/client-fetch"],
});
