import { BadRequestError, NotFoundError } from "http-errors-enhanced";
import { logger } from "@zerobyte/core/node";
import type { BackupSchedule, Repository } from "../../../db/schema";
import { restic } from "../../../core/restic";
import { repoMutex } from "../../../core/repository-mutex";
import { serverEvents } from "../../../core/events";
import { cache, cacheKeys } from "../../../utils/cache";
import { toMessage } from "../../../utils/errors";
import { getOrganizationId } from "~/server/core/request-context";
import { mirrorQueries, repositoryQueries, scheduleQueries } from "../backups.queries";

export async function runForget(scheduleId: number, repositoryId?: string, organizationIdOverride?: string) {
	const organizationId = organizationIdOverride ?? getOrganizationId();
	const schedule = await scheduleQueries.findById(scheduleId, organizationId);

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	if (!schedule.retentionPolicy) {
		throw new BadRequestError("No retention policy configured for this schedule");
	}

	const repository = await repositoryQueries.findById(repositoryId ?? schedule.repositoryId, organizationId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	logger.info(`running retention policy (forget) for schedule ${scheduleId}`);
	const releaseLock = await repoMutex.acquireExclusive(repository.id, `forget:${scheduleId}`);

	try {
		await restic.forget(repository.config, schedule.retentionPolicy, { tag: schedule.shortId, organizationId });
		cache.delByPrefix(cacheKeys.repository.all(repository.id));
	} finally {
		releaseLock();
	}

	logger.info(`Retention policy applied successfully for schedule ${scheduleId}`);
}

export async function copyToMirrors(
	scheduleId: number,
	sourceRepository: Repository,
	retentionPolicy: BackupSchedule["retentionPolicy"],
	organizationIdOverride?: string,
) {
	const organizationId = organizationIdOverride ?? getOrganizationId();
	const schedule = await scheduleQueries.findById(scheduleId, organizationId);

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	const mirrors = await mirrorQueries.findEnabledBySchedule(scheduleId);

	if (mirrors.length === 0) {
		return;
	}

	logger.info(`[Background] Copying snapshots to ${mirrors.length} mirror repositories for schedule ${scheduleId}`);

	for (const mirror of mirrors) {
		await copyToSingleMirror(scheduleId, schedule, sourceRepository, mirror, retentionPolicy, organizationId);
	}
}

async function copyToSingleMirror(
	scheduleId: number,
	schedule: BackupSchedule,
	sourceRepository: Repository,
	mirror: {
		repositoryId: string;
		repository: Repository;
	},
	retentionPolicy: BackupSchedule["retentionPolicy"],
	organizationId: string,
) {
	try {
		logger.info(`[Background] Copying to mirror repository: ${mirror.repository.name}`);

		serverEvents.emit("mirror:started", {
			organizationId,
			scheduleId: schedule.shortId,
			repositoryId: mirror.repository.shortId,
			repositoryName: mirror.repository.name,
		});

		await mirrorQueries.updateStatus(scheduleId, mirror.repositoryId, {
			lastCopyStatus: "in_progress",
			lastCopyError: null,
		});

		const releaseSource = await repoMutex.acquireShared(sourceRepository.id, `mirror_source:${scheduleId}`);
		const releaseMirror = await repoMutex.acquireShared(mirror.repository.id, `mirror:${scheduleId}`);

		try {
			await restic.copy(sourceRepository.config, mirror.repository.config, { tag: schedule.shortId, organizationId });
			cache.delByPrefix(cacheKeys.repository.all(mirror.repository.id));
		} finally {
			releaseSource();
			releaseMirror();
		}

		if (retentionPolicy) {
			void runForget(scheduleId, mirror.repository.id, organizationId).catch((error) => {
				logger.error(
					`Failed to run retention policy for mirror repository ${mirror.repository.name}: ${toMessage(error)}`,
				);
			});
		}

		await mirrorQueries.updateStatus(scheduleId, mirror.repositoryId, {
			lastCopyAt: Date.now(),
			lastCopyStatus: "success",
			lastCopyError: null,
		});

		logger.info(`[Background] Successfully copied to mirror repository: ${mirror.repository.name}`);

		serverEvents.emit("mirror:completed", {
			organizationId,
			scheduleId: schedule.shortId,
			repositoryId: mirror.repository.shortId,
			repositoryName: mirror.repository.name,
			status: "success",
		});
	} catch (error) {
		const errorMessage = toMessage(error);
		logger.error(`[Background] Failed to copy to mirror repository ${mirror.repository.name}: ${errorMessage}`);

		await mirrorQueries.updateStatus(scheduleId, mirror.repositoryId, {
			lastCopyAt: Date.now(),
			lastCopyStatus: "error",
			lastCopyError: errorMessage,
		});

		serverEvents.emit("mirror:completed", {
			organizationId,
			scheduleId: schedule.shortId,
			repositoryId: mirror.repository.shortId,
			repositoryName: mirror.repository.name,
			status: "error",
			error: errorMessage,
		});
	}
}
