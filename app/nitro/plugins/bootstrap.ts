import { definePlugin } from "nitro";
import { bootstrapApplication } from "../../server/modules/lifecycle/bootstrap";
import { shutdown } from "../../server/modules/lifecycle/shutdown";
import { withTimeout } from "../../server/modules/volumes/volume-host/timeout";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "../../server/utils/errors";

export const SHUTDOWN_TIMEOUT_MS = 10_000;

export default definePlugin(async (nitroApp) => {
	const ready = bootstrapApplication().catch((err) => {
		logger.error(`Bootstrap failed: ${toMessage(err)}`);
		process.exit(1);
	});

	let closing: Promise<void> | undefined;

	const initiateShutdown = () => {
		closing ??= withTimeout(ready.then(shutdown), SHUTDOWN_TIMEOUT_MS, "Shutdown");
		return closing;
	};

	nitroApp.hooks.hook("close", initiateShutdown);

	let serverClosedResolve: (() => void) | undefined;
	const serverClosed = new Promise<void>((resolve) => {
		serverClosedResolve = resolve;
	});
	nitroApp.hooks.hook("close", () => {
		serverClosedResolve?.();
	});

	const exitAfterShutdown = () => {
		void Promise.all([
			initiateShutdown(),
			Promise.race([serverClosed, new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))]),
		]).finally(() => process.exit(0));
	};

	process.once("SIGTERM", exitAfterShutdown);
	process.once("SIGINT", exitAfterShutdown);

	const handleRequest = nitroApp.fetch;

	nitroApp.fetch = async (request) => {
		await ready;
		return handleRequest(request);
	};

	await ready;
});
