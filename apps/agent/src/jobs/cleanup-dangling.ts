import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import { Effect } from "effect";
import { cleanupDanglingVolumeMountDirectories } from "../volume-host/cleanup";
import type { AgentJob } from "./types";

const VOLUME_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export const CleanupDanglingVolumeMountsJob: AgentJob = {
	name: "cleanup-dangling-volume-mounts",
	intervalMs: VOLUME_CLEANUP_INTERVAL_MS,
	run: () =>
		Effect.tryPromise({
			try: cleanupDanglingVolumeMountDirectories,
			catch: (error) => error,
		}).pipe(
			Effect.catchAll((error) =>
				Effect.sync(() => logger.warn(`Agent volume cleanup failed: ${toMessage(error)}`)),
			),
		),
};
