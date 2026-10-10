import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { createControllerMessage, parseControllerMessage, parseAgentMessage } from "@zerobyte/contracts/agent-protocol";
import * as node from "@zerobyte/core/node";
import { config } from "~/server/core/config";
import { withContext } from "~/server/core/request-context";
import { agentManager, type BackupExecutionResult } from "~/server/modules/agents/agents-manager";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { generateBackupOutput } from "~/test/helpers/restic";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import { handleBackupRunCommand } from "../../../../../apps/agent/src/commands/backup-run";
import { createTrustedRootRegistry } from "../../../../../apps/agent/src/trusted-roots";
import type { ControllerCommandContext, RunningJob } from "../../../../../apps/agent/src/context";
import { backupExecutor } from "../backup-executor";

afterEach(() => {
	vi.restoreAllMocks();
});

test.each([
	{ runtime: "desktop" as const, allowed: false, pre: true, completed: true },
	{ runtime: "server" as const, allowed: false, pre: true, completed: false },
	{ runtime: "server" as const, allowed: true, pre: true, completed: true },
	{ runtime: "server" as const, allowed: false, pre: false, completed: true },
])(
	"$runtime backup executes webhooks according to its origin policy (allowlisted: $allowed, prehook: $pre)",
	async ({ runtime, allowed, pre, completed }) => {
		const actions: string[] = [];
		const webhookServer = createServer(async (request, response) => {
			for await (const _chunk of request) {
			}
			actions.push(request.url ?? "");
			response.writeHead(204);
			response.end();
		});
		await new Promise<void>((resolve) => {
			webhookServer.listen(0, "127.0.0.1", resolve);
		});
		const address = webhookServer.address();
		if (!address || typeof address === "string") throw new Error("Expected webhook server address");
		const origin = `http://127.0.0.1:${address.port}`;

		vi.spyOn(config, "runtime", "get").mockReturnValue(runtime);
		vi.spyOn(config, "webhookAllowedOrigins", "get").mockReturnValue(allowed ? [origin] : []);
		vi.spyOn(node, "safeSpawn").mockImplementation(async () => {
			actions.push("backup");
			return { exitCode: 0, summary: generateBackupOutput(), error: "" };
		});
		vi.spyOn(agentManager, "runBackup").mockImplementation(async (_agentId, request) => {
			const decoded = parseControllerMessage(createControllerMessage("backup.run", request.payload));
			if (!decoded?.success || decoded.data.type !== "backup.run") throw new Error("Invalid backup dispatch");
			const payload = decoded.data.payload;
			const jobs = new Map<string, RunningJob>();
			let result: BackupExecutionResult | undefined;
			const context: ControllerCommandContext = {
				allowRestore: true,
				trustedRoots: createTrustedRootRegistry({ builtinLocal: true }),
				getRunningJob: (jobId) => Effect.succeed(jobs.get(jobId)),
				setRunningJob: (jobId, job) =>
					Effect.sync(() => {
						jobs.set(jobId, job);
					}),
				deleteRunningJob: (jobId) =>
					Effect.sync(() => {
						jobs.delete(jobId);
					}),
				offerOutbound: (wire) =>
					Effect.sync(() => {
						const message = parseAgentMessage(wire);
						if (!message?.success) throw new Error("Invalid agent event");
						if (message.data.type === "backup.completed") {
							result = {
								status: "completed",
								exitCode: message.data.payload.exitCode,
								result: message.data.payload.result,
								warningDetails: message.data.payload.warningDetails ?? null,
							};
						} else if (message.data.type === "backup.failed") {
							result = { status: "failed", error: message.data.payload.error };
						}
						return true;
					}),
			};

			await Effect.runPromise(
				Effect.gen(function* () {
					yield* handleBackupRunCommand(context, payload);
					yield* Effect.promise(() =>
						waitForExpect(() => {
							expect(result).toBeDefined();
						}),
					);
				}),
			);
			if (!result) throw new Error("Expected backup outcome");

			return result;
		});

		try {
			const volume = await createTestVolume({ config: { backend: "directory", path: tmpdir() } });
			const repository = await createTestRepository();
			const schedule = await createTestBackupSchedule({
				volumeId: volume.id,
				repositoryId: repository.id,
				backupWebhooks: {
					pre: pre ? { url: `${origin}/pre` } : null,
					post: { url: `${origin}/post` },
				},
			});

			const result = await withContext({ organizationId: TEST_ORG_ID }, () =>
				backupExecutor.execute({
					jobId: "webhook-backup",
					scheduleId: schedule.id,
					schedule,
					volume,
					repository,
					organizationId: TEST_ORG_ID,
					signal: new AbortController().signal,
					onProgress: () => {},
				}),
			);

			const blockedWebhookError =
				"The agent could not complete the filesystem operation. Check the agent logs for details.";

			expect(result.status).toBe(completed ? "completed" : "failed");
			if (completed) {
				expect(result).toMatchObject({
					warningDetails: runtime === "server" && !allowed ? blockedWebhookError : null,
				});
				expect(actions).toEqual(pre ? ["/pre", "backup", "/post"] : ["backup"]);
			} else {
				expect(result).toMatchObject({ error: blockedWebhookError });
				expect(actions).toEqual([]);
			}
		} finally {
			webhookServer.closeAllConnections();
			if (webhookServer.listening) {
				await new Promise<void>((resolve, reject) => {
					webhookServer.close((error) => (error ? reject(error) : resolve()));
				});
			}
		}
	},
);
