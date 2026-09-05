import { Scheduler } from "../../core/scheduler";
import { withContext } from "../../core/request-context";
import { db } from "../../db/db";
import { logger } from "@zerobyte/core/node";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { volumeService } from "../volumes/volume.service";
import { toMessage } from "../../utils/errors";
import { stopAgentController } from "../agents/agents-manager";
import { enqueueApplicationLifecycleTransition, getApplicationLifecycleRuntime } from "./bootstrap-runtime";

const stopSchedulerAndUnmountVolumes = async () => {
	await Scheduler.stop();

	const volumes = await db.query.volumesTable.findMany({
		where: {
			AND: [{ agentId: LOCAL_AGENT_ID }, { sourceKind: "managed" }, { status: "mounted" }],
		},
	});

	for (const volume of volumes) {
		try {
			const result = await withContext({ organizationId: volume.organizationId }, () =>
				volumeService.unmountVolume(volume.shortId, { persistStatus: false }),
			);
			const errorSuffix = result.error ? `, error: ${result.error}` : "";
			logger.info(`Volume ${volume.name} unmount status: ${result.status}${errorSuffix}`);
		} catch (error) {
			logger.error(`Error unmounting volume ${volume.name} on shutdown: ${toMessage(error)}`);
		}
	}
};

export const shutdown = () => {
	const runtime = getApplicationLifecycleRuntime();
	if (runtime.shutdownPromise) return runtime.shutdownPromise;

	const operation = enqueueApplicationLifecycleTransition(async (runtime, generation) => {
		runtime.status = "stopping";

		try {
			try {
				await stopSchedulerAndUnmountVolumes();
			} finally {
				await stopAgentController();
			}
		} finally {
			runtime.status = "stopped";
			runtime.completedGeneration = generation;
		}
	});

	runtime.shutdownPromise = operation;
	return operation;
};
