import { NotFoundError } from "http-errors-enhanced";
import { logger } from "@zerobyte/core/node";
import type { ResticBackupOutputDto } from "@zerobyte/core/restic";
import type { BackupSchedule, Repository, Volume } from "../../../db/schema";
import { cache, cacheKeys } from "../../../utils/cache";
import { toErrorDetails, toMessage } from "../../../utils/errors";
import { notificationsService } from "../../notifications/notifications.service";
import { getOrganizationId } from "~/server/core/request-context";
import { calculateNextRun } from "../backup.helpers";
import { mirrorQueries, scheduleQueries } from "../backups.queries";
import { commands } from "../commands";
import { assertBackupRepositoryCompatibility } from "../backup-context";
import { LOCAL_AGENT_ID } from "../../agents/constants";
import { getActionableTrustedRoot } from "../../volumes/source-discovery";
import { volumeService } from "../../volumes/volume.service";

export interface BackupContext {
	schedule: BackupSchedule;
	volume: Volume;
	repository: Repository;
	organizationId: string;
}

type ValidationSuccess = {
	type: "success";
	context: BackupContext;
};

type ValidationFailure = {
	type: "failure";
	error: Error;
	partialContext?: Partial<BackupContext>;
};

type ValidationSkipped = {
	type: "skipped";
	reason: string;
};

type ValidationResult = ValidationSuccess | ValidationFailure | ValidationSkipped;

export async function validateBackupExecution(scheduleId: number, manual = false): Promise<ValidationResult> {
	const organizationId = getOrganizationId();
	const result = await scheduleQueries.findById(scheduleId, organizationId);

	if (!result) {
		return { type: "failure", error: new NotFoundError("Backup schedule not found") };
	}

	const { volume, repository, ...schedule } = result;

	if (!schedule.enabled && !manual) {
		logger.info(`Backup schedule ${scheduleId} is disabled. Skipping execution.`);
		return { type: "skipped", reason: "Backup schedule is disabled" };
	}

	if (!volume) {
		return {
			type: "failure",
			error: new NotFoundError("Volume not found"),
			partialContext: { schedule },
		};
	}

	if (!repository) {
		return {
			type: "failure",
			error: new NotFoundError("Repository not found"),
			partialContext: { schedule, volume },
		};
	}

	let readyVolume = volume;

	try {
		assertBackupRepositoryCompatibility(volume, repository);
		if (volume.sourceKind === "agent-filesystem" && volume.agentId !== LOCAL_AGENT_ID) {
			const trustedRootId = volume.trustedRootId;
			if (!trustedRootId) {
				throw new Error("Backup source location is incomplete");
			}
			await getActionableTrustedRoot(volume.agentId, trustedRootId, organizationId);
		}
		if (volume.sourceKind === "managed") {
			const readiness = await volumeService.ensureHealthyVolume(volume.shortId);
			if (!readiness.ready) {
				throw new Error(readiness.reason);
			}
			readyVolume = readiness.volume;
		}
	} catch (error) {
		const compatibilityError =
			error instanceof Error ? error : new Error("Backup source and repository are incompatible");
		return {
			type: "failure",
			error: compatibilityError,
			partialContext: { schedule, volume, repository },
		};
	}

	return {
		type: "success",
		context: { schedule, volume: readyVolume, repository, organizationId },
	};
}

export async function handleValidationResult(
	scheduleId: number,
	result: ValidationFailure | ValidationSkipped,
	manual: boolean,
) {
	const organizationId = getOrganizationId();

	if (result.type === "skipped") {
		logger.info(`Backup execution for schedule ${scheduleId} was skipped: ${result.reason}`);
		return;
	}

	await handleBackupFailure(scheduleId, organizationId, result.error, manual, result.partialContext);
}

export function emitBackupStarted(ctx: BackupContext, scheduleId: number) {
	logger.info(
		`Starting backup ${ctx.schedule.name} for volume ${ctx.volume.name} to repository ${ctx.repository.name}`,
	);

	notificationsService
		.sendBackupNotification(scheduleId, "start", {
			volumeName: ctx.volume.name,
			repositoryName: ctx.repository.name,
			scheduleName: ctx.schedule.name,
		})
		.catch((error) => {
			logger.error(`Failed to send backup start notification: ${toMessage(error)}`);
		});
}

export async function startPostBackupMirrorSyncs(
	ctx: BackupContext,
	scheduleId: number,
	result: ResticBackupOutputDto | null,
) {
	const [schedule, mirrors] = await Promise.all([
		scheduleQueries.findById(scheduleId, ctx.organizationId),
		mirrorQueries.findEnabledBySchedule(scheduleId),
	]);
	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}
	if (mirrors.length === 0) {
		return;
	}
	if (!result?.snapshot_id) {
		throw new Error("Completed backup did not return a snapshot ID for mirror synchronization");
	}
	const snapshotIds: [string] = [result.snapshot_id];

	for (const mirror of mirrors) {
		try {
			commands
				.createMirrorSync({
					organizationId: ctx.organizationId,
					scheduleId: schedule.id,
					scheduleShortId: schedule.shortId,
					targetDisplayName: schedule.name,
					sourceRepository: ctx.repository,
					mirrorRepository: mirror.repository,
					retentionPolicy: schedule.retentionPolicy,
					customResticParams: schedule.customResticParams ?? [],
					trigger: "postBackup",
					snapshotIds,
				})
				.start();
		} catch (error) {
			logger.error(
				`Failed to start mirror sync for schedule ${scheduleId} and repository ${mirror.repository.shortId}: ${toMessage(error)}`,
			);
		}
	}
}

export async function finalizeSuccessfulBackup(
	ctx: BackupContext,
	exitCode: number,
	result: ResticBackupOutputDto | null,
	warningDetails: string | null,
) {
	const scheduleId = ctx.schedule.id;
	const finalStatus = exitCode === 0 && !warningDetails ? "success" : "warning";

	cache.delByPrefix(cacheKeys.repository.all(ctx.repository.id));

	await scheduleQueries.updateStatus(scheduleId, ctx.organizationId, {
		lastBackupAt: Date.now(),
		lastBackupStatus: finalStatus,
		lastBackupError: finalStatus === "warning" ? warningDetails : null,
		nextBackupAt: ctx.schedule.cronExpression ? calculateNextRun(ctx.schedule.cronExpression) : null,
		failureRetryCount: 0,
	});

	if (finalStatus === "warning") {
		logger.warn(
			`Backup ${ctx.schedule.name} completed with warnings for volume ${ctx.volume.name} to repository ${ctx.repository.name}`,
		);
	} else {
		logger.info(
			`Backup ${ctx.schedule.name} completed successfully for volume ${ctx.volume.name} to repository ${ctx.repository.name}`,
		);
	}

	notificationsService
		.sendBackupNotification(scheduleId, finalStatus, {
			volumeName: ctx.volume.name,
			repositoryName: ctx.repository.name,
			scheduleName: ctx.schedule.name,
			error: finalStatus === "warning" ? (warningDetails ?? undefined) : undefined,
			summary: result ?? undefined,
		})
		.catch((error) => {
			logger.error(`Failed to send backup success notification: ${toMessage(error)}`);
		});
}

export async function handleBackupFailure(
	scheduleId: number,
	organizationId: string,
	error: unknown,
	manual: boolean,
	partialContext?: Partial<BackupContext>,
) {
	const errorMessage = toMessage(error);
	const errorDetails = toErrorDetails(error);
	const failedAt = Date.now();
	const schedule = partialContext?.schedule;
	const currentRetryCount = schedule?.failureRetryCount ?? 0;
	const maxRetries = schedule?.maxRetries ?? 0;
	const nextRetryBackupAt = schedule ? failedAt + schedule.retryDelay : null;
	const nextScheduledBackupAt = schedule?.cronExpression ? calculateNextRun(schedule.cronExpression) : null;
	const hasRetryRemaining = currentRetryCount < maxRetries;
	const retryPrecedesNextSchedule =
		nextRetryBackupAt !== null && nextScheduledBackupAt !== null && nextRetryBackupAt < nextScheduledBackupAt;
	const shouldRetry = !manual && hasRetryRemaining && retryPrecedesNextSchedule;
	const nextBackupAt = shouldRetry ? nextRetryBackupAt : nextScheduledBackupAt;
	const failureRetryCount = shouldRetry ? currentRetryCount + 1 : 0;
	const shouldUpdateNextBackupAt = Boolean(schedule) && !manual;
	const statusUpdate: Parameters<typeof scheduleQueries.updateStatus>[2] = {
		lastBackupAt: failedAt,
		lastBackupStatus: "error",
		lastBackupError: errorDetails,
	};
	if (shouldUpdateNextBackupAt) {
		statusUpdate.nextBackupAt = nextBackupAt;
	}
	if (schedule) {
		statusUpdate.failureRetryCount = failureRetryCount;
	}

	await scheduleQueries.updateStatus(scheduleId, organizationId, statusUpdate);

	if (!schedule || !partialContext?.volume || !partialContext?.repository) {
		return;
	}

	if (shouldRetry) {
		const delayMinutes = Math.round((schedule.retryDelay / (60 * 1000)) * 10) / 10;

		logger.error(
			`Backup ${schedule.name} failed. Scheduling retry ${currentRetryCount + 1}/${maxRetries} for ${delayMinutes} minutes from now: ${errorMessage}`,
		);

		if (partialContext?.volume && partialContext?.repository) {
			notificationsService
				.sendBackupNotification(scheduleId, "failure", {
					volumeName: partialContext.volume.name,
					repositoryName: partialContext.repository.name,
					scheduleName: schedule.name,
					error: `${errorDetails}\n\nRetrying in ${delayMinutes} minutes (attempt ${currentRetryCount + 1}/${maxRetries})`,
				})
				.catch((notifError) => {
					logger.error(`Failed to send backup failure notification: ${toMessage(notifError)}`);
				});
		}

		return;
	}

	const { volume, repository } = partialContext;

	if (manual) {
		logger.error(
			`Manual backup ${schedule.name} failed for volume ${volume.name} to repository ${repository.name}: ${errorMessage}`,
		);
	} else {
		logger.error(
			`Backup ${schedule.name} failed after ${maxRetries} retries for volume ${volume.name} to repository ${repository.name}: ${errorMessage}`,
		);
	}

	let errorNotificationMessage = `${errorDetails}`;
	if (!manual && currentRetryCount > 0) {
		errorNotificationMessage = `${errorDetails}\n\nFailed after ${currentRetryCount} retry attempts.`;
	}

	notificationsService
		.sendBackupNotification(scheduleId, "failure", {
			volumeName: volume.name,
			repositoryName: repository.name,
			scheduleName: schedule.name,
			error: errorNotificationMessage,
		})
		.catch((notifyError) => {
			logger.error(`Failed to send backup failure notification: ${toMessage(notifyError)}`);
		});
}

export async function handleBackupCancellation(
	scheduleId: number,
	organizationId: string,
	message?: string,
	shouldSetLastBackupAt = true,
) {
	await scheduleQueries.updateStatus(scheduleId, organizationId, {
		lastBackupAt: shouldSetLastBackupAt ? Date.now() : undefined,
		lastBackupStatus: "warning",
		lastBackupError: message ?? "Backup was stopped by the user",
		failureRetryCount: 0,
	});
}
