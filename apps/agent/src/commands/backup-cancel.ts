import { Effect } from "effect";
import { type BackupCancelPayload } from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";
import type { ControllerCommandContext } from "../context";

export const handleBackupCancelCommand = (context: ControllerCommandContext, payload: BackupCancelPayload) =>
	Effect.gen(function* () {
		const running = yield* context.getRunningJob(payload.jobId);
		if (!running) {
			logger.warn(`Backup ${payload.jobId} is not running`);
			return;
		}

		if (running.scheduleId !== payload.scheduleId) {
			logger.warn(`Ignoring cancel for backup ${payload.jobId} due to schedule mismatch ${payload.scheduleId}`);
			return;
		}

		running.abortController.abort();
	});
