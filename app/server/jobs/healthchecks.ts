import { Job } from "../core/scheduler";
import { volumeService } from "../modules/volumes/volume.service";
import { logger } from "../utils/logger";
import { db } from "../db/db";
import { eq, or } from "drizzle-orm";
import { volumesTable } from "../db/schema";

export class VolumeHealthCheckJob extends Job {
	async run() {
		logger.debug("Running health check for all volumes...");

		const volumes = await db.query.volumesTable.findMany({
			where: or(eq(volumesTable.status, "mounted"), eq(volumesTable.status, "error")),
		});

		for (const volume of volumes) {
			const { status } = await volumeService.checkHealth(volume.id, volume.organizationId);
			if (status === "error" && volume.autoRemount) {
				await volumeService.mountVolume(volume.id, volume.organizationId);
			}
		}

		return { done: true, timestamp: new Date() };
	}
}
