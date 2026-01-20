import { Job } from "../core/scheduler";
import { volumeService } from "../modules/volumes/volume.service";
import { logger } from "../utils/logger";
import { db } from "../db/db";
import { eq, or } from "drizzle-orm";
import { volumesTable } from "../db/schema";
import { withContext } from "../core/request-context";

export class VolumeHealthCheckJob extends Job {
	async run() {
		logger.debug("Running health check for all volumes...");

		const volumes = await db.query.volumesTable.findMany({
			where: or(eq(volumesTable.status, "mounted"), eq(volumesTable.status, "error")),
		});

		for (const volume of volumes) {
			await withContext({ organizationId: volume.organizationId }, async () => {
				const { status } = await volumeService.checkHealth(volume.id);
				if (status === "error" && volume.autoRemount) {
					await volumeService.mountVolume(volume.id);
				}
			});
		}

		return { done: true, timestamp: new Date() };
	}
}
