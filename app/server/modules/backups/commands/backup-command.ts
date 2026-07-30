import { logger } from "@zerobyte/core/node";
import { ConflictError } from "http-errors-enhanced";
import type { TaskResult } from "~/schemas/tasks";
import type { BackupExecutionProgress } from "../../agents/agents-manager";
import { repoMutex } from "../../../core/repository-mutex";
import { toMessage } from "../../../utils/errors";
import { createTaskProgressBuffer } from "../../tasks/progress-buffer";
import { runTaskLifecycle, TaskCancelledError, TaskFailedError } from "../../tasks/tasks.lifecycle";
import { taskStore } from "../../tasks/tasks.store";
import { backupExecutor } from "../backup-executor";
import { calculateNextRun } from "../backup.helpers";
import { scheduleQueries } from "../backups.queries";
import type { BackupContext } from "../helpers/backup-lifecycle";
import {
	emitBackupStarted,
	finalizeSuccessfulBackup,
	handleBackupCancellation,
	handleBackupFailure,
	startPostBackupMirrorSyncs,
} from "../helpers/backup-lifecycle";

type BackupCommandParams = {
	context: BackupContext;
	manual: boolean;
};

type BackupTaskResult = Extract<TaskResult, { kind: "backup" }>;

const executeBackup = async (
	params: BackupCommandParams,
	taskId: string,
	signal: AbortSignal,
	onProgress: (progress: BackupExecutionProgress) => void,
): Promise<BackupTaskResult> => {
	const { context: ctx } = params;
	const executionResult = await backupExecutor.execute({
		jobId: taskId,
		scheduleId: ctx.schedule.id,
		schedule: ctx.schedule,
		volume: ctx.volume,
		repository: ctx.repository,
		organizationId: ctx.organizationId,
		signal,
		onProgress,
	});

	switch (executionResult.status) {
		case "unavailable": {
			if (signal.aborted) {
				throw signal.reason;
			}
			throw new TaskFailedError(toMessage(executionResult.error));
		}
		case "failed":
			throw new TaskFailedError(toMessage(executionResult.error));
		case "cancelled": {
			if (signal.aborted) {
				throw signal.reason;
			}
			throw new TaskCancelledError(executionResult.message ?? "Backup was stopped by the user");
		}
		case "completed": {
			await finalizeSuccessfulBackup(
				ctx,
				executionResult.exitCode,
				executionResult.result,
				executionResult.warningDetails,
			);
			await startPostBackupMirrorSyncs(ctx, ctx.schedule.id, executionResult.result).catch((error) => {
				logger.error(
					`Post-backup mirror synchronization failed for schedule ${ctx.schedule.id}: ${toMessage(error)}`,
				);
			});

			return {
				kind: "backup",
				exitCode: executionResult.exitCode,
				result: executionResult.result,
				warningDetails: executionResult.warningDetails,
			};
		}
	}
};

export const createBackupCommand = (params: BackupCommandParams) => {
	return {
		start: () => {
			const { context: ctx, manual } = params;
			const scheduleId = ctx.schedule.id;
			const scheduleShortId = ctx.schedule.shortId;

			const nextBackupAt = ctx.schedule.cronExpression
				? calculateNextRun(ctx.schedule.cronExpression)
				: undefined;

			const taskResource = {
				organizationId: ctx.organizationId,
				kind: "backup" as const,
				resourceType: "backup_schedule" as const,
				resourceId: scheduleShortId,
			};

			if (taskStore.findActiveByResource(taskResource)) {
				throw new ConflictError("Backup is already running for this schedule");
			}

			const task = taskStore.create({
				organizationId: ctx.organizationId,
				resourceType: "backup_schedule",
				resourceId: scheduleShortId,
				targetDisplayName: ctx.schedule.name,
				targetAgentId: ctx.volume.agentId,
				input: {
					kind: "backup",
					scheduleId,
					scheduleShortId,
					manual,
				},
			});

			const progressBuffer = createTaskProgressBuffer(task.id, {
				intervalMs: 500,
				onError: (error) => {
					logger.error(`Failed to persist backup task progress for ${task.id}: ${toMessage(error)}`);
				},
			});

			const scheduleStatusUpdate = scheduleQueries.updateStatus(scheduleId, ctx.organizationId, {
				lastBackupStatus: "in_progress",
				lastBackupError: null,
				nextBackupAt,
			});

			void runTaskLifecycle({
				taskId: task.id,
				label: "backup task",
				cancellable: true,
				prepare: async (signal) => {
					await scheduleStatusUpdate;
					return repoMutex.acquireShared(ctx.repository.id, `backup:${ctx.volume.name}`, signal);
				},
				onStarted: () => {
					emitBackupStarted(ctx, scheduleId);
				},
				run: async (signal) => {
					const onProgress = (progress: BackupExecutionProgress) => {
						progressBuffer.update({ kind: "backup", progress });
					};

					try {
						return await executeBackup(params, task.id, signal, onProgress);
					} finally {
						progressBuffer.flush();
					}
				},
				beforeFail: async (errorMessage) => {
					await handleBackupFailure(scheduleId, ctx.organizationId, errorMessage, manual, ctx);
				},
				beforeCancel: async (errorMessage) => {
					await handleBackupCancellation(scheduleId, ctx.organizationId, errorMessage);
				},
			}).finally(() => {
				progressBuffer.dispose();
			});

			return { taskId: task.id, status: "started" as const };
		},
	};
};
