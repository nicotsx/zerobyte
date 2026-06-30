import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { parseAgentMessage, type RestoreRunPayload } from "@zerobyte/contracts/agent-protocol";
import * as resticServer from "@zerobyte/core/restic/server";
import { handleRestoreCancelCommand } from "../restore-cancel";
import { handleRestoreRunCommand } from "../restore";
import type { ControllerCommandContext, RunningJob } from "../../context";

afterEach(() => {
	vi.restoreAllMocks();
});

const createRunPayload = (overrides: Partial<RestoreRunPayload> = {}) =>
	fromPartial<RestoreRunPayload>({
		restoreId: "restore-1",
		organizationId: "org-1",
		repositoryId: "repo-1",
		snapshotId: "snapshot-1",
		snapshotPaths: [`${process.cwd()}/source`],
		repositoryConfig: { backend: "local", path: "/tmp/repository" },
		runtime: { password: "password" },
		request: { location: { kind: "custom", targetPath: `${process.cwd()}/restore-target` } },
		...overrides,
	});

const createContext = () => {
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

	return { context, runningJobs, messages: () => outboundMessages.map((message) => parseAgentMessage(message)) };
};

test("forks restore execution and emits lifecycle events", async () => {
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			restore: () =>
				Effect.succeed({
					message_type: "summary" as const,
					files_restored: 2,
					files_skipped: 1,
					bytes_skipped: 0,
				}),
		}),
	);
	const payload = createRunPayload();
	const { context, runningJobs, messages } = createContext();

	await Effect.runPromise(
		Effect.gen(function* () {
			yield* handleRestoreRunCommand(context, payload);
			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.has(payload.restoreId)).toBe(false);
				}),
			);
		}),
	);

	expect(messages().flatMap((message) => (message?.success ? [message.data.type] : []))).toEqual([
		"restore.started",
		"restore.completed",
	]);
});

test("cancels a running restore with the shared running job registry", async () => {
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			restore: (_config: unknown, _snapshotId: string, _target: string, options: { signal?: AbortSignal }) =>
				Effect.tryPromise(
					() =>
						new Promise<never>((_resolve, reject) => {
							options.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
								once: true,
							});
						}),
				),
		}),
	);
	const payload = createRunPayload();
	const { context, runningJobs, messages } = createContext();

	await Effect.runPromise(
		Effect.gen(function* () {
			yield* handleRestoreRunCommand(context, payload);
			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.get(payload.restoreId)?.kind).toBe("restore");
				}),
			);

			yield* handleRestoreCancelCommand(context, { restoreId: payload.restoreId });

			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.has(payload.restoreId)).toBe(false);
					expect(
						messages().some((message) => message?.success && message.data.type === "restore.cancelled"),
					).toBe(true);
				}),
			);
		}),
	);
});
