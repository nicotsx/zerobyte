import { eq } from "drizzle-orm";
import { logger } from "@zerobyte/core/node";
import { db } from "../../../db/db";
import { volumesTable } from "../../../db/schema";
import { toMessage } from "~/server/utils/errors";

const execute = async () => {
	const errors: Array<{ name: string; error: string }> = [];
	const volumes = await db.query.volumesTable.findMany();
	let migratedCount = 0;

	for (const volume of volumes) {
		if (volume.type !== "smb" || volume.config.backend !== "smb" || volume.config.mapToContainerUidGid !== undefined) {
			continue;
		}

		try {
			await db
				.update(volumesTable)
				.set({
					config: { ...volume.config, mapToContainerUidGid: true },
					updatedAt: Date.now(),
				})
				.where(eq(volumesTable.id, volume.id));

			migratedCount += 1;
		} catch (error) {
			errors.push({
				name: `volume:${volume.id}`,
				error: toMessage(error),
			});
		}
	}

	logger.info(`Migration 00006-map-smb-files-to-container-uid-gid updated ${migratedCount} SMB volumes.`);

	return { success: errors.length === 0, errors };
};

export const v00006 = {
	execute,
	id: "00006-map-smb-files-to-container-uid-gid",
	type: "maintenance" as const,
};
