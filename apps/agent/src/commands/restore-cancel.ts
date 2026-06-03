import { Effect } from "effect";
import { type RestoreCancelPayload } from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";
import type { ControllerCommandContext } from "../context";

export const handleRestoreCancelCommand = (context: ControllerCommandContext, payload: RestoreCancelPayload) => {
	return Effect.gen(function* () {
		const running = yield* context.getRunningJob(payload.restoreId);
		if (!running) {
			logger.warn(`Restore ${payload.restoreId} is not running`);
			return;
		}

		if (running.kind !== "restore") {
			logger.warn(`Ignoring restore cancel for non-restore job ${payload.restoreId}`);
			return;
		}

		running.abortController.abort();
	});
};
