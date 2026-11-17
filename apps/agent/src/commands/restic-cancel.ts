import { Effect } from "effect";
import { type ResticCommandCancelPayload } from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";
import type { ControllerCommandContext } from "../context";

export const handleResticCancelCommand = (context: ControllerCommandContext, payload: ResticCommandCancelPayload) => {
	return Effect.gen(function* () {
		const running = yield* context.getRunningJob(payload.commandId);
		if (!running) {
			logger.warn(`Restic command ${payload.commandId} is not running`);
			return;
		}

		if (running.kind !== "restic") {
			logger.warn(`Ignoring restic cancel for non-restic job ${payload.commandId}`);
			return;
		}

		running.abortController.abort();
	});
};
