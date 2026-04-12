import { BadRequestError, NotFoundError } from "http-errors-enhanced";
import { logger } from "@zerobyte/core/node";
import type { ResticBackupOutputDto } from "@zerobyte/core/restic";
import type { BackupSchedule, Repository, Volume } from "../../../db/schema";
import { serverEvents } from "../../../core/events";
import { cache, cacheKeys } from "../../../utils/cache";
import { toErrorDetails, toMessage } from "../../../utils/errors";
import { notificationsService } from "../../notifications/notifications.service";
import { getOrganizationId } from "~/server/core/request-context";
import type { BackupProgressEventDto } from "~/schemas/events-dto";
import { calculateNextRun } from "../backup.helpers";
import { scheduleQueries } from "../backups.queries";
import type { BackupExecutionProgress } from "../../agents/agents-manager";
import { repositoriesService } from "../../repositories/repositories.service";
import { copyToMirrors, runForget } from "./backup-maintenance";

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

export type ValidationResult = ValidationSuccess | ValidationFailure | ValidationSkipped;

export function getBackupProgress(scheduleId: number): BackupProgressEventDto | undefined {
	return cache.get<BackupProgressEventDto>(cacheKeys.backup.progress(scheduleId));
}

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

	if (schedule.lastBackupStatus === "in_progress") {
		logger.info(`Backup schedule ${scheduleId} is already in progress. Skipping execution.`);
		return { type: "skipped", reason: "Backup is already in progress" };
	}

	if (!volume) {
		return { type: "failure", error: new NotFoundError("Volume not found"), partialContext: { schedule } };
	}

	if (!repository) {
		return { type: "failure", error: new NotFoundError("Repository not found"), partialContext: { schedule, volume } };
	}

	if (volume.status !== "mounted") {
		return {
			type: "failure",
			error: new BadRequestError("Volume is not mounted"),
			partialContext: { schedule, volume, repository },
		};
	}

	return {
		type: "success",
		context: { schedule, volume, repository, organizationId },
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

	serverEvents.emit("backup:started", {
		organizationId: ctx.organizationId,
		scheduleId: ctx.schedule.shortId,
		volumeName: ctx.volume.name,
		repositoryName: ctx.repository.name,
	});

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

export function updateBackupProgress(ctx: BackupContext, progress: BackupExecutionProgress) {
	const progressEvent = {
		scheduleId: ctx.schedule.shortId,
		volumeName: ctx.volume.name,
		repositoryName: ctx.repository.name,
		...progress,
	};

	cache.set(cacheKeys.backup.progress(ctx.schedule.id), progressEvent, 60 * 60);

	serverEvents.emit("backup:progress", {
		organizationId: ctx.organizationId,
		...progressEvent,
	});
}

export async function finalizeSuccessfulBackup(
	ctx: BackupContext,
	exitCode: number,
	result: ResticBackupOutputDto | null,
	warningDetails: string | null,
) {
	const scheduleId = ctx.schedule.id;
	const finalStatus = exitCode === 0 ? "success" : "warning";

	if (ctx.schedule.retentionPolicy) {
		void runForget(scheduleId, undefined, ctx.organizationId).catch((error) => {
			logger.error(`Failed to run retention policy for schedule ${scheduleId}: ${toMessage(error)}`);
		});
	}

	void copyToMirrors(scheduleId, ctx.repository, ctx.schedule.retentionPolicy, ctx.organizationId).catch((error) => {
		logger.error(`Background mirror copy failed for schedule ${scheduleId}: ${toMessage(error)}`);
	});

	cache.delByPrefix(cacheKeys.repository.all(ctx.repository.id));

	void repositoriesService.refreshRepositoryStats(ctx.repository.shortId).catch((error) => {
		logger.error(
			`Background repository stats refresh failed for schedule ${scheduleId} (${ctx.repository.shortId}): ${toMessage(error)}`,
		);
	});

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

	serverEvents.emit("backup:completed", {
		organizationId: ctx.organizationId,
		scheduleId: ctx.schedule.shortId,
		volumeName: ctx.volume.name,
		repositoryName: ctx.repository.name,
		status: finalStatus,
		summary: result ?? undefined,
	});

	notificationsService
		.sendBackupNotification(scheduleId, finalStatus, {
			volumeName: ctx.volume.name,
			repositoryName: ctx.repository.name,
			scheduleName: ctx.schedule.name,
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

	await scheduleQueries.updateStatus(scheduleId, organizationId, {
		lastBackupAt: Date.now(),
		lastBackupStatus: "error",
		lastBackupError: errorDetails,
	});

	if (!partialContext?.schedule || !partialContext?.volume || !partialContext?.repository) {
		return;
	}

	// Determine if the backup should be retried
	const schedule = partialContext.schedule;
	const currentRetryCount = schedule.failureRetryCount;
	const maxRetries = schedule.maxRetries;
	const shouldRetry = currentRetryCount < maxRetries;
	const nextRetryBackupAt = Date.now() + schedule.retryDelay;
	const nextScheduledBackupAt = schedule.cronExpression ? calculateNextRun(schedule.cronExpression) : null;

	if (!manual && shouldRetry && nextScheduledBackupAt && nextRetryBackupAt < nextScheduledBackupAt) {
		await scheduleQueries.updateStatus(scheduleId, organizationId, {
			nextBackupAt: nextRetryBackupAt,
			failureRetryCount: currentRetryCount + 1,
		});

		const delayMinutes = Math.round((schedule.retryDelay / (60 * 1000)) * 10) / 10;

		logger.error(
			`Backup ${schedule.name} failed. Scheduling retry ${currentRetryCount + 1}/${maxRetries} for ${delayMinutes} minutes from now: ${errorMessage}`,
		);

		if (partialContext?.volume && partialContext?.repository) {
			serverEvents.emit("backup:completed", {
				organizationId,
				scheduleId: schedule.shortId,
				volumeName: partialContext.volume.name,
				repositoryName: partialContext.repository.name,
				status: "error",
			});

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

	await scheduleQueries.updateStatus(scheduleId, organizationId, {
		failureRetryCount: 0,
	});

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

	serverEvents.emit("backup:completed", {
		organizationId,
		scheduleId: schedule.shortId,
		volumeName: volume.name,
		repositoryName: repository.name,
		status: "error",
	});

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
