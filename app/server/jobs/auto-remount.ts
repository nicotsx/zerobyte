import { Job } from "../core/scheduler";
import { volumeService } from "../modules/volumes/volume.service";
import { logger } from "../utils/logger";
import { db } from "../db/db";
import { eq } from "drizzle-orm";
import { volumesTable } from "../db/schema";

export class VolumeAutoRemountJob extends Job {
	async run() {
		logger.debug("Running auto-remount for all errored volumes...");

		const volumes = await db.query.volumesTable.findMany({
			where: eq(volumesTable.status, "error"),
		});

		for (const volume of volumes) {
			if (volume.autoRemount) {
				try {
					await volumeService.mountVolume(volume.id, volume.organizationId);
				} catch (err) {
					logger.error(`Failed to auto-remount volume ${volume.name}:`, err);
				}
			}
		}

		return { done: true, timestamp: new Date() };
	}
}
