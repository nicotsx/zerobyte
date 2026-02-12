import { NotFoundError, BadRequestError, ConflictError } from "http-errors-enhanced";
import type { BackupSchedule, Volume, Repository } from "../../db/schema";
import { restic } from "../../utils/restic";
import { logger } from "../../utils/logger";
import { cache } from "../../utils/cache";
import { getVolumePath } from "../volumes/helpers";
import { toMessage } from "../../utils/errors";
import { serverEvents } from "../../core/events";
import { notificationsService } from "../notifications/notifications.service";
import { repoMutex } from "../../core/repository-mutex";
import { getOrganizationId } from "~/server/core/request-context";
import { scheduleQueries, mirrorQueries, repositoryQueries } from "./backups.queries";
import { calculateNextRun, createBackupOptions } from "./backup.helpers";
import type { ResticBackupOutputDto } from "~/schemas/restic-dto";

const runningBackups = new Map<number, AbortController>();

interface BackupContext {
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

const validateBackupExecution = async (scheduleId: number, manual = false): Promise<ValidationResult> => {
	const organizationId = getOrganizationId();
	const result = await scheduleQueries.findById(scheduleId, organizationId);

	if (!result) {
		return { type: "failure", error: new NotFoundError("Backup schedule not found") };
	}

	const { volume, repository, ...schedule } = result;

	if (!schedule) {
		return { type: "failure", error: new NotFoundError("Backup schedule not found") };
	}

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
};

const emitBackupStarted = (ctx: BackupContext, scheduleId: number) => {
	logger.info(
		`Starting backup ${ctx.schedule.name} for volume ${ctx.volume.name} to repository ${ctx.repository.name}`,
	);

	serverEvents.emit("backup:started", {
		organizationId: ctx.organizationId,
		scheduleId,
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
};

const runBackupOperation = async (ctx: BackupContext, signal: AbortSignal) => {
	const volumePath = getVolumePath(ctx.volume);
	const backupOptions = createBackupOptions(ctx.schedule, volumePath, signal);

	const releaseBackupLock = await repoMutex.acquireShared(ctx.repository.id, `backup:${ctx.volume.name}`, signal);

	try {
		const result = await restic.backup(ctx.repository.config, volumePath, {
			...backupOptions,
			compressionMode: ctx.repository.compressionMode ?? "auto",
			organizationId: ctx.organizationId,
			onProgress: (progress) => {
				serverEvents.emit("backup:progress", {
					organizationId: ctx.organizationId,
					scheduleId: ctx.schedule.id,
					volumeName: ctx.volume.name,
					repositoryName: ctx.repository.name,
					...progress,
				});
			},
		});
		return result;
	} finally {
		releaseBackupLock();
	}
};

const buildBackupSummary = (result: ResticBackupOutputDto | null | undefined) => {
	if (!result) return undefined;
	return result;
};

const finalizeSuccessfulBackup = async (
	ctx: BackupContext,
	scheduleId: number,
	exitCode: number,
	result: ResticBackupOutputDto | null,
) => {
	const finalStatus = exitCode === 0 ? "success" : "warning";
	const summary = buildBackupSummary(result);

	if (ctx.schedule.retentionPolicy) {
		void runForget(scheduleId).catch((error) => {
			logger.error(`Failed to run retention policy for schedule ${scheduleId}: ${toMessage(error)}`);
		});
	}

	void copyToMirrors(scheduleId, ctx.repository, ctx.schedule.retentionPolicy).catch((error) => {
		logger.error(`Background mirror copy failed for schedule ${scheduleId}: ${toMessage(error)}`);
	});

	cache.delByPrefix(`snapshots:${ctx.repository.id}:`);
	cache.del(`retention:${ctx.schedule.shortId}`);

	const nextBackupAt = calculateNextRun(ctx.schedule.cronExpression);
	await scheduleQueries.updateStatus(scheduleId, ctx.organizationId, {
		lastBackupAt: Date.now(),
		lastBackupStatus: finalStatus,
		lastBackupError: null,
		nextBackupAt,
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
		scheduleId,
		volumeName: ctx.volume.name,
		repositoryName: ctx.repository.name,
		status: finalStatus,
		summary,
	});

	notificationsService
		.sendBackupNotification(scheduleId, finalStatus, {
			volumeName: ctx.volume.name,
			repositoryName: ctx.repository.name,
			scheduleName: ctx.schedule.name,
			summary,
		})
		.catch((error) => {
			logger.error(`Failed to send backup success notification: ${toMessage(error)}`);
		});
};

const handleValidationResult = async (scheduleId: number, result: ValidationFailure | ValidationSkipped) => {
	const organizationId = getOrganizationId();

	if (result.type === "skipped") {
		logger.info(`Backup execution for schedule ${scheduleId} was skipped: ${result.reason}`);
		return;
	}

	await handleBackupFailure(scheduleId, organizationId, result.error, result.partialContext);
};

const handleBackupFailure = async (
	scheduleId: number,
	organizationId: string,
	error: unknown,
	partialContext?: Partial<BackupContext>,
): Promise<void> => {
	const errorMessage = toMessage(error);

	await scheduleQueries.updateStatus(scheduleId, organizationId, {
		lastBackupAt: Date.now(),
		lastBackupStatus: "error",
		lastBackupError: errorMessage,
	});

	if (partialContext?.schedule && partialContext?.volume && partialContext?.repository) {
		const ctx = partialContext as BackupContext;

		logger.error(
			`Backup ${ctx.schedule.name} failed for volume ${ctx.volume.name} to repository ${ctx.repository.name}: ${errorMessage}`,
		);

		serverEvents.emit("backup:completed", {
			organizationId,
			scheduleId,
			volumeName: ctx.volume.name,
			repositoryName: ctx.repository.name,
			status: "error",
		});

		notificationsService
			.sendBackupNotification(scheduleId, "failure", {
				volumeName: ctx.volume.name,
				repositoryName: ctx.repository.name,
				scheduleName: ctx.schedule.name,
				error: errorMessage,
			})
			.catch((notifError) => {
				logger.error(`Failed to send backup failure notification: ${toMessage(notifError)}`);
			});
	}
};

const executeBackup = async (scheduleId: number, manual = false): Promise<void> => {
	const result = await validateBackupExecution(scheduleId, manual);

	if (result.type !== "success") {
		return handleValidationResult(scheduleId, result);
	}

	const { context: ctx } = result;
	emitBackupStarted(ctx, scheduleId);

	const nextBackupAt = calculateNextRun(ctx.schedule.cronExpression);

	await scheduleQueries.updateStatus(scheduleId, ctx.organizationId, {
		lastBackupStatus: "in_progress",
		lastBackupError: null,
		nextBackupAt,
	});

	const abortController = new AbortController();
	runningBackups.set(scheduleId, abortController);

	try {
		const backupResult = await runBackupOperation(ctx, abortController.signal);
		await finalizeSuccessfulBackup(ctx, scheduleId, backupResult.exitCode, backupResult.result);
	} catch (error) {
		await handleBackupFailure(scheduleId, ctx.organizationId, error, ctx);
	} finally {
		runningBackups.delete(scheduleId);
	}
};

const getSchedulesToExecute = async () => {
	const organizationId = getOrganizationId();
	return scheduleQueries.findExecutable(organizationId);
};

const stopBackup = async (scheduleId: number) => {
	const organizationId = getOrganizationId();
	const schedule = await scheduleQueries.findById(scheduleId, organizationId);

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	try {
		const abortController = runningBackups.get(scheduleId);
		if (!abortController) {
			throw new ConflictError("No backup is currently running for this schedule");
		}

		logger.info(`Stopping backup for schedule ${scheduleId}`);
		abortController.abort();
	} finally {
		await scheduleQueries.updateStatus(scheduleId, organizationId, {
			lastBackupStatus: "warning",
			lastBackupError: "Backup was stopped by user",
		});
	}
};

const runForget = async (scheduleId: number, repositoryId?: string) => {
	const organizationId = getOrganizationId();
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
		cache.delByPrefix(`snapshots:${repository.id}:`);
		cache.del(`retention:${schedule.shortId}`);
	} finally {
		releaseLock();
	}

	logger.info(`Retention policy applied successfully for schedule ${scheduleId}`);
};

const copyToMirrors = async (
	scheduleId: number,
	sourceRepository: Repository,
	retentionPolicy: BackupSchedule["retentionPolicy"],
) => {
	const organizationId = getOrganizationId();
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
};

const copyToSingleMirror = async (
	scheduleId: number,
	schedule: BackupSchedule,
	sourceRepository: Repository,
	mirror: {
		id: number;
		repositoryId: string;
		repository: Repository;
	},
	retentionPolicy: BackupSchedule["retentionPolicy"],
	organizationId: string,
) => {
	try {
		logger.info(`[Background] Copying to mirror repository: ${mirror.repository.name}`);

		serverEvents.emit("mirror:started", {
			organizationId,
			scheduleId,
			repositoryId: mirror.repositoryId,
			repositoryName: mirror.repository.name,
		});

		const releaseSource = await repoMutex.acquireShared(sourceRepository.id, `mirror_source:${scheduleId}`);
		const releaseMirror = await repoMutex.acquireShared(mirror.repository.id, `mirror:${scheduleId}`);

		try {
			await restic.copy(sourceRepository.config, mirror.repository.config, { tag: schedule.shortId, organizationId });
			cache.delByPrefix(`snapshots:${mirror.repository.id}:`);
		} finally {
			releaseSource();
			releaseMirror();
		}

		if (retentionPolicy) {
			void runForget(scheduleId, mirror.repository.id).catch((error) => {
				logger.error(
					`Failed to run retention policy for mirror repository ${mirror.repository.name}: ${toMessage(error)}`,
				);
			});
		}

		await mirrorQueries.updateStatus(mirror.id, {
			lastCopyAt: Date.now(),
			lastCopyStatus: "success",
			lastCopyError: null,
		});

		logger.info(`[Background] Successfully copied to mirror repository: ${mirror.repository.name}`);

		serverEvents.emit("mirror:completed", {
			organizationId,
			scheduleId,
			repositoryId: mirror.repositoryId,
			repositoryName: mirror.repository.name,
			status: "success",
		});
	} catch (error) {
		const errorMessage = toMessage(error);
		logger.error(`[Background] Failed to copy to mirror repository ${mirror.repository.name}: ${errorMessage}`);

		await mirrorQueries.updateStatus(mirror.id, {
			lastCopyAt: Date.now(),
			lastCopyStatus: "error",
			lastCopyError: errorMessage,
		});

		serverEvents.emit("mirror:completed", {
			organizationId,
			scheduleId,
			repositoryId: mirror.repositoryId,
			repositoryName: mirror.repository.name,
			status: "error",
			error: errorMessage,
		});
	}
};

export const backupsExecutionService = {
	executeBackup,
	validateBackupExecution,
	getSchedulesToExecute,
	stopBackup,
	runForget,
	copyToMirrors,
};
