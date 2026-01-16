import { eq } from "drizzle-orm";
import { db } from "../../db/db";
import { repositoriesTable } from "../../db/schema";
import { toMessage } from "../../utils/errors";
import { restic } from "../../utils/restic";
import { repoMutex } from "../../core/repository-mutex";
import { type DoctorStep, type DoctorResult, type RepositoryConfig } from "~/schemas/restic";
import { type } from "arktype";
import { serverEvents } from "../../core/events";
import { logger } from "../../utils/logger";

const runUnlockStep = async (config: RepositoryConfig): Promise<DoctorStep> => {
	const result = await restic.unlock(config).then(
		(result) => ({ success: true, message: result.message, error: null }),
		(error) => ({ success: false, message: null, error: toMessage(error) }),
	);

	return {
		step: "unlock",
		success: result.success,
		output: result.message,
		error: result.error,
	};
};

const runCheckStep = async (config: RepositoryConfig): Promise<DoctorStep> => {
	const result = await restic.check(config, { readData: true }).then(
		(result) => result,
		(error) => ({ success: false, output: null, error: toMessage(error), hasErrors: true }),
	);

	return {
		step: "check",
		success: result.success,
		output: result.output,
		error: result.error,
	};
};

const runRepairIndexStep = async (config: RepositoryConfig) => {
	const result = await restic.repairIndex(config).then(
		(result) => ({ success: true, output: result.output, error: null }),
		(error) => ({ success: false, output: null, error: toMessage(error) }),
	);

	return {
		step: "repair_index",
		success: result.success,
		output: result.output,
		error: result.error,
	};
};

const parseCheckOutput = (checkOutput: string | null) => {
	const schema = type({ suggest_repair_index: "boolean", suggest_prune: "boolean" });
	const parsed = schema(JSON.parse(checkOutput ?? "{}"));

	if (parsed instanceof type.errors) {
		logger.error(`Invalid check output format: ${parsed.summary}`);
		return null;
	}

	return parsed;
};

const checkAbortSignal = (signal: AbortSignal | undefined): void => {
	if (signal?.aborted) {
		throw new Error("Doctor operation cancelled");
	}
};

const determineRepositoryStatus = (steps: DoctorStep[]): "healthy" | "error" => {
	const repairStep = steps.find((s) => s.step === "repair_index");
	if (repairStep) {
		return repairStep.success ? "healthy" : "error";
	}

	const checkStep = steps.find((s) => s.step === "check");
	return checkStep?.success ? "healthy" : "error";
};

const saveDoctorResults = async (repositoryId: string, steps: DoctorStep[], finalStatus: "healthy" | "error") => {
	const doctorResult: DoctorResult = {
		success: steps.every((s) => s.success),
		steps,
		completedAt: Date.now(),
	};

	const finalError = steps.find((s) => s.error)?.error ?? null;

	await db
		.update(repositoriesTable)
		.set({
			status: finalStatus,
			lastChecked: Date.now(),
			lastError: finalError,
			doctorResult,
		})
		.where(eq(repositoriesTable.id, repositoryId));
};

export const executeDoctor = async (
	repositoryId: string,
	repositoryConfig: RepositoryConfig,
	repositoryName: string,
	signal: AbortSignal | undefined,
) => {
	const steps: DoctorStep[] = [];

	try {
		const releaseLock = await repoMutex.acquireExclusive(repositoryId, "doctor");

		// Step 1: Unlock repository
		const unlockStep = await runUnlockStep(repositoryConfig);
		steps.push(unlockStep);
		checkAbortSignal(signal);

		// Step 2: Check repository with exclusive lock
		try {
			const checkStep = await runCheckStep(repositoryConfig);
			steps.push(checkStep);
			checkAbortSignal(signal);

			// Step 3: Repair index if suggested
			const checkOutput = parseCheckOutput(checkStep.output);
			if (checkOutput?.suggest_repair_index) {
				const repairStep = await runRepairIndexStep(repositoryConfig);
				steps.push(repairStep);
				checkAbortSignal(signal);
			}
		} finally {
			releaseLock();
		}

		const finalStatus = determineRepositoryStatus(steps);
		await saveDoctorResults(repositoryId, steps, finalStatus);

		serverEvents.emit("doctor:completed", {
			repositoryId,
			repositoryName,
			success: steps.every((s) => s.success),
			steps,
			completedAt: Date.now(),
		});
	} catch (error) {
		await db
			.update(repositoriesTable)
			.set({ status: "error", lastError: toMessage(error) })
			.where(eq(repositoriesTable.id, repositoryId));

		steps.push({ step: "doctor", success: false, output: null, error: toMessage(error) });
		serverEvents.emit("doctor:completed", {
			repositoryId,
			repositoryName,
			success: false,
			steps,
			completedAt: Date.now(),
		});
	}
};
