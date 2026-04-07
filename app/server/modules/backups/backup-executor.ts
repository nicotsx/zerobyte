import { Effect } from "effect";
import { restic } from "../../core/restic";
import type { BackupSchedule, Repository, Volume } from "../../db/schema";
import type { ResticBackupOutputDto, ResticBackupProgressDto } from "@zerobyte/core/restic";
import { createBackupOptions } from "./backup.helpers";
import { getVolumePath } from "../volumes/helpers";

type BackupExecutionRequest = {
	scheduleId: number;
	schedule: BackupSchedule;
	volume: Volume;
	repository: Repository;
	organizationId: string;
	signal: AbortSignal;
	onProgress: (progress: BackupExecutionProgress) => void;
};

export type BackupExecutionProgress = ResticBackupProgressDto;

export type BackupExecutionResult =
	| {
			status: "unavailable";
			error: Error;
	  }
	| {
			status: "completed";
			exitCode: number;
			result: ResticBackupOutputDto | null;
			warningDetails: string | null;
	  }
	| {
			status: "failed";
			error: unknown;
	  }
	| {
			status: "cancelled";
			message?: string;
	  };

const activeControllersByScheduleId = new Map<number, AbortController>();

export const backupExecutor = {
	track: (scheduleId: number) => {
		const abortController = new AbortController();
		activeControllersByScheduleId.set(scheduleId, abortController);
		return abortController;
	},
	untrack: (scheduleId: number, abortController: AbortController) => {
		if (activeControllersByScheduleId.get(scheduleId) === abortController) {
			activeControllersByScheduleId.delete(scheduleId);
		}
	},
	execute: async (params: BackupExecutionRequest): Promise<BackupExecutionResult> => {
		const { schedule, volume, repository, organizationId, signal, onProgress } = params;
		try {
			const volumePath = getVolumePath(volume);
			const backupOptions = createBackupOptions(schedule, volumePath, signal);

			const result = await Effect.runPromise(
				restic.backup(repository.config, volumePath, {
					...backupOptions,
					compressionMode: repository.compressionMode ?? "auto",
					organizationId,
					onProgress,
				}),
			);

			return {
				status: "completed",
				exitCode: result.exitCode,
				result: result.result,
				warningDetails: result.warningDetails,
			} satisfies BackupExecutionResult;
		} catch (error) {
			return {
				status: "failed",
				error,
			} satisfies BackupExecutionResult;
		}
	},
	cancel: (scheduleId: number) => {
		const abortController = activeControllersByScheduleId.get(scheduleId);
		if (!abortController) {
			return false;
		}

		abortController.abort();
		return true;
	},
};
