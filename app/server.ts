import * as schema from "./server/db/schema";
import { setSchema, runDbMigrations } from "./server/db/db";
import { startup } from "./server/modules/lifecycle/startup";
import { logger } from "./server/utils/logger";
import { shutdown } from "./server/modules/lifecycle/shutdown";
import { createApp } from "./server/app";
import { config } from "./server/core/config";
import { runCLI } from "./server/cli";
import { runMigrations } from "./server/modules/lifecycle/migrations";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { createStartHandler, defaultStreamHandler, defineHandlerCallback } from "@tanstack/react-start/server";

setSchema(schema);

const cliRun = await runCLI(Bun.argv);
if (cliRun) {
	process.exit(0);
}

runDbMigrations();

const app = createApp();

await runMigrations();
await startup();

export type AppType = typeof app;

process.on("SIGTERM", async () => {
	logger.info("SIGTERM received, starting graceful shutdown...");
	await shutdown();
	process.exit(0);
});

process.on("SIGINT", async () => {
	logger.info("SIGINT received, starting graceful shutdown...");
	await shutdown();
	process.exit(0);
});

export default createServerEntry({
	fetch: app.fetch,
});
// export default await createHonoServer({
// 	app,
// 	port: config.port,
// 	defaultLogger: false,
// 	customBunServer: {
// 		idleTimeout: config.serverIdleTimeout,
// 		error(err) {
// 			logger.error(`[Bun.serve] Server error: ${err.message}`);
// 		},
// 	},
// });
