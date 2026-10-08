import { Job } from "../core/scheduler";
import { volumeService } from "../modules/volumes/volume.service";
import { logger } from "@zerobyte/core/node";
import { readVolume } from "../db/volume";
import { db } from "../db/db";
import { withContext } from "../core/request-context";

export class VolumeAutoRemountJob extends Job {
	async run() {
		logger.debug("Running auto-remount for all errored volumes...");

		const volumes = await db.query.volumesTable.findMany({
			where: { status: "error" },
		});

		for (const volume of volumes) {
			try {
				await withContext({ organizationId: volume.organizationId }, async () => {
					await volumeService.ensureHealthyVolume(readVolume(volume));
				});
			} catch (err) {
				logger.error(`Failed to recover volume ${volume.name}:`, err);
			}
		}

		return { done: true, timestamp: new Date() };
	}
}
