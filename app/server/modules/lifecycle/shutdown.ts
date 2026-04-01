import { Scheduler } from "../../core/scheduler";
import { db } from "../../db/db";
import { logger } from "@zerobyte/core/node";
import { createVolumeBackend } from "../backends/backend";
import { stopAgentRuntime } from "../agents/agents-manager";

export const shutdown = async () => {
	await Scheduler.stop();
	await stopAgentRuntime();

	const volumes = await db.query.volumesTable.findMany({
		where: { status: "mounted" },
	});

	for (const volume of volumes) {
		const backend = createVolumeBackend(volume);
		const { status, error } = await backend.unmount();

		logger.info(`Volume ${volume.name} unmount status: ${status}${error ? `, error: ${error}` : ""}`);
	}
};
