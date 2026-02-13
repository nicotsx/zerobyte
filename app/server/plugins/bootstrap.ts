import { definePlugin } from "nitro";
import { bootstrapApplication } from "../modules/lifecycle/bootstrap";
import { logger } from "../utils/logger";
import { toMessage } from "../utils/errors";

export default definePlugin(() => {
	void bootstrapApplication().catch((err) => {
		logger.error(`Bootstrap failed: ${toMessage(err)}`);
		process.exit(1);
	});
});
