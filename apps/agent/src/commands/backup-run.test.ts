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
	vi.unstubAllGlobals();
});

const createRunPayload = (overrides: Partial<BackupRunPayload> = {}) =>
	fromPartial<BackupRunPayload>({
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
			rcloneConfigFile: "/tmp/rclone.conf",
		},
		webhooks: { pre: null, post: null },
		...overrides,
	});

const runBackupCommand = async (payload: BackupRunPayload) => {
	const outboundMessages: string[] = [];
	const runningJobs = new Map<string, RunningJob>();

	const context: ControllerCommandContext = {
		getRunningJob: (jobId) => Effect.succeed(runningJobs.get(jobId)),
		setRunningJob: (jobId, job) =>
			Effect.sync(() => {
				runningJobs.set(jobId, job);
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

	await Effect.runPromise(
		Effect.gen(function* () {
			yield* handleBackupRunCommand(context, payload);
			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.has(payload.jobId)).toBe(false);
				}),
			);
		}),
	);

	return outboundMessages.map((message) => parseAgentMessage(message));
};

test("runs pre and post backup webhooks around restic", async () => {
	const events: string[] = [];

	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: URL, init: RequestInit) => {
			const body = JSON.parse(String(init.body)) as { event: string };
			events.push(body.event);
			return new Response(null, { status: 204 });
		}),
	);

	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: () =>
				Effect.sync(() => {
					events.push("restic");
					return { exitCode: 0, result: null, warningDetails: null };
				}),
		}),
	);

	const messages = await runBackupCommand(
		createRunPayload({
			webhooks: {
				pre: { url: "http://localhost:8080/pre" },
				post: { url: "http://localhost:8080/post" },
			},
		}),
	);

	expect(events).toEqual(["backup.pre", "restic", "backup.post"]);
	expect(messages.some((message) => message?.success && message.data.type === "backup.completed")).toBe(true);
});

test("sends configured webhook headers and body without changing them", async () => {
	const requests: Array<{ url: string; headers: Headers; body: string }> = [];

	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: URL, init: RequestInit) => {
			requests.push({
				url: url.toString(),
				headers: new Headers(init.headers),
				body: String(init.body),
			});
			return new Response(null, { status: 204 });
		}),
	);

	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: () => Effect.succeed({ exitCode: 0, result: null, warningDetails: null }),
		}),
	);

	await runBackupCommand(
		createRunPayload({
			webhooks: {
				pre: {
					url: "http://localhost:8080/pre",
					headers: ["authorization: Bearer pre-token", "content-type: application/json"],
					body: '{"action":"stop"}',
				},
				post: {
					url: "http://localhost:8080/post",
					headers: ["authorization: Bearer post-token"],
					body: "start-container",
				},
			},
		}),
	);

	expect(requests).toHaveLength(2);
	expect(requests[0]?.url).toBe("http://localhost:8080/pre");
	expect(requests[0]?.headers.get("authorization")).toBe("Bearer pre-token");
	expect(requests[0]?.headers.get("content-type")).toBe("application/json");
	expect(requests[0]?.body).toBe('{"action":"stop"}');
	expect(requests[1]?.url).toBe("http://localhost:8080/post");
	expect(requests[1]?.headers.get("authorization")).toBe("Bearer post-token");
	expect(requests[1]?.body).toBe("start-container");
});

test("fails without running restic when the pre-backup webhook fails", async () => {
	const backupMock = vi.fn();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("stop failed", { status: 500 })),
	);
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: backupMock,
		}),
	);

	const messages = await runBackupCommand(
		createRunPayload({
			webhooks: {
				pre: { url: "http://localhost:8080/pre" },
				post: null,
			},
		}),
	);

	const failed = messages.find((message) => message?.success && message.data.type === "backup.failed");
	expect(backupMock).not.toHaveBeenCalled();
	expect(failed?.success).toBe(true);
	if (failed?.success && failed.data.type === "backup.failed") {
		expect(failed.data.payload.errorDetails).toContain("Pre-backup webhook returned HTTP 500");
	}
});

test("reports a post-backup webhook failure as completed warning details", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("start failed", { status: 500 })),
	);
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: () => Effect.succeed({ exitCode: 0, result: null, warningDetails: null }),
		}),
	);

	const messages = await runBackupCommand(
		createRunPayload({
			webhooks: {
				pre: null,
				post: { url: "http://localhost:8080/post" },
			},
		}),
	);

	const completed = messages.find((message) => message?.success && message.data.type === "backup.completed");
	expect(completed?.success).toBe(true);
	if (completed?.success && completed.data.type === "backup.completed") {
		expect(completed.data.payload.warningDetails).toContain("Post-backup webhook returned HTTP 500");
	}
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
		webhooks: { pre: null, post: null },
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
