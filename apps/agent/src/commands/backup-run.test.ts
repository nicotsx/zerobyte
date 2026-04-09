import { afterEach, expect, test, vi } from "vitest";
import { Effect } from "effect";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { parseAgentMessage, type BackupCancelPayload, type BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import * as resticServer from "@zerobyte/core/restic/server";
import { handleBackupCancelCommand } from "./backup-cancel";
import { handleBackupRunCommand } from "./backup-run";
import type { ControllerCommandContext, RunningJob } from "../context";

const createDeferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
};

afterEach(() => {
	vi.restoreAllMocks();
});

test("waits for running-job registration before returning to the processor loop", async () => {
	const outboundMessages: string[] = [];
	const runningJobs = new Map<string, RunningJob>();
	const setRunningJobGate = createDeferred<void>();
	const processorLoopGate = createDeferred<void>();
	const commandCompleted = createDeferred<void>();
	const backupGate = createDeferred<{ exitCode: number; result: null; warningDetails: null }>();
	let registeredAbortController: AbortController | undefined;

	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: () =>
				Effect.async<{ exitCode: number; result: null; warningDetails: null }, never>((resume) => {
					void backupGate.promise.then((result) => {
						resume(Effect.succeed(result));
					});
				}),
		}),
	);

	const context: ControllerCommandContext = {
		getRunningJob: (jobId) => Effect.succeed(runningJobs.get(jobId)),
		setRunningJob: (jobId, job) =>
			Effect.async<void, never>((resume) => {
				void setRunningJobGate.promise.then(() => {
					runningJobs.set(jobId, job);
					registeredAbortController = job.abortController;
					resume(Effect.void);
				});
			}),
		deleteRunningJob: (jobId) =>
			Effect.sync(() => {
				runningJobs.delete(jobId);
			}),
		offerOutbound: (message) =>
			Effect.sync(() => {
				outboundMessages.push(message);
				return true;
			}),
	};

	const runPayload = fromPartial<BackupRunPayload>({
		jobId: "job-1",
		scheduleId: "schedule-1",
		organizationId: "org-1",
		sourcePath: "/tmp/source",
		repositoryConfig: {
			backend: "local",
			path: "/tmp/repository",
		},
		options: {},
		runtime: {
			password: "password",
			cacheDir: "/tmp/restic-cache",
			passFile: "/tmp/restic-pass",
			defaultExcludes: [],
		},
	});
	const cancelPayload = fromPartial<BackupCancelPayload>({
		jobId: "job-1",
		scheduleId: "schedule-1",
	});

	const processorLoopPromise = Effect.runPromise(
		Effect.gen(function* () {
			yield* handleBackupRunCommand(context, runPayload);
			commandCompleted.resolve(undefined);
			yield* Effect.async<void, never>((resume) => {
				void processorLoopGate.promise.then(() => {
					resume(Effect.void);
				});
			});
		}),
	);

	try {
		const returnedBeforeRegistration = await Promise.race([
			commandCompleted.promise.then(() => true),
			new Promise<false>((resolve) => {
				setTimeout(() => resolve(false), 0);
			}),
		]);

		expect(returnedBeforeRegistration).toBe(false);

		setRunningJobGate.resolve(undefined);
		await commandCompleted.promise;

		await Effect.runPromise(handleBackupCancelCommand(context, cancelPayload));
		expect(registeredAbortController?.signal.aborted).toBe(true);

		backupGate.resolve({ exitCode: 0, result: null, warningDetails: null });

		await waitForExpect(() => {
			const cancelledMessage = outboundMessages
				.map((message) => parseAgentMessage(message))
				.find((message) => message?.success && message.data.type === "backup.cancelled");

			expect(cancelledMessage?.success).toBe(true);
			expect(runningJobs.has("job-1")).toBe(false);
		});
	} finally {
		processorLoopGate.resolve(undefined);
		setRunningJobGate.resolve(undefined);
		backupGate.resolve({ exitCode: 0, result: null, warningDetails: null });
		await processorLoopPromise;
	}
});
