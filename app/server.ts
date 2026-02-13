import { logger } from "./server/utils/logger";
import { shutdown } from "./server/modules/lifecycle/shutdown";
import { runCLI } from "./server/cli";
import {
	createStartHandler,
	defaultStreamHandler,
	defineHandlerCallback,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";

const cliRun = await runCLI(Bun.argv);
if (cliRun) {
	process.exit(0);
}

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
