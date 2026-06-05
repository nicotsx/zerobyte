import { definePlugin } from "nitro";
import { bootstrapApplication } from "../modules/lifecycle/bootstrap";
import { shutdown } from "../modules/lifecycle/shutdown";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "../utils/errors";

let shutdownPromise: Promise<void> | undefined;

const runGracefulShutdown = async (reason: string) => {
	if (!shutdownPromise) {
		logger.info(`${reason}, starting graceful shutdown...`);
		shutdownPromise = shutdown().catch((err) => {
			logger.error("Error during shutdown", err);
		});
	}

	await shutdownPromise;
};

const runSignalShutdown = (reason: string) => {
	void runGracefulShutdown(reason).finally(() => {
		process.exit(0);
	});
};

export default definePlugin(async (nitroApp) => {
	process.on("SIGTERM", () => {
		runSignalShutdown("SIGTERM received");
	});
	process.on("SIGINT", () => {
		runSignalShutdown("SIGINT received");
	});
	nitroApp.hooks.hook("close", () => runGracefulShutdown("Server closing"));

	await bootstrapApplication().catch((err) => {
		logger.error(`Bootstrap failed: ${toMessage(err)}`);
		process.exit(1);
	});
});
