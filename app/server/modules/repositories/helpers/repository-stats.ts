import type { ResticStatsDto } from "@zerobyte/core/restic";
import { and, eq } from "drizzle-orm";
import { repoMutex } from "~/server/core/repository-mutex";
import { restic } from "~/server/core/restic";
import { db } from "~/server/db/db";
import { repositoriesTable, type Repository } from "~/server/db/schema";
import { runEffectPromise } from "~/server/utils/errors";

export const emptyRepositoryStats: ResticStatsDto = {
	total_size: 0,
	total_uncompressed_size: 0,
	compression_ratio: 0,
	compression_progress: 0,
	compression_space_saving: 0,
	snapshots_count: 0,
};

export const refreshStoredRepositoryStats = async (repository: Repository): Promise<ResticStatsDto> => {
	const releaseLock = await repoMutex.acquireShared(repository.id, "stats");
	try {
		const stats = await runEffectPromise(
			restic.stats(repository.config, { organizationId: repository.organizationId }),
		);

		await db
			.update(repositoriesTable)
			.set({ stats, statsUpdatedAt: Date.now() })
			.where(
				and(
					eq(repositoriesTable.id, repository.id),
					eq(repositoriesTable.organizationId, repository.organizationId),
				),
			);

		return stats;
	} finally {
		releaseLock();
	}
};
