import { createHonoServer } from "react-router-hono-server/bun";

import { createApp } from "./app";
import { runCLI } from "./cli";
import { config } from "./core/config";
import { REQUIRED_MIGRATIONS } from "./core/constants";
import { runDbMigrations } from "./db/db";
import { validateRequiredMigrations } from "./modules/lifecycle/checkpoint";
import { retagSnapshots } from "./modules/lifecycle/migration";
import { shutdown } from "./modules/lifecycle/shutdown";
import { startup } from "./modules/lifecycle/startup";
import { logger } from "./utils/logger";

const cliRun = await runCLI(Bun.argv);
if (cliRun) {
	process.exit(0);
}

const app = createApp();

runDbMigrations();

await retagSnapshots();
await validateRequiredMigrations(REQUIRED_MIGRATIONS);

await startup();

logger.info(`Server is running at http://localhost:${config.port}`);

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

export default await createHonoServer({
	app,
	port: config.port,
	customBunServer: {
		idleTimeout: config.serverIdleTimeout,
		error(err) {
			logger.error(`[Bun.serve] Server error: ${err.message}`);
		},
	},
});
