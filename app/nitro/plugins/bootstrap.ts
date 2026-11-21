import { definePlugin } from "nitro";
import { bootstrapApplication } from "../../server/modules/lifecycle/bootstrap";
import { shutdown } from "../../server/modules/lifecycle/shutdown";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "../../server/utils/errors";

export default definePlugin(async (nitroApp) => {
	const ready = bootstrapApplication().catch((err) => {
		logger.error(`Bootstrap failed: ${toMessage(err)}`);
		process.exit(1);
	});

	let closing: Promise<void> | undefined;

	nitroApp.hooks.hook("close", () => {
		closing ??= ready.then(shutdown);
		return closing;
	});

	const handleRequest = nitroApp.fetch;

	nitroApp.fetch = async (request) => {
		await ready;
		return handleRequest(request);
	};

	await ready;
});
