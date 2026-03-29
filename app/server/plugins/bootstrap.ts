import { definePlugin } from "nitro";
import { bootstrapApplication } from "../modules/lifecycle/bootstrap";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "../utils/errors";
import { stopAgentRuntime } from "../modules/agents/agents-manager";

type ProcessWithAgentCloseHook = NodeJS.Process & {
	__zerobyteAgentRuntimeCloseHookRegistered?: boolean;
};

export default definePlugin(async (nitroApp) => {
	const runtimeProcess = process as ProcessWithAgentCloseHook;

	if (!runtimeProcess.__zerobyteAgentRuntimeCloseHookRegistered) {
		nitroApp.hooks.hook("close", stopAgentRuntime);
		runtimeProcess.__zerobyteAgentRuntimeCloseHookRegistered = true;
	}

	await bootstrapApplication().catch((err) => {
		logger.error(`Bootstrap failed: ${toMessage(err)}`);
		process.exit(1);
	});
});
