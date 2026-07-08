import { logger } from "@zerobyte/core/node";
import { type DoctorResult, type DoctorStep, type RepositoryConfig } from "@zerobyte/core/restic";
import { safeJsonParse } from "@zerobyte/core/utils";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { repoMutex } from "../../../core/repository-mutex";
import { restic } from "../../../core/restic";
import { db } from "../../../db/db";
import type { Repository } from "../../../db/schema";
import { repositoriesTable } from "../../../db/schema";
import { runEffectPromise, toMessage } from "../../../utils/errors";
import type { TaskResult } from "~/schemas/tasks";
import { requestTaskCancel, runTaskLifecycle, TaskCancelledError } from "../../tasks/tasks.lifecycle";
import { taskStore } from "../../tasks/tasks.store";

type DoctorCommandParams = {
	repository: Repository;
};

type DoctorTaskResult = Extract<TaskResult, { kind: "doctor" }>;

const runUnlockStep = async (config: RepositoryConfig, organizationId: string, signal: AbortSignal) => {
	const result = await runEffectPromise(restic.unlock(config, { signal, organizationId })).then(
		(result) => ({ success: true, output: result.message, error: null }),
		(error) => ({ success: false, output: null, error: toMessage(error) }),
	);

	return {
		step: "unlock",
		success: result.success,
		output: result.output,
		error: result.error,
	} satisfies DoctorStep;
};

const runCheckStep = async (config: RepositoryConfig, organizationId: string, signal: AbortSignal) => {
	const result = await runEffectPromise(restic.check(config, { readData: false, signal, organizationId })).then(
		(result) => result,
		(error) => ({ success: false, output: null, error: toMessage(error), hasErrors: true }),
	);

	return {
		step: "check",
		success: result.success,
		output: result.output,
		error: result.error,
	} satisfies DoctorStep;
};

const runRepairIndexStep = async (config: RepositoryConfig, organizationId: string, signal: AbortSignal) => {
	const result = await runEffectPromise(restic.repairIndex(config, { signal, organizationId })).then(
		(result) => ({ success: true, output: result.output, error: null }),
		(error) => ({ success: false, output: null, error: toMessage(error) }),
	);

	return {
		step: "repair_index",
		success: result.success,
		output: result.output,
		error: result.error,
	} satisfies DoctorStep;
};

const parseCheckOutput = (checkOutput: string | null) => {
	const schema = z.object({
		suggest_repair_index: z.boolean(),
		suggest_prune: z.boolean(),
	});
	const parsedJson = safeJsonParse(checkOutput);

	if (parsedJson === null) {
		return null;
	}

	const parsed = schema.safeParse(parsedJson);
	if (!parsed.success) {
		logger.error(`Invalid check output format: ${parsed.error.message}`);
		return null;
	}

	return parsed.data;
};

const checkAbortSignal = (signal: AbortSignal) => {
	if (signal.aborted) {
		throw new TaskCancelledError("Doctor operation cancelled");
	}
};

const determineRepositoryStatus = (steps: DoctorStep[]): "healthy" | "error" => {
	const repairStep = steps.find((step) => step.step === "repair_index");
	if (repairStep) {
		return repairStep.success ? "healthy" : "error";
	}

	const checkStep = steps.find((step) => step.step === "check");
	return checkStep?.success ? "healthy" : "error";
};

const createDoctorResult = (
	steps: DoctorStep[],
	completedAt: number,
	success = steps.every((step) => step.success),
): DoctorResult => {
	return {
		success,
		steps,
		completedAt,
	};
};

const saveDoctorResults = async (
	repositoryId: string,
	repositoryStatus: "healthy" | "error" | "cancelled",
	doctorResult: DoctorResult,
	lastError: string | null,
): Promise<DoctorTaskResult> => {
	const lastChecked = doctorResult.completedAt;

	await db
		.update(repositoriesTable)
		.set({
			status: repositoryStatus,
			lastChecked,
			lastError,
			doctorResult,
		})
		.where(eq(repositoriesTable.id, repositoryId));

	return {
		kind: "doctor",
		repositoryStatus,
		lastChecked,
		lastError,
		doctorResult,
	};
};

const executeDoctor = async (repository: Repository, signal: AbortSignal): Promise<DoctorTaskResult> => {
	const steps: DoctorStep[] = [];

	try {
		const releaseLock = await repoMutex.acquireExclusive(repository.id, "doctor", signal);

		try {
			const unlockStep = await runUnlockStep(repository.config, repository.organizationId, signal);
			steps.push(unlockStep);
			checkAbortSignal(signal);

			const checkStep = await runCheckStep(repository.config, repository.organizationId, signal);
			steps.push(checkStep);
			checkAbortSignal(signal);

			if (parseCheckOutput(checkStep.output)?.suggest_repair_index) {
				const repairStep = await runRepairIndexStep(repository.config, repository.organizationId, signal);
				steps.push(repairStep);
				checkAbortSignal(signal);
			}
		} finally {
			releaseLock();
		}

		const completedAt = Date.now();
		const doctorResult = createDoctorResult(steps, completedAt);
		const repositoryStatus = determineRepositoryStatus(steps);
		const lastError = steps.find((step) => step.error)?.error ?? null;

		return saveDoctorResults(repository.id, repositoryStatus, doctorResult, lastError);
	} catch (error) {
		if (signal.aborted || error instanceof TaskCancelledError) {
			const errorMessage = toMessage(error) || "Doctor operation cancelled";
			const doctorResult = createDoctorResult(steps, Date.now(), false);
			const result = await saveDoctorResults(repository.id, "cancelled", doctorResult, errorMessage);
			throw new TaskCancelledError(errorMessage, result);
		}

		const errorMessage = toMessage(error);
		steps.push({ step: "doctor", success: false, output: null, error: errorMessage });
		const doctorResult = createDoctorResult(steps, Date.now(), false);
		return saveDoctorResults(repository.id, "error", doctorResult, errorMessage);
	}
};

export const cancelDoctorTask = (taskId: string) => {
	return requestTaskCancel(taskId);
};

export const createDoctorCommand = (params: DoctorCommandParams) => {
	return {
		start: () => {
			const task = taskStore.create({
				organizationId: params.repository.organizationId,
				resourceType: "repository",
				resourceId: params.repository.shortId,
				input: {
					kind: "doctor",
					repositoryId: params.repository.shortId,
				},
			});

			void runTaskLifecycle({
				taskId: task.id,
				label: "doctor task",
				onStarted: async () => {
					await db
						.update(repositoriesTable)
						.set({ status: "doctor" })
						.where(eq(repositoriesTable.id, params.repository.id));
				},
				run: (signal) => executeDoctor(params.repository, signal),
			});

			return { taskId: task.id, status: "started" as const };
		},
	};
};
