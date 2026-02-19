import { Job } from "../core/scheduler";
import { volumeService } from "../modules/volumes/volume.service";
import { logger } from "../utils/logger";
import { db } from "../db/db";
import { withContext } from "../core/request-context";

export class VolumeHealthCheckJob extends Job {
	async run() {
		logger.debug("Running health check for all volumes...");

		const volumes = await db.query.volumesTable.findMany({
			where: {
				OR: [{ status: "mounted" }, { status: "error" }],
			},
		});

		for (const volume of volumes) {
			await withContext({ organizationId: volume.organizationId }, async () => {
				const { status } = await volumeService.checkHealth(volume.shortId);
				if (status === "error" && volume.autoRemount) {
					await volumeService.mountVolume(volume.shortId);
				}
			});
		}

		return { done: true, timestamp: new Date() };
	}
}
