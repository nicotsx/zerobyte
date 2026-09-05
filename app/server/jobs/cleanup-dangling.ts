import { logger } from "@zerobyte/core/node";
import { cleanupDanglingVolumeMountDirectories } from "../modules/volumes/volume-host/cleanup";

export class CleanupDanglingVolumeMountsJob {
	async run() {
		await cleanupDanglingVolumeMountDirectories().catch((error) => logger.warn("Volume cleanup failed:", error));
	}
}
