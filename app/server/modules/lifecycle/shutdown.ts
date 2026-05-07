import { Scheduler } from "../../core/scheduler";
import { db } from "../../db/db";
import { logger } from "@zerobyte/core/node";
import { stopApplicationRuntime } from "./bootstrap";
import { decryptVolumeConfig } from "../volumes/volume-config-secrets";
import { createVolumeBackend } from "../../../../apps/agent/src/volume-host";

export const shutdown = async () => {
	await Scheduler.stop();
	await stopApplicationRuntime();

	const volumes = await db.query.volumesTable.findMany({
		where: { status: "mounted" },
	});

	for (const volume of volumes) {
		const backend = createVolumeBackend({
			...volume,
			config: await decryptVolumeConfig(volume.config),
			provisioningId: volume.provisioningId ?? null,
		});
		const { status, error } = await backend.unmount();

		logger.info(`Volume ${volume.name} unmount status: ${status}${error ? `, error: ${error}` : ""}`);
	}
};
