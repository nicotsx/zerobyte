import * as schema from "./server/db/schema";
import { setSchema, runDbMigrations } from "./server/db/db";
import { startup } from "./server/modules/lifecycle/startup";
import { logger } from "./server/utils/logger";
import { shutdown } from "./server/modules/lifecycle/shutdown";
import { runCLI } from "./server/cli";
import { runMigrations } from "./server/modules/lifecycle/migrations";
import { createStartHandler, defaultStreamHandler, defineHandlerCallback } from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";

setSchema(schema);

const cliRun = await runCLI(Bun.argv);
if (cliRun) {
	process.exit(0);
}

runDbMigrations();

await runMigrations();
await startup();

const customHandler = defineHandlerCallback((ctx) => {
	return defaultStreamHandler(ctx);
});

const fetch = createStartHandler(customHandler);

export default createServerEntry({
	fetch,
});

process.on("SIGTERM", async () => {
	logger.info("SIGTERM received, starting graceful shutdown...");
	try {
		await shutdown();
	} catch (err) {
		logger.error("Error during shutdown", err);
	} finally {
		process.exit(0);
	}
});

process.on("SIGINT", async () => {
	logger.info("SIGINT received, starting graceful shutdown...");
	try {
		await shutdown();
	} catch (err) {
		logger.error("Error during shutdown", err);
	} finally {
		process.exit(0);
	}
});
