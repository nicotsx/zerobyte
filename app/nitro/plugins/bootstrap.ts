import { definePlugin } from "nitro";
import { bootstrapApplication } from "../../server/modules/lifecycle/bootstrap";
import { shutdown } from "../../server/modules/lifecycle/shutdown";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "../../server/utils/errors";

export default definePlugin(async (nitroApp) => {
	nitroApp.hooks.hook("close", shutdown);

	await bootstrapApplication().catch((err) => {
		logger.error(`Bootstrap failed: ${toMessage(err)}`);
		process.exit(1);
	});
});
