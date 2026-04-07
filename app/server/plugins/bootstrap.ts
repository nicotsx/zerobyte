import { definePlugin } from "nitro";
import { bootstrapApplication, stopApplicationRuntime } from "../modules/lifecycle/bootstrap";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "../utils/errors";

export default definePlugin(async (nitroApp) => {
	nitroApp.hooks.hook("close", stopApplicationRuntime);

	await bootstrapApplication().catch((err) => {
		logger.error(`Bootstrap failed: ${toMessage(err)}`);
		process.exit(1);
	});
});
