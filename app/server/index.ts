import { createHonoServer } from "react-router-hono-server/bun";
import { runDbMigrations } from "./db/db";
import { startup } from "./modules/lifecycle/startup";
import { retagSnapshots } from "./modules/lifecycle/migration";
import { logger } from "./utils/logger";
import { shutdown } from "./modules/lifecycle/shutdown";
import { REQUIRED_MIGRATIONS } from "./core/constants";
import { validateRequiredMigrations } from "./modules/lifecycle/checkpoint";
import { createApp } from "./app";
import { config } from "./core/config";

const app = createApp();

runDbMigrations();

await retagSnapshots();
await validateRequiredMigrations(REQUIRED_MIGRATIONS);

startup();

logger.info(`Server is running at http://localhost:4096`);

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
	port: 4096,
	customBunServer: {
		idleTimeout: config.serverIdleTimeout,
		error(err) {
			logger.error(`[Bun.serve] Server error: ${err.message}`);
		},
	},
});
