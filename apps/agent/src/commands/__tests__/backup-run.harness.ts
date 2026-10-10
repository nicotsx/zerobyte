import { Effect } from "effect";
import { expect } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { parseAgentMessage, type BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { handleBackupRunCommand } from "../backup-run";
import type { ControllerCommandContext, RunningJob } from "../../context";
import { createTrustedRootRegistry } from "../../trusted-roots";

export const createRunPayload = (overrides: Partial<BackupRunPayload> = {}) =>
	fromPartial<BackupRunPayload>({
		jobId: "job-1",
		scheduleId: "schedule-1",
		organizationId: "org-1",
		source: { rootId: "local-filesystem", relativePath: "tmp" },
		repositoryConfig: {
			backend: "local",
			path: "/tmp/repository",
		},
		options: {
			oneFileSystem: false,
			excludePatterns: null,
			excludeIfPresent: null,
			includePaths: null,
			includePatterns: null,
			customResticParams: null,
			compressionMode: "auto",
		},
		runtime: {
			password: "password",
		},
		webhooks: { pre: null, post: null },
		webhookAllowedOrigins: [],
		webhookTimeoutMs: 60_000,
		...overrides,
	});

export const runBackupCommand = async (
	payload: BackupRunPayload,
	trustedRoots = createTrustedRootRegistry({ builtinLocal: true }),
	runningJobs = new Map<string, RunningJob>(),
	cancelOnStart = false,
) => {
	const outboundMessages: string[] = [];
	const messagesAtCleanup: string[] = [];

	const context: ControllerCommandContext = {
		allowRestore: true,
		trustedRoots,
		getRunningJob: (jobId) => Effect.succeed(runningJobs.get(jobId)),
		setRunningJob: (jobId, job) =>
			Effect.sync(() => {
				runningJobs.set(jobId, job);
			}),
		deleteRunningJob: (jobId) =>
			Effect.sync(() => {
				messagesAtCleanup.push(...outboundMessages);
				runningJobs.delete(jobId);
			}),
		offerOutbound: (message) =>
			Effect.sync(() => {
				outboundMessages.push(message);

				const parsed = parseAgentMessage(message);
				if (cancelOnStart && parsed?.success && parsed.data.type === "backup.started") {
					runningJobs.get(payload.jobId)?.abortController.abort();
				}

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

	return messagesAtCleanup.map((message) => parseAgentMessage(message));
};
